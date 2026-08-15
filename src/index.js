import { Client, GatewayIntentBits } from "discord.js";
import { db } from "./db.js";
import { sendReminderMessage } from "./discord.js";
import {
  isWithinActiveWindow,
  nextWindowStart,
  computeNextEligible,
} from "./scheduling.js";
import { commandRegistry } from "./commandRegistry.js";
import {
  handleRemindOnce,
  handleRemindRepeat,
  handleRemindList,
  handleRemindDelete,
  handleRemindCommand,
  handleFunCommand,
} from "./commands.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const FUN_COMMAND_NAMES = new Set(Object.keys(commandRegistry));

function createEmbed({ title, description, color = 0x5865f2 }) {
  return {
    embeds: [
      {
        title,
        description,
        color,
      },
    ],
  };
}

// Convert discord.js Interaction to match commands.js expected format
function adaptInteraction(interaction) {
  const subOption = interaction.options.data[0];
  return {
    guild_id: interaction.guildId,
    channel_id: interaction.channelId,
    user: interaction.user,
    member: interaction.member,
    data: {
      options: subOption?.options || [],
    },
  };
}

client.once("clientReady", () => {
  console.log(`🤖 Logged in as ${client.user.tag}!`);

  // Run initial reminder check on boot, then schedule the next run only
  // after each one finishes. A fixed setInterval would fire again even if
  // the previous run was still in flight (slow D1/Discord round-trips),
  // risking overlapping runs that could double-send the same reminder.
  scheduleNextReminderCheck(0);
});

let reminderCheckInFlight = false;

function scheduleNextReminderCheck(delayMs) {
  setTimeout(async () => {
    if (reminderCheckInFlight) {
      // Previous run is still going (shouldn't normally happen since we
      // only reschedule after completion, but guards against re-entrancy).
      scheduleNextReminderCheck(60000);
      return;
    }
    reminderCheckInFlight = true;
    try {
      await processDueReminders();
    } catch (err) {
      console.error("Unhandled error in processDueReminders:", err);
    } finally {
      reminderCheckInFlight = false;
      scheduleNextReminderCheck(60000);
    }
  }, delayMs);
}

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (FUN_COMMAND_NAMES.has(interaction.commandName)) {
      await interaction.deferReply();
      const result = await handleFunCommand(interaction.commandName);
      const isError = Boolean(result.error);

      await interaction.editReply({
        ...createEmbed({
          title: isError ? "Error" : interaction.commandName,
          description: result.success || result.error,
          color: isError ? 0xed4245 : 0x9d00ff,
        }),
      });
      return;
    }

    if (interaction.commandName === "remind") {
      await interaction.deferReply();

      const sub = interaction.options.getSubcommand();
      let result;
      let embedTitle = "Reminder";

      const adapted = adaptInteraction(interaction);

      try {
        if (sub === "once") {
          embedTitle = "Reminder Set";
          result = await handleRemindOnce(adapted);
        } else if (sub === "repeat") {
          embedTitle = "Repeating Reminder Set";
          result = await handleRemindRepeat(adapted);
        } else if (sub === "command") {
          embedTitle = "Recurring Command Reminder Set";
          result = await handleRemindCommand(adapted);
        } else if (sub === "list") {
          embedTitle = "Active Reminders";
          result = await handleRemindList(adapted);
        } else if (sub === "delete") {
          embedTitle = "Reminder Deleted";
          result = await handleRemindDelete(adapted);
        } else {
          result = { error: "Unknown command." };
        }
      } catch (err) {
        console.error("Command error:", err);
        result = { error: `Something went wrong: ${err.message}` };
      }

      const isError = Boolean(result.error);

      // Note: previously errors replied ephemerally. With deferReply() up
      // front (needed to avoid the 3s timeout), ephemeral has to be decided
      // at defer time — before we know if the command will fail — so error
      // replies are now visible to the channel like everything else.
      await interaction.editReply({
        ...createEmbed({
          title: isError ? "Error" : embedTitle,
          description: result.success || result.error,
          color: isError ? 0xed4245 : 0x5865f2,
        }),
      });
    }
  } catch (err) {
    // Catches failures in deferReply/editReply themselves (expired
    // interaction, network blip, etc.) that the inner try/catch blocks
    // above don't cover. Without this, such a failure is an unhandled
    // rejection inside an event handler and can crash the process.
    console.error("Unhandled interaction error:", err);
    try {
      const payload = createEmbed({
        title: "Error",
        description: "Something went wrong handling that command.",
        color: 0xed4245,
      });
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload);
      } else {
        await interaction.reply(payload);
      }
    } catch (followUpErr) {
      console.error("Failed to notify user of error:", followUpErr);
    }
  }
});

/**
 * Background Cron Job
 */
async function processDueReminders() {
  const now = new Date();

  try {
    const { results: due } = await db
      .prepare(
        `SELECT * FROM reminders
       WHERE enabled = 1
         AND next_eligible_at <= ?
       ORDER BY next_eligible_at ASC
       LIMIT 100`,
      )
      .bind(now.toISOString())
      .all();

    for (const reminder of due) {
      try {
        if (!isWithinActiveWindow(reminder, now)) {
          const next = nextWindowStart(reminder, now);
          await db
            .prepare(`UPDATE reminders SET next_eligible_at = ? WHERE id = ?`)
            .bind(next.toISOString(), reminder.id)
            .run();

          continue;
        }

        let sendFailed = false;
        try {
          await sendReminderMessage(client, reminder);
        } catch (err) {
          sendFailed = true;
          console.error(`Failed to send reminder ${reminder.id}:`, err.message);
        }

        // Advance/disable regardless of send success. Otherwise a reminder
        // whose channel was deleted (or any other persistent send failure)
        // never moves past next_eligible_at and gets retried every cron
        // tick forever, crowding out every other due reminder.
        if (reminder.type === "once") {
          await db
            .prepare(
              `UPDATE reminders SET enabled = 0, last_sent_at = ? WHERE id = ?`,
            )
            .bind(now.toISOString(), reminder.id)
            .run();
        } else {
          const next = computeNextEligible(reminder, now);
          await db
            .prepare(
              `UPDATE reminders SET last_sent_at = ?, next_eligible_at = ? WHERE id = ?`,
            )
            .bind(now.toISOString(), next.toISOString(), reminder.id)
            .run();
        }
      } catch (err) {
        console.error(
          `Failed to process reminder ${reminder.id}:`,
          err.message,
        );
      }
    }
  } catch (err) {
    console.error("Error processing due reminders:", err);
  }
}

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (err) => {
  // Log and keep running rather than letting Node's default behavior
  // (crash the process) take down every in-flight reminder/interaction.
  // If a given error keeps recurring, it'll show up in these logs.
  console.error("Uncaught exception:", err);
});

client.login(process.env.DISCORD_TOKEN).catch((err) => {
  console.error("Failed to log in to Discord:", err.message);
  process.exit(1);
});

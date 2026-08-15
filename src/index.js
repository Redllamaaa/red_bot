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

  // Run initial reminder check on boot, then every 60 seconds
  processDueReminders();
  setInterval(processDueReminders, 60000);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

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

    await interaction.reply({
      ...createEmbed({
        title: isError ? "Error" : embedTitle,
        description: result.success || result.error,
        color: isError ? 0xed4245 : 0x5865f2,
      }),
      ephemeral: isError,
    });
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

        await sendReminderMessage(client, reminder);

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

client.login(process.env.DISCORD_TOKEN);

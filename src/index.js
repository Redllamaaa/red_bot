import { Client, GatewayIntentBits } from "discord.js";
import { db } from "./db.js";
import { sendReminderMessage, sendBirthdayMessage } from "./discord.js";
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
  handleBirthdayCommand,
  handleFunCommand,
} from "./commands.js";
import { COLORS, EMBED_LIMITS } from "./utils/constants.js";
import { truncate } from "./utils/utils.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const FUN_COMMAND_NAMES = new Set(Object.keys(commandRegistry));

const FUN_COMMAND_TITLES = {
  compliment: "Compliment",
  fortune: "Fortune",
  funfact: "Fun Fact",
  pizzaidea: "Pizza Idea",
  lifetruth: "Life Truth",
  thought: "Thought",
};

function createEmbed({ title, description, color = COLORS.DEFAULT }) {
  return {
    embeds: [
      {
        title: truncate(title, EMBED_LIMITS.TITLE),
        description: truncate(description, EMBED_LIMITS.DESCRIPTION),
        color,
      },
    ],
  };
}

// Convert discord.js Interaction to match commands.js expected format.
function adaptInteraction(interaction) {
  const subOption = interaction.options.data[0];

  return {
    guild_id: interaction.guildId,
    channel_id: interaction.channelId,
    user: interaction.user,
    member: interaction.member,
    data: {
      subcommand: subOption?.name,
      options: subOption?.options || [],
    },
  };
}

client.once("clientReady", () => {
  console.log(`🤖 Logged in as ${client.user.tag}!`);

  // Run initial checks on boot, then schedule the next run only after the
  // previous one finishes.
  scheduleNextReminderCheck(0);
});

let reminderCheckInFlight = false;

function scheduleNextReminderCheck(delayMs) {
  setTimeout(async () => {
    if (reminderCheckInFlight) {
      scheduleNextReminderCheck(60000);
      return;
    }

    reminderCheckInFlight = true;

    try {
      await processDueReminders();
      await processDueBirthdays();
    } catch (err) {
      console.error("Unhandled error in background processing:", err);
    } finally {
      reminderCheckInFlight = false;
      scheduleNextReminderCheck(60000);
    }
  }, delayMs);
}

client.on("interactionCreate", async (interaction) => {
  if (interaction.isButton()) {
    if (!interaction.customId.startsWith("reminder:snooze:")) {
      return;
    }

    const [, , duration, reminderId] = interaction.customId.split(":");

    const snoozeMinutes =
      duration === "30m" ? 30 : duration === "1h" ? 60 : null;

    if (!snoozeMinutes) {
      await interaction.reply({
        content: "Invalid snooze duration.",
        ephemeral: true,
      });
      return;
    }

    try {
      const { results } = await db
        .prepare(
          `SELECT id, type, snooze_enabled, enabled
           FROM reminders
           WHERE id = ?`,
        )
        .bind(reminderId)
        .all();

      const reminder = results[0];

      if (!reminder) {
        await interaction.reply({
          content: "That reminder no longer exists.",
          ephemeral: true,
        });
        return;
      }

      if (!reminder.enabled) {
        await interaction.reply({
          content: "That reminder is no longer active.",
          ephemeral: true,
        });
        return;
      }

      if (!reminder.snooze_enabled) {
        await interaction.reply({
          content: "Snoozing is disabled for this reminder.",
          ephemeral: true,
        });
        return;
      }

      const snoozedUntil = new Date(Date.now() + snoozeMinutes * 60 * 1000);

      await db
        .prepare(
          `UPDATE reminders
           SET next_eligible_at = ?
           WHERE id = ?`,
        )
        .bind(snoozedUntil.toISOString(), reminderId)
        .run();

      await interaction.reply({
        content: `⏰ Snoozed for ${snoozeMinutes} minutes, until <t:${Math.floor(
          snoozedUntil.getTime() / 1000,
        )}:t>.`,
        ephemeral: true,
      });
    } catch (err) {
      console.error("Failed to snooze reminder:", err);

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "Something went wrong while snoozing that reminder.",
          ephemeral: true,
        });
      }
    }

    return;
  }

  if (!interaction.isChatInputCommand()) return;

  try {
    if (FUN_COMMAND_NAMES.has(interaction.commandName)) {
      await interaction.deferReply();

      const result = await handleFunCommand(interaction.commandName);
      const isError = Boolean(result.error);

      await interaction.editReply({
        ...createEmbed({
          title: isError
            ? "Error"
            : FUN_COMMAND_TITLES[interaction.commandName] ||
              interaction.commandName,
          description: result.success || result.error,
          color: isError ? COLORS.ERROR : COLORS.FUN,
        }),
      });

      return;
    }

    if (
      interaction.commandName !== "remind" &&
      interaction.commandName !== "birthday"
    ) {
      return;
    }

    await interaction.deferReply();

    let result;
    let embedTitle = "Reminder";

    const adapted = adaptInteraction(interaction);

    try {
      if (interaction.commandName === "birthday") {
        const sub = interaction.options.getSubcommand();

        if (sub === "set") {
          embedTitle = "Birthday Set";
        } else if (sub === "delete") {
          embedTitle = "Birthday Deleted";
        } else if (sub === "list") {
          embedTitle = "Birthdays";
        }

        result = await handleBirthdayCommand({
          ...adapted,
          data: {
            ...adapted.data,
            subcommand: sub,
          },
        });
      } else {
        const sub = interaction.options.getSubcommand();

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
          result = {
            error: "Unknown command.",
          };
        }
      }
    } catch (err) {
      console.error("Command error:", err);

      result = {
        error: `Something went wrong: ${err.message}`,
      };
    }

    const isError = Boolean(result.error);

    await interaction.editReply({
      ...createEmbed({
        title: isError ? "Error" : embedTitle,
        description: result.success || result.error,
        color: isError ? COLORS.ERROR : COLORS.DEFAULT,
      }),
    });
  } catch (err) {
    console.error("Unhandled interaction error:", err);

    try {
      const payload = createEmbed({
        title: "Error",
        description: "Something went wrong handling that command.",
        color: COLORS.ERROR,
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
 * Runs `worker` over `items` with at most `limit` in flight at once.
 */
async function mapWithConcurrency(items, limit, worker) {
  const queue = [...items];

  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (queue.length) {
        const item = queue.shift();

        try {
          await worker(item);
        } catch (err) {
          console.error("Background item failed:", err);
        }
      }
    },
  );

  await Promise.all(runners);
}

const REMINDER_PROCESSING_CONCURRENCY = 8;

/**
 * Process normal reminders.
 */
async function processDueReminders() {
  const now = new Date();

  try {
    const { results: due } = await db
      .prepare(
        `SELECT *
         FROM reminders
         WHERE enabled = 1
           AND next_eligible_at <= ?
         ORDER BY next_eligible_at ASC
         LIMIT 100`,
      )
      .bind(now.toISOString())
      .all();

    await mapWithConcurrency(due, REMINDER_PROCESSING_CONCURRENCY, (reminder) =>
      processReminder(reminder, now),
    );
  } catch (err) {
    console.error("Error processing due reminders:", err);
  }
}

/**
 * Sends (or reschedules) a single due reminder.
 */
async function processReminder(reminder, now) {
  try {
    if (!isWithinActiveWindow(reminder, now)) {
      const next = nextWindowStart(reminder, now);

      await db
        .prepare(
          `UPDATE reminders
           SET next_eligible_at = ?
           WHERE id = ?`,
        )
        .bind(next.toISOString(), reminder.id)
        .run();

      return;
    }

    await sendReminderMessage(client, reminder);

    if (reminder.type === "once") {
      if (reminder.snooze_enabled && !reminder.last_sent_at) {
        // First send: keep the reminder active so the user can snooze it,
        // but push next_eligible_at far into the future so the scheduler
        // (which selects on `next_eligible_at <= now`) doesn't immediately
        // re-select and re-send this row on the very next tick. If the
        // user snoozes, the button handler in this file overwrites
        // next_eligible_at with the real snooze time.
        const farFuture = new Date(
          now.getTime() + 100 * 365 * 24 * 60 * 60 * 1000,
        );

        await db
          .prepare(
            `UPDATE reminders
             SET last_sent_at = ?,
                 next_eligible_at = ?
             WHERE id = ?`,
          )
          .bind(now.toISOString(), farFuture.toISOString(), reminder.id)
          .run();
      } else {
        // Either snooze was never enabled, or this is a re-fire after a
        // snooze fired again — either way, it's done now.
        await db
          .prepare(
            `UPDATE reminders
             SET enabled = 0,
                 last_sent_at = ?
             WHERE id = ?`,
          )
          .bind(now.toISOString(), reminder.id)
          .run();
      }

      return;
    }

    const next = computeNextEligible(reminder, now);

    await db
      .prepare(
        `UPDATE reminders
         SET last_sent_at = ?,
             next_eligible_at = ?
         WHERE id = ?`,
      )
      .bind(now.toISOString(), next.toISOString(), reminder.id)
      .run();
  } catch (err) {
    console.error(`Failed to process reminder ${reminder.id}:`, err.message);
  }
}

/**
 * Process birthdays that are due today.
 *
 * Birthday reminders always use UTC:
 *
 *   month = UTC month
 *   day   = UTC day
 *   send  = 09:00 UTC
 *
 * The worker runs every minute, so we don't store a next_eligible_at.
 * last_sent_year makes the operation idempotent.
 */
async function processDueBirthdays() {
  const now = new Date();

  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();
  const year = now.getUTCFullYear();

  // Birthday reminders are only sent at 10:00 UTC.
  if (now.getUTCHours() !== 10) {
    return;
  }

  try {
    const { results: birthdays } = await db
      .prepare(
        `SELECT *
         FROM birthdays
         WHERE enabled = 1
           AND month = ?
           AND day = ?
           AND (last_sent_year IS NULL OR last_sent_year < ?)
         ORDER BY id ASC
         LIMIT 100`,
      )
      .bind(month, day, year)
      .all();

    if (!birthdays.length) {
      return;
    }

    await mapWithConcurrency(
      birthdays,
      REMINDER_PROCESSING_CONCURRENCY,
      (birthday) => processBirthday(birthday, now, year),
    );
  } catch (err) {
    console.error("Error processing birthdays:", err);
  }
}

/**
 * Sends a single birthday message.
 *
 * The year is only marked as sent after Discord successfully accepts
 * the message. If Discord fails, the birthday remains eligible and
 * can be retried on the next scheduler tick.
 */
async function processBirthday(birthday, now, year) {
  try {
    await sendBirthdayMessage(client, birthday);

    await db
      .prepare(
        `UPDATE birthdays
         SET last_sent_year = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(year, now.toISOString(), birthday.id)
      .run();
  } catch (err) {
    console.error(`Failed to send birthday ${birthday.id}:`, err.message);
  }
}

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

client.login(process.env.DISCORD_TOKEN).catch((err) => {
  console.error("Failed to log in to Discord:", err.message);
  process.exit(1);
});

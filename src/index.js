import { Client, GatewayIntentBits } from "discord.js";
import { db } from "./db.js";
import { isAdmin } from "./utils/permissions.js";
import {
  sendReminderMessage,
  sendBirthdayMessage,
  clearMessages,
} from "./discord.js";
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
  handleTimezoneCommand,
  handleFunCommand,
} from "./commands.js";
import {
  sendReminderTypeMenu,
  handleWizardButton,
  handleWizardModalSubmit,
  handleWizardSelectMenu,
} from "./reminderWizard.js";
import { COLORS, EMBED_LIMITS } from "./utils/constants.js";
import { truncate } from "./utils/utils.js";
import { registerCommands } from "../register-commands.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// Convert discord.js Interaction to match commands.js expected format.
function adaptInteraction(interaction, subcommandOverride) {
  const subOption = interaction.options.data[0];

  return {
    guild_id: interaction.guildId,
    channel_id: interaction.channelId,
    user: interaction.user,
    member: interaction.member,
    locale: interaction.locale,
    data: {
      subcommand: subcommandOverride ?? subOption?.name,
      options: subOption?.options || [],
    },
  };
}

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

/**
 * Single source of truth for every slash command that follows the
 * "defer -> run -> reply with an embed" shape. Keyed by `commandName` for
 * commands with no subcommands, or `commandName:subcommand` for ones that
 * have them.
 *
 * Each entry:
 *   - title: string, or (interaction) => string
 *   - color: embed color on success (defaults to COLORS.DEFAULT)
 *   - ephemeral: whether the reply should be ephemeral (defaults false)
 *   - permission: optional (interaction) => string | null — return an
 *     error message to deny, or null/undefined to allow. Runs before defer.
 *   - run: (interaction) => Promise<{ success } | { error }>
 *
 * Commands that don't fit this shape (buttons, modals, the reminder
 * wizard's `/remind menu`) are still special-cased above the dispatcher,
 * same as before — this table only covers the "one reply, one embed" case,
 * which is the vast majority of commands.
 */
const COMMAND_TABLE = {
  clear: {
    title: "Messages Cleared",
    ephemeral: true,
    permission: (interaction) =>
      isAdmin(interaction) || interaction.user.id === "661140312248549376"
        ? null
        : "You need Administrator permission to use this command.",
    run: async (interaction) => {
      const amount = interaction.options.getInteger("amount");
      const deletedCount = await clearMessages(interaction.channel, amount);
      return { success: `Deleted ${deletedCount} message(s).` };
    },
  },

  "remind:once": {
    title: "Reminder Set",
    run: (interaction) => handleRemindOnce(adaptInteraction(interaction)),
  },
  "remind:repeat": {
    title: "Repeating Reminder Set",
    run: (interaction) => handleRemindRepeat(adaptInteraction(interaction)),
  },
  "remind:command": {
    title: "Recurring Command Reminder Set",
    run: (interaction) => handleRemindCommand(adaptInteraction(interaction)),
  },
  "remind:list": {
    title: "Active Reminders",
    run: (interaction) => handleRemindList(adaptInteraction(interaction)),
  },
  "remind:delete": {
    title: "Reminder Deleted",
    run: (interaction) => handleRemindDelete(adaptInteraction(interaction)),
  },

  "birthday:set": {
    title: "Birthday Set",
    run: (interaction) =>
      handleBirthdayCommand(adaptInteraction(interaction, "set")),
  },
  "birthday:delete": {
    title: "Birthday Deleted",
    run: (interaction) =>
      handleBirthdayCommand(adaptInteraction(interaction, "delete")),
  },
  "birthday:list": {
    title: "Birthdays",
    run: (interaction) =>
      handleBirthdayCommand(adaptInteraction(interaction, "list")),
  },

  "timezone:set": {
    title: "Timezone Set",
    run: (interaction) =>
      handleTimezoneCommand(adaptInteraction(interaction, "set")),
  },
  "timezone:view": {
    title: "Your Timezone",
    run: (interaction) =>
      handleTimezoneCommand(adaptInteraction(interaction, "view")),
  },
  "timezone:clear": {
    title: "Timezone Cleared",
    run: (interaction) =>
      handleTimezoneCommand(adaptInteraction(interaction, "clear")),
  },
};

// Fun commands (compliment, fortune, ...) all share one shape, so they're
// generated into the same table instead of hand-written one by one.
const FUN_COMMAND_TITLES = {
  compliment: "Compliment",
  fortune: "Fortune",
  funfact: "Fun Fact",
  pizzaidea: "Pizza Idea",
  lifetruth: "Life Truth",
  thought: "Thought",
};
for (const name of Object.keys(commandRegistry)) {
  COMMAND_TABLE[name] = {
    title: FUN_COMMAND_TITLES[name] || name,
    color: COLORS.FUN,
    run: () => handleFunCommand(name),
  };
}

function commandKeyFor(interaction) {
  const sub = interaction.options.getSubcommand(false);
  return sub ? `${interaction.commandName}:${sub}` : interaction.commandName;
}

/**
 * Runs whatever COMMAND_TABLE entry matches this interaction. Returns
 * `true` if it found and handled an entry, `false` if the interaction
 * didn't match anything in the table (so the caller can decide what to do
 * with it, e.g. the reminder wizard menu).
 */
async function dispatchCommand(interaction) {
  const key = commandKeyFor(interaction);
  const entry = COMMAND_TABLE[key];
  if (!entry) return false;

  if (entry.permission) {
    const denied = entry.permission(interaction);
    if (denied) {
      await interaction.reply({
        ...createEmbed({
          title: "Error",
          description: denied,
          color: COLORS.ERROR,
        }),
        ephemeral: true,
      });
      return true;
    }
  }

  await interaction.deferReply({ ephemeral: !!entry.ephemeral });

  let result;
  try {
    result = await entry.run(interaction);
  } catch (err) {
    console.error(`${key} error:`, err);
    result = { error: `Something went wrong: ${err.message}` };
  }

  const isError = Boolean(result.error);
  const title =
    typeof entry.title === "function" ? entry.title(interaction) : entry.title;

  await interaction.editReply({
    ...createEmbed({
      title: isError ? "Error" : title,
      description: result.success || result.error,
      color: isError ? COLORS.ERROR : entry.color || COLORS.DEFAULT,
    }),
  });

  return true;
}

client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}!`);

  try {
    const count = await registerCommands();
    console.log(`Slash commands refreshed (${count} top-level commands).`);
  } catch (err) {
    console.error("Failed to refresh slash commands on boot:", err.message);
  }

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
    if (interaction.customId.startsWith("rw:")) {
      try {
        await handleWizardButton(interaction);
      } catch (err) {
        console.error("Reminder wizard button error:", err);
      }
      return;
    }

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
          `SELECT id, type, snooze_enabled, enabled FROM reminders WHERE id = ?`,
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
        .prepare(`UPDATE reminders SET next_eligible_at = ? WHERE id = ?`)
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

  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith("rw:modal:")) {
      try {
        await handleWizardModalSubmit(interaction);
      } catch (err) {
        console.error("Reminder wizard modal error:", err);
      }
    }
    return;
  }

  if (interaction.isStringSelectMenu() || interaction.isRoleSelectMenu()) {
    if (interaction.customId.startsWith("rw:")) {
      try {
        await handleWizardSelectMenu(interaction);
      } catch (err) {
        console.error("Reminder wizard select error:", err);
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  try {
    // The guided reminder wizard replies with buttons, not a plain embed,
    // so it stays outside the table-driven dispatch.
    if (
      interaction.commandName === "remind" &&
      interaction.options.getSubcommand() === "menu"
    ) {
      await interaction.deferReply({ ephemeral: true });
      try {
        await sendReminderTypeMenu(interaction);
      } catch (err) {
        console.error("Reminder wizard menu error:", err);
        await interaction.editReply({
          ...createEmbed({
            title: "Error",
            description: "Couldn't open the reminder menu.",
            color: COLORS.ERROR,
          }),
        });
      }
      return;
    }

    const handled = await dispatchCommand(interaction);
    if (!handled) return; // unknown command, silently ignore
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

import { InteractionType, InteractionResponseType } from "discord-interactions";
import {
  verifyDiscordRequest,
  jsonResponse,
  sendReminderMessage,
} from "./discord.js";
import {
  isWithinActiveWindow,
  nextWindowStart,
  computeNextEligible,
} from "./scheduling.js";
import {
  handleRemindOnce,
  handleRemindRepeat,
  handleRemindList,
  handleRemindDelete,
} from "./commands.js";

/**
 * Creates a Discord embed response.
 */
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

export default {
  // Handles Discord interaction webhooks (slash commands).
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Expected POST", { status: 405 });
    }

    const { isValid, body: interaction } = await verifyDiscordRequest(
      request,
      env.DISCORD_PUBLIC_KEY
    );

    if (!isValid) {
      return new Response("Bad request signature", { status: 401 });
    }

    if (interaction.type === InteractionType.PING) {
      return jsonResponse({
        type: InteractionResponseType.PONG,
      });
    }

    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      const name = interaction.data.name;
      const sub = interaction.data.options?.[0]?.name;

      // Slash command is /remind with subcommands:
      // once | repeat | list | delete
      let result;
      let embedTitle = "Reminder";

      try {
        if (name === "remind" && sub === "once") {
          embedTitle = "Reminder Set";

          result = await handleRemindOnce(
            {
              ...interaction,
              data: interaction.data.options[0],
            },
            env
          );
        } else if (name === "remind" && sub === "repeat") {
          embedTitle = "Repeating Reminder Set";

          result = await handleRemindRepeat(
            {
              ...interaction,
              data: interaction.data.options[0],
            },
            env
          );
        } else if (name === "remind" && sub === "list") {
          embedTitle = "Active Reminders";

          result = await handleRemindList(interaction, env);
        } else if (name === "remind" && sub === "delete") {
          embedTitle = "Reminder Deleted";

          result = await handleRemindDelete(
            {
              ...interaction,
              data: interaction.data.options[0],
            },
            env
          );
        } else {
          result = {
            error: "Unknown command.",
          };
        }
      } catch (err) {
        console.error("Command error:", err);

        result = {
          error: `Something went wrong: ${err.message}`,
        };
      }

      const isError = Boolean(result.error);

      return jsonResponse({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          ...createEmbed({
            title: isError ? "Error" : embedTitle,
            description: result.success || result.error,
            color: isError ? 0xed4245 : 0x5865f2,
          }),

          // Errors are ephemeral.
          flags: isError ? 64 : 0,
        },
      });
    }

    return new Response("Unhandled interaction type", {
      status: 400,
    });
  },

  // Runs every minute (see wrangler.toml crons).
  // Fires any due reminders.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(processDueReminders(env));
  },
};

async function processDueReminders(env) {
  const now = new Date();

  const { results: due } = await env.DB.prepare(
    `SELECT * FROM reminders
     WHERE enabled = 1
       AND next_eligible_at <= ?
     LIMIT 100`
  )
    .bind(now.toISOString())
    .all();

  for (const reminder of due) {
    try {
      // If the reminder is currently outside its active window,
      // move it to the beginning of the next active window.
      if (!isWithinActiveWindow(reminder, now)) {
        const next = nextWindowStart(reminder, now);

        await env.DB.prepare(
          `UPDATE reminders
           SET next_eligible_at = ?
           WHERE id = ?`
        )
          .bind(next.toISOString(), reminder.id)
          .run();

        continue;
      }

      // Send the actual reminder.
      await sendReminderMessage(env, reminder);

      if (reminder.type === "once") {
        // One-off reminders are disabled after being sent.
        await env.DB.prepare(
          `UPDATE reminders
           SET enabled = 0,
               last_sent_at = ?
           WHERE id = ?`
        )
          .bind(now.toISOString(), reminder.id)
          .run();
      } else {
        // Repeating reminders are scheduled for their next occurrence.
        const next = computeNextEligible(reminder, now);

        await env.DB.prepare(
          `UPDATE reminders
           SET last_sent_at = ?,
               next_eligible_at = ?
           WHERE id = ?`
        )
          .bind(now.toISOString(), next.toISOString(), reminder.id)
          .run();
      }
    } catch (err) {
      // Don't let one bad reminder (e.g. bot kicked from a channel)
      // block the rest.
      console.error(
        `Failed to process reminder ${reminder.id}:`,
        err.message
      );
    }
  }
}
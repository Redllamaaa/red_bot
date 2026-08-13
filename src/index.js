import { InteractionType, InteractionResponseType } from "discord-interactions";
import { verifyDiscordRequest, jsonResponse, sendReminderMessage } from "./discord.js";
import { isWithinActiveWindow, nextWindowStart, computeNextEligible } from "./scheduling.js";
import {
  handleRemindOnce,
  handleRemindRepeat,
  handleRemindList,
  handleRemindDelete,
} from "./commands.js";

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
      return jsonResponse({ type: InteractionResponseType.PONG });
    }

    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      const name = interaction.data.name;
      const sub = interaction.data.options?.[0]?.name;

      // Slash command is /remind with subcommands once | repeat | list | delete
      let result;
      try {
        if (name === "remind" && sub === "once") {
          result = await handleRemindOnce(
            { ...interaction, data: interaction.data.options[0] },
            env
          );
        } else if (name === "remind" && sub === "repeat") {
          result = await handleRemindRepeat(
            { ...interaction, data: interaction.data.options[0] },
            env
          );
        } else if (name === "remind" && sub === "list") {
          result = await handleRemindList(interaction, env);
        } else if (name === "remind" && sub === "delete") {
          result = await handleRemindDelete(
            { ...interaction, data: interaction.data.options[0] },
            env
          );
        } else {
          result = { error: "Unknown command." };
        }
      } catch (err) {
        result = { error: `Something went wrong: ${err.message}` };
      }

      return jsonResponse({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: result.success || result.error, flags: result.error ? 64 : 0 },
      });
    }

    return new Response("Unhandled interaction type", { status: 400 });
  },

  // Runs every minute (see wrangler.toml crons). Fires any due reminders.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(processDueReminders(env));
  },
};

async function processDueReminders(env) {
  const now = new Date();
  const { results: due } = await env.DB.prepare(
    `SELECT * FROM reminders WHERE enabled = 1 AND next_eligible_at <= ? LIMIT 100`
  )
    .bind(now.toISOString())
    .all();

  for (const reminder of due) {
    try {
      if (!isWithinActiveWindow(reminder, now)) {
        const next = nextWindowStart(reminder, now);
        await env.DB.prepare(`UPDATE reminders SET next_eligible_at = ? WHERE id = ?`)
          .bind(next.toISOString(), reminder.id)
          .run();
        continue;
      }

      await sendReminderMessage(env, reminder);

      if (reminder.type === "once") {
        await env.DB.prepare(`UPDATE reminders SET enabled = 0, last_sent_at = ? WHERE id = ?`)
          .bind(now.toISOString(), reminder.id)
          .run();
      } else {
        const next = computeNextEligible(reminder, now);
        await env.DB.prepare(
          `UPDATE reminders SET last_sent_at = ?, next_eligible_at = ? WHERE id = ?`
        )
          .bind(now.toISOString(), next.toISOString(), reminder.id)
          .run();
      }
    } catch (err) {
      // Don't let one bad reminder (e.g. bot kicked from a channel) block the rest.
      console.error(`Failed to process reminder ${reminder.id}:`, err.message);
    }
  }
}

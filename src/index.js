import http from "node:http";
import { InteractionType, InteractionResponseType } from "discord-interactions";
import { db } from "./db.js";
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

const PORT = process.env.PORT || 25953;

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

/**
 * Main Webhook Handler
 */
async function handleWebhook(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "text/plain" });
    return res.end("Expected POST");
  }

  // Convert Node.js request to Web Fetch API Request for verifyDiscordRequest
  const buffers = [];
  for await (const chunk of req) buffers.push(chunk);
  const rawBody = Buffer.concat(buffers).toString("utf-8");

  const webRequest = new Request("http://localhost", {
    method: "POST",
    headers: req.headers,
    body: rawBody,
  });

  const { isValid, body: interaction } = await verifyDiscordRequest(
    webRequest,
    process.env.DISCORD_PUBLIC_KEY,
  );

  if (!isValid) {
    res.writeHead(401, { "Content-Type": "text/plain" });
    return res.end("Bad request signature");
  }

  if (interaction.type === InteractionType.PING) {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ type: InteractionResponseType.PONG }));
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const name = interaction.data.name;
    const sub = interaction.data.options?.[0]?.name;

    let result;
    let embedTitle = "Reminder";

    try {
      if (name === "remind" && sub === "once") {
        embedTitle = "Reminder Set";
        result = await handleRemindOnce({
          ...interaction,
          data: interaction.data.options[0],
        });
      } else if (name === "remind" && sub === "repeat") {
        embedTitle = "Repeating Reminder Set";
        result = await handleRemindRepeat({
          ...interaction,
          data: interaction.data.options[0],
        });
      } else if (name === "remind" && sub === "list") {
        embedTitle = "Active Reminders";
        result = await handleRemindList(interaction);
      } else if (name === "remind" && sub === "delete") {
        embedTitle = "Reminder Deleted";
        result = await handleRemindDelete({
          ...interaction,
          data: interaction.data.options[0],
        });
      } else {
        result = { error: "Unknown command." };
      }
    } catch (err) {
      console.error("Command error:", err);
      result = { error: `Something went wrong: ${err.message}` };
    }

    const isError = Boolean(result.error);
    const responsePayload = {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        ...createEmbed({
          title: isError ? "Error" : embedTitle,
          description: result.success || result.error,
          color: isError ? 0xed4245 : 0x5865f2,
        }),
        flags: isError ? 64 : 0,
      },
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(responsePayload));
  }

  res.writeHead(400, { "Content-Type": "text/plain" });
  res.end("Unhandled interaction type");
}

/**
 * Background Cron Job Replacement
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

        await sendReminderMessage(reminder);

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

// Start Server
const server = http.createServer((req, res) => {
  handleWebhook(req, res).catch((err) => {
    console.error("Unhandled server error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Server Error");
    }
  });
});

server.listen(PORT, () => {
  console.log(`Bot server listening on port ${PORT}`);

  // Run initial check on boot, then every 60 seconds
  processDueReminders();
  setInterval(processDueReminders, 60000);
});

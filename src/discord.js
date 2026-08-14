import { verifyKey } from "discord-interactions";

/**
 * Verifies a Discord interaction request's Ed25519 signature.
 */
export async function verifyDiscordRequest(request, publicKey) {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  const body = await request.text();

  const isValid =
    signature &&
    timestamp &&
    (await verifyKey(body, signature, timestamp, publicKey));

  if (!isValid) return { isValid: false };
  return { isValid: true, body: JSON.parse(body) };
}

/**
 * Sends a message (with optional embed + role ping) to a channel using
 * the bot token.
 */
export async function sendReminderMessage(reminder) {
  const hasRole = Boolean(reminder.ping_role_id);

  const content = hasRole
    ? `<@&${reminder.ping_role_id}>`
    : `<@${reminder.created_by}>`;

  const allowed_mentions = hasRole
    ? { roles: [reminder.ping_role_id] }
    : { users: [reminder.created_by] };

  const res = await fetch(
    `https://discord.com/api/v10/channels/${reminder.channel_id}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content,
        allowed_mentions,
        embeds: [
          {
            title: reminder.title,
            description: reminder.message,
            color: 0x3498db,
            footer: {
              text:
                reminder.type === "once"
                  ? "One-off reminder"
                  : "Recurring reminder",
            },
          },
        ],
      }),
    },
  );

  if (!res.ok) {
    const error = await res.text();
    throw new Error(
      `Failed to send reminder message (${res.status}): ${error}`,
    );
  }

  return res.json();
}

/** Thin wrapper for responding to an interaction synchronously. */
export function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

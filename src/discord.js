import { verifyKey } from "discord-interactions";

/**
 * Verifies a Discord interaction request's Ed25519 signature.
 * Must be called with the RAW body string (not parsed JSON), or
 * verification will fail.
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
 * the bot token. Used by the scheduled worker to fire reminders.
 */
export async function sendReminderMessage(env, reminder) {
  const res = await fetch(
    `https://discord.com/api/v10/channels/${reminder.channel_id}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${env.DISCORD_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: reminder.ping_role_id ? `<@&${reminder.ping_role_id}>` : undefined,
        allowed_mentions: reminder.ping_role_id
          ? { roles: [reminder.ping_role_id] }
          : undefined,
        embeds: [
          {
            title: reminder.title,
            description: reminder.message,
            color: 0x3498db,
            footer: { text: reminder.type === "once" ? "One-off reminder" : "Recurring reminder" },
          },
        ],
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord API error ${res.status}: ${text}`);
  }
}

/** Thin wrapper for responding to an interaction synchronously. */
export function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

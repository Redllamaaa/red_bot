import { commandRegistry } from "./commandRegistry.js";

/**
 * Sends a message (with optional embed + role ping) to a channel using discord.js.
 */
export async function sendReminderMessage(client, reminder) {
  const channel = await client.channels.fetch(reminder.channel_id);
  if (!channel) {
    throw new Error(`Channel ${reminder.channel_id} not found.`);
  }

  let description = reminder.message;
  if (reminder.command_name) {
    try {
      description = await commandRegistry[reminder.command_name]();
    } catch (err) {
      console.error(`Command "${reminder.command_name}" failed:`, err.message);
      description = `Couldn't run \`${reminder.command_name}\` this time.`;
    }
  }

  const hasRole = Boolean(reminder.ping_role_id);
  const content = hasRole
    ? `<@&${reminder.ping_role_id}>`
    : `<@${reminder.created_by}>`;
  const allowedMentions = hasRole
    ? { roles: [reminder.ping_role_id] }
    : { users: [reminder.created_by] };

  await channel.send({
    content,
    allowedMentions,
    embeds: [
      {
        title: reminder.title,
        description,
        color: 0x3498db,
        footer: {
          text:
            reminder.type === "once"
              ? "One-off reminder"
              : "Recurring reminder",
        },
      },
    ],
  });
}

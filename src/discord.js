import { runFunCommand } from "./commandRegistry.js";
import { COLORS, EMBED_LIMITS } from "./utils/constants.js";
import { truncate } from "./utils/utils.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

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
    const result = await runFunCommand(reminder.command_name);
    description = result.success ?? result.error;
  }

  const hasRole = Boolean(reminder.ping_role_id);
  const content = hasRole
    ? `<@&${reminder.ping_role_id}>`
    : `<@${reminder.created_by}>`;
  const allowedMentions = hasRole
    ? { roles: [reminder.ping_role_id] }
    : { users: [reminder.created_by] };

  const components =
    reminder.snooze_enabled === 1
      ? [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`reminder:snooze:${reminder.id}`)
              .setLabel("Snooze 1 Hour")
              .setStyle(ButtonStyle.Secondary),
          ),
        ]
      : [];

  await channel.send({
    content,
    allowedMentions,
    embeds: [
      {
        // title/message are already truncated to Discord's limits at
        // creation time (see commands.js), but command_name reminders
        // pull description from a live external API on every fire, so
        // it's truncated here as a last line of defense.
        title: truncate(reminder.title, EMBED_LIMITS.TITLE),
        description: truncate(description, EMBED_LIMITS.DESCRIPTION),
        color: COLORS.REMINDER_SENT,
        footer: {
          text:
            reminder.type === "once"
              ? "One-off reminder"
              : "Recurring reminder",
        },
      },
    ],
    components,
  });
}

export async function sendBirthdayMessage(client, birthday) {
  const channel = await client.channels.fetch(birthday.channel_id);

  if (!channel || !channel.isTextBased()) {
    throw new Error(
      `Birthday channel ${birthday.channel_id} is missing or not text-based`,
    );
  }

  const content = birthday.role_id
    ? `<@&${birthday.role_id}> 🎂 Happy birthday <@${birthday.user_id}>!`
    : `🎂 Happy birthday <@${birthday.user_id}>!`;

  await channel.send({
    content,
  });
}

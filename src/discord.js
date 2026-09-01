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
  const isCommandReminder = Boolean(reminder.command_name);

  let content = "";
  let allowedMentions = { parse: [] };
  if (hasRole) {
    content = `<@&${reminder.ping_role_id}>`;
    allowedMentions = { roles: [reminder.ping_role_id] };
  } else if (!isCommandReminder) {
    content = `<@${reminder.created_by}>`;
    allowedMentions = { users: [reminder.created_by] };
  }

  const components =
    reminder.snooze_enabled === 1
      ? [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`reminder:snooze:30m:${reminder.id}`)
              .setLabel("Snooze 30 Minutes")
              .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
              .setCustomId(`reminder:snooze:1h:${reminder.id}`)
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

export async function clearMessages(channel, amount) {
  const deleted = await channel.bulkDelete(amount, true); // true = skip messages >14 days old
  return deleted.size;
}

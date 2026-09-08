import { db } from "./db.js";
import { checkPermission } from "./utils/permissions.js";
import { COLORS, EMBED_LIMITS } from "./utils/constants.js";
import { truncate } from "./utils/utils.js";

/**
 * Reaction-role system: an admin posts an embed ("panel") with
 * `/reactionrole post`, then attaches emoji -> role mappings to it with
 * `/reactionrole add`. Mappings can optionally share a `group` name; any
 * two mappings in the same group (even across different panels/messages)
 * are treated as mutually exclusive — reacting to one automatically
 * removes the member's role *and* reaction from any other mapping in that
 * group, so e.g. "Minor" / "18+" behave like a single choice.
 *
 * Two tables back this (see reaction_roles_migration.sql):
 *   reaction_role_messages(message_id, channel_id, guild_id, created_by, created_at)
 *   reaction_roles(id, guild_id, message_id, channel_id, emoji_key,
 *                  emoji_display, role_id, group_name, created_at)
 *
 * emoji_key is what we match incoming reactions against: the emoji's
 * snowflake id for custom emoji, or its unicode/name string otherwise.
 * emoji_display is the original text the admin typed (e.g. "<:vibe:12345>"
 * or "🧒"), kept only so `/reactionrole list` reads nicely.
 */

const MESSAGE_ID_RE = /^\d{17,20}$/;

function parseEmojiInput(raw) {
  const str = String(raw || "").trim();
  if (!str) return null;

  const customMatch = /^<a?:([a-zA-Z0-9_]+):(\d+)>$/.exec(str);
  if (customMatch) {
    return { key: customMatch[2], reactable: str, display: str };
  }

  // Unicode emoji (or anything else) - use the raw text as both the
  // lookup key and what we pass to message.react().
  return { key: str, reactable: str, display: str };
}

function emojiKeyFromReaction(reaction) {
  return reaction.emoji.id || reaction.emoji.name;
}

/** `/reactionrole post` - creates the panel message admins attach mappings to. */
export async function handleReactionRolePost(interaction) {
  const permissionError = checkPermission(
    interaction,
    "MANAGE_REACTION_ROLES",
    "You don't have permission to set up reaction roles.",
  );
  if (permissionError) return permissionError;

  const title = interaction.options.getString("title", true);
  const description =
    interaction.options.getString("description") ||
    "React below to get a role.";
  const targetChannel =
    interaction.options.getChannel("channel") || interaction.channel;

  if (!targetChannel?.isTextBased?.()) {
    return { error: "Pick a text channel for the reaction-role message." };
  }

  let message;
  try {
    message = await targetChannel.send({
      embeds: [
        {
          title: truncate(title, EMBED_LIMITS.TITLE),
          description: truncate(description, EMBED_LIMITS.DESCRIPTION),
          color: COLORS.DEFAULT,
        },
      ],
    });
  } catch (err) {
    return {
      error: `Couldn't post there — check I have Send Messages / Embed Links access. (${err.message})`,
    };
  }

  await db
    .prepare(
      `INSERT INTO reaction_role_messages (message_id, channel_id, guild_id, created_by, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      message.id,
      targetChannel.id,
      interaction.guildId,
      interaction.member?.user?.id || interaction.user?.id,
      new Date().toISOString(),
    )
    .run();

  return {
    success:
      `Reaction-role message posted in <#${targetChannel.id}>.\n` +
      `Message ID: \`${message.id}\`\n` +
      `Now use \`/reactionrole add\` with this ID to attach emoji → role mappings ` +
      `(use the same \`group\` name on mappings that should be mutually exclusive).`,
  };
}

/** `/reactionrole add` - attaches one emoji -> role mapping to a panel. */
export async function handleReactionRoleAdd(interaction) {
  const permissionError = checkPermission(
    interaction,
    "MANAGE_REACTION_ROLES",
    "You don't have permission to set up reaction roles.",
  );
  if (permissionError) return permissionError;

  const messageId = interaction.options.getString("message_id", true).trim();
  const emojiRaw = interaction.options.getString("emoji", true);
  const role = interaction.options.getRole("role", true);
  const group = interaction.options.getString("group") || null;

  if (!MESSAGE_ID_RE.test(messageId)) {
    return { error: "That doesn't look like a valid message ID." };
  }

  const emoji = parseEmojiInput(emojiRaw);
  if (!emoji) return { error: "Couldn't parse that emoji." };

  const { results: msgRows } = await db
    .prepare(
      `SELECT channel_id FROM reaction_role_messages WHERE message_id = ? AND guild_id = ?`,
    )
    .bind(messageId, interaction.guildId)
    .all();

  if (!msgRows.length) {
    return {
      error: `No reaction-role message found with ID \`${messageId}\`. Create one first with \`/reactionrole post\`.`,
    };
  }

  const channelId = msgRows[0].channel_id;
  const channel = await interaction.guild.channels
    .fetch(channelId)
    .catch(() => null);
  if (!channel) {
    return { error: "Couldn't find the channel for that message anymore." };
  }

  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) {
    return { error: "Couldn't find that message anymore." };
  }

  if (role.managed || role.id === interaction.guildId) {
    return {
      error:
        "That role can't be assigned (it's managed by an integration, or it's @everyone).",
    };
  }

  const botMember = interaction.guild.members.me;
  if (botMember && role.position >= botMember.roles.highest.position) {
    return {
      error: `My highest role needs to be above **${role.name}** for me to assign it. Move my role up in Server Settings → Roles.`,
    };
  }

  try {
    await db
      .prepare(
        `INSERT INTO reaction_roles
         (guild_id, message_id, channel_id, emoji_key, emoji_display, role_id, group_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        interaction.guildId,
        messageId,
        channelId,
        emoji.key,
        emoji.display,
        role.id,
        group,
        new Date().toISOString(),
      )
      .run();
  } catch (err) {
    return {
      error: `That emoji is already mapped on this message, or something went wrong: ${err.message}`,
    };
  }

  try {
    await message.react(emoji.reactable);
  } catch (err) {
    console.error("Failed to react with configured emoji:", err.message);
    return {
      error: `Mapping saved, but I couldn't add the reaction myself (${err.message}). Make sure I can see/use that emoji and have Add Reactions permission, or react to the message manually.`,
    };
  }

  return {
    success: `Mapped ${emojiRaw} → <@&${role.id}>${
      group ? ` (exclusive group \`${group}\`)` : ""
    } on message \`${messageId}\`.`,
  };
}

/** `/reactionrole remove` - deletes one mapping from a panel. */
export async function handleReactionRoleRemove(interaction) {
  const permissionError = checkPermission(
    interaction,
    "MANAGE_REACTION_ROLES",
    "You don't have permission to manage reaction roles.",
  );
  if (permissionError) return permissionError;

  const messageId = interaction.options.getString("message_id", true).trim();
  const emojiRaw = interaction.options.getString("emoji", true);
  const emoji = parseEmojiInput(emojiRaw);
  if (!emoji) return { error: "Couldn't parse that emoji." };

  const result = await db
    .prepare(
      `DELETE FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji_key = ?`,
    )
    .bind(interaction.guildId, messageId, emoji.key)
    .run();

  if (!result.meta?.changes) {
    return { error: "No mapping found for that emoji on that message." };
  }

  return {
    success: `Removed the mapping for ${emojiRaw} on message \`${messageId}\`. (The old reaction on the message itself isn't auto-removed — feel free to clear it manually.)`,
  };
}

/** `/reactionrole list` - shows every mapping on a panel. */
export async function handleReactionRoleList(interaction) {
  const messageId = interaction.options.getString("message_id", true).trim();

  const { results } = await db
    .prepare(
      `SELECT emoji_display, role_id, group_name FROM reaction_roles WHERE guild_id = ? AND message_id = ?`,
    )
    .bind(interaction.guildId, messageId)
    .all();

  if (!results.length) {
    return { success: "No reaction-role mappings on that message." };
  }

  const lines = results.map(
    (r) =>
      `${r.emoji_display} → <@&${r.role_id}>${
        r.group_name ? ` _(group: ${r.group_name})_` : ""
      }`,
  );

  return { success: lines.join("\n") };
}

/**
 * Fired for every messageReactionAdd, not just tracked ones — bails out
 * fast via a DB lookup when the message/emoji isn't a configured mapping.
 */
export async function handleReactionRoleAddEvent(reaction, user) {
  if (user.bot) return;

  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
    if (user.partial) await user.fetch();
  } catch (err) {
    console.error("Failed to fetch partial reaction data:", err.message);
    return;
  }

  const message = reaction.message;
  if (!message.guildId) return; // ignore DMs

  const emojiKey = emojiKeyFromReaction(reaction);

  const { results } = await db
    .prepare(
      `SELECT * FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji_key = ?`,
    )
    .bind(message.guildId, message.id, emojiKey)
    .all();

  const entry = results[0];
  if (!entry) return; // reaction on a tracked panel but no mapping for this emoji

  const guild =
    message.guild ||
    (await reaction.client.guilds.fetch(message.guildId).catch(() => null));
  if (!guild) return;

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return;

  try {
    await member.roles.add(entry.role_id);
  } catch (err) {
    console.error(`Failed to add reaction role ${entry.role_id}:`, err.message);
  }

  if (!entry.group_name) return;

  const { results: groupRows } = await db
    .prepare(
      `SELECT * FROM reaction_roles WHERE guild_id = ? AND group_name = ? AND id != ?`,
    )
    .bind(message.guildId, entry.group_name, entry.id)
    .all();

  for (const row of groupRows) {
    if (!member.roles.cache.has(row.role_id)) continue;

    try {
      await member.roles.remove(row.role_id);
    } catch (err) {
      console.error(
        `Failed to remove exclusive-group role ${row.role_id}:`,
        err.message,
      );
    }

    try {
      const otherMessage =
        row.message_id === message.id
          ? message
          : await (
              await guild.channels.fetch(row.channel_id)
            ).messages.fetch(row.message_id);

      const otherReaction =
        otherMessage.reactions.cache.get(row.emoji_key) ||
        otherMessage.reactions.cache.find(
          (r) => (r.emoji.id || r.emoji.name) === row.emoji_key,
        );

      if (otherReaction) await otherReaction.users.remove(user.id);
    } catch (err) {
      console.error(
        "Failed to clear old reaction during exclusive-group swap:",
        err.message,
      );
    }
  }
}

/** Fired for every messageReactionRemove; removes the matching role, if any. */
export async function handleReactionRoleRemoveEvent(reaction, user) {
  if (user.bot) return;

  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
    if (user.partial) await user.fetch();
  } catch (err) {
    console.error("Failed to fetch partial reaction data:", err.message);
    return;
  }

  const message = reaction.message;
  if (!message.guildId) return;

  const emojiKey = emojiKeyFromReaction(reaction);

  const { results } = await db
    .prepare(
      `SELECT * FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji_key = ?`,
    )
    .bind(message.guildId, message.id, emojiKey)
    .all();

  const entry = results[0];
  if (!entry) return;

  const guild =
    message.guild ||
    (await reaction.client.guilds.fetch(message.guildId).catch(() => null));
  if (!guild) return;

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return;

  try {
    await member.roles.remove(entry.role_id);
  } catch (err) {
    console.error(
      `Failed to remove reaction role ${entry.role_id}:`,
      err.message,
    );
  }
}

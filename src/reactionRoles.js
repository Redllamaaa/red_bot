import { db } from "./db.js";
import { checkPermission } from "./utils/permissions.js";
import { COLORS, EMBED_LIMITS } from "./utils/constants.js";
import { truncate } from "./utils/utils.js";

const MESSAGE_ID_RE = /^\d{17,20}$/;
const CAPTURE_TIMEOUT_MS = 60_000;

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

/** Same shape as parseEmojiInput, but built from a discord.js Emoji object
 * (i.e. from an actual reaction) rather than typed text. */
function emojiInfoFromReactionEmoji(emoji) {
  if (emoji.id) {
    const display = `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
    return { key: emoji.id, reactable: emoji.id, display };
  }
  return { key: emoji.name, reactable: emoji.name, display: emoji.name };
}

function emojiKeyFromReaction(reaction) {
  return reaction.emoji.id || reaction.emoji.name;
}

function findCachedReaction(message, emojiKey) {
  return (
    message.reactions.cache.get(emojiKey) ||
    message.reactions.cache.find(
      (r) => (r.emoji.id || r.emoji.name) === emojiKey,
    )
  );
}

async function captureEmojiReaction(interaction, message) {
  const adminId = interaction.member?.user?.id || interaction.user?.id;

  await interaction.editReply({
    embeds: [
      {
        title: "Waiting for your reaction…",
        description: `React to [the target message](${message.url}) with the emoji you want to use for this role. You have 60 seconds.`,
        color: COLORS.DEFAULT,
      },
    ],
  });

  const collected = await message
    .awaitReactions({
      filter: (reaction, user) => user.id === adminId,
      max: 1,
      time: CAPTURE_TIMEOUT_MS,
      errors: ["time"],
    })
    .catch(() => null);

  if (!collected || !collected.size) return null;

  const reaction = collected.first();
  const emoji = emojiInfoFromReactionEmoji(reaction.emoji);

  await reaction.users.remove(adminId).catch(() => {});

  return emoji;
}

async function fetchPanelMessage(interaction, messageId) {
  if (!MESSAGE_ID_RE.test(messageId)) {
    return { error: "That doesn't look like a valid message ID." };
  }

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

  return { channel, message };
}

/** Builds the "emoji → role" list appended to the panel embed itself. */
async function buildMappingsBlock(guildId, messageId) {
  const { results } = await db
    .prepare(
      `SELECT emoji_display, role_id, group_name FROM reaction_roles WHERE guild_id = ? AND message_id = ?`,
    )
    .bind(guildId, messageId)
    .all();

  if (!results.length) return "";

  const lines = results.map(
    (r) =>
      `${r.emoji_display} → <@&${r.role_id}>${
        r.group_name ? ` _(exclusive: ${r.group_name})_` : ""
      }`,
  );

  return `\n\n**Roles:**\n${lines.join("\n")}`;
}

async function refreshPanelEmbed(interaction, messageId) {
  const { results } = await db
    .prepare(
      `SELECT channel_id, title, description FROM reaction_role_messages WHERE message_id = ? AND guild_id = ?`,
    )
    .bind(messageId, interaction.guildId)
    .all();

  const row = results[0];
  if (!row) return;

  const channel = await interaction.guild.channels
    .fetch(row.channel_id)
    .catch(() => null);
  if (!channel) return;

  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) return;

  const base = row.description || "React below to get a role.";
  const mappingsBlock = await buildMappingsBlock(
    interaction.guildId,
    messageId,
  );

  await message
    .edit({
      embeds: [
        {
          title: truncate(row.title, EMBED_LIMITS.TITLE),
          description: truncate(base + mappingsBlock, EMBED_LIMITS.DESCRIPTION),
          color: COLORS.DEFAULT,
        },
      ],
    })
    .catch((err) =>
      console.error(
        "Failed to refresh reaction-role panel embed:",
        err.message,
      ),
    );
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
      `INSERT INTO reaction_role_messages (message_id, channel_id, guild_id, created_by, created_at, title, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      message.id,
      targetChannel.id,
      interaction.guildId,
      interaction.member?.user?.id || interaction.user?.id,
      new Date().toISOString(),
      title,
      description,
    )
    .run();

  return {
    success:
      `Reaction-role message posted in <#${targetChannel.id}>.\n` +
      `Message ID: \`${message.id}\`\n` +
      `Now use \`/reactionrole add\` with this ID to attach roles ` +
      `(use the same \`group\` name on options that should be mutually exclusive). ` +
      `You'll be asked to react with the emoji you want, so no need to type it.`,
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
  const role = interaction.options.getRole("role", true);
  const group = interaction.options.getString("group") || null;
  const emojiRaw = interaction.options.getString("emoji");

  const panel = await fetchPanelMessage(interaction, messageId);
  if (panel.error) return panel;
  const { channel, message } = panel;

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

  let emoji;
  if (emojiRaw) {
    emoji = parseEmojiInput(emojiRaw);
    if (!emoji) return { error: "Couldn't parse that emoji." };
  } else {
    emoji = await captureEmojiReaction(interaction, message);
    if (!emoji) {
      return {
        error:
          "Didn't see a reaction in time — run `/reactionrole add` again and react within 60 seconds.",
      };
    }
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
        channel.id,
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
      error: `Mapping saved, but I couldn't add the reaction myself (${err.message}). Make sure I have Add Reactions permission, or react to the message manually.`,
    };
  }

  await refreshPanelEmbed(interaction, messageId);

  return {
    success: `Mapped ${emoji.display} → <@&${role.id}>${
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
  const emojiRaw = interaction.options.getString("emoji");

  const panel = await fetchPanelMessage(interaction, messageId);
  if (panel.error) return panel;
  const { message } = panel;

  let emoji;
  if (emojiRaw) {
    emoji = parseEmojiInput(emojiRaw);
    if (!emoji) return { error: "Couldn't parse that emoji." };
  } else {
    emoji = await captureEmojiReaction(interaction, message);
    if (!emoji) {
      return {
        error:
          "Didn't see a reaction in time — run `/reactionrole remove` again and react within 60 seconds.",
      };
    }
  }

  const result = await db
    .prepare(
      `DELETE FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji_key = ?`,
    )
    .bind(interaction.guildId, messageId, emoji.key)
    .run();

  if (!result.meta?.changes) {
    return { error: `No mapping found for ${emoji.display} on that message.` };
  }

  // The mapping is gone, so clear the reaction off the message too (all
  // users, not just the admin's capture click) so it doesn't look active.
  const staleReaction = findCachedReaction(message, emoji.key);
  if (staleReaction) await staleReaction.remove().catch(() => {});

  await refreshPanelEmbed(interaction, messageId);

  return {
    success: `Removed the mapping for ${emoji.display} on message \`${messageId}\`.`,
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

      const otherReaction = findCachedReaction(otherMessage, row.emoji_key);
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

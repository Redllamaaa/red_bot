import { db } from "../db.js";

export async function getLeaveChannel(guildId) {
  const { results } = await db
    .prepare(`SELECT leave_channel_id FROM guild_settings WHERE guild_id = ?`)
    .bind(guildId)
    .all();
  return results[0]?.leave_channel_id || null;
}

export async function setLeaveChannel(guildId, channelId) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO guild_settings (guild_id, leave_channel_id, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(guild_id) DO UPDATE SET
         leave_channel_id = excluded.leave_channel_id,
         updated_at = excluded.updated_at`,
    )
    .bind(guildId, channelId, now)
    .run();
}

export async function clearLeaveChannel(guildId) {
  await db
    .prepare(
      `UPDATE guild_settings SET leave_channel_id = NULL, updated_at = ? WHERE guild_id = ?`,
    )
    .bind(new Date().toISOString(), guildId)
    .run();
}

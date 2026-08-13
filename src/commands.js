import { isWithinActiveWindow, nextWindowStart } from "./scheduling.js";

/** Pulls named options out of a Discord interaction payload into a flat object. */
function optionMap(interaction) {
  const opts = interaction.data?.options || [];
  const map = {};
  for (const o of opts) map[o.name] = o.value;
  return map;
}

/** Parses "3h", "45m", "1d" style durations into minutes. */
function parseDuration(str) {
  const match = /^(\d+)\s*(m|min|mins|h|hr|hrs|hour|hours|d|day|days)$/i.exec(str.trim());
  if (!match) return null;
  const n = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit.startsWith("m")) return n;
  if (unit.startsWith("h")) return n * 60;
  if (unit.startsWith("d")) return n * 60 * 24;
  return null;
}

/** Parses "8-24", "8am-12am", "22-6" style active-hour ranges into {start, end}. */
function parseActiveHours(str) {
  const [a, b] = str.split("-").map((s) => s.trim());
  const parseHour = (s) => {
    const ampm = /am|pm/i.exec(s);
    let h = parseInt(s, 10);
    if (ampm) {
      const isPM = /pm/i.test(s);
      if (isPM && h !== 12) h += 12;
      if (!isPM && h === 12) h = 0;
    }
    return ((h % 24) + 24) % 24;
  };
  return { start: parseHour(a), end: b === "24" || /12am$/i.test(b) && a !== b ? (b.match(/^24$/) ? 24 : parseHour(b)) : parseHour(b) };
}

export async function handleRemindOnce(interaction, env) {
  const opts = optionMap(interaction);
  const fireAt = new Date(opts.time); // expects ISO-ish input; validate below
  if (isNaN(fireAt.getTime())) {
    return { error: "Couldn't parse that time. Try an ISO format like `2026-08-14T15:00:00Z`." };
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO reminders
     (id, guild_id, channel_id, created_by, type, title, message, ping_role_id,
      fire_at, next_eligible_at, enabled)
     VALUES (?, ?, ?, ?, 'once', ?, ?, ?, ?, ?, 1)`
  )
    .bind(
      id,
      interaction.guild_id,
      interaction.channel_id,
      interaction.member?.user?.id || interaction.user?.id,
      opts.title || "Reminder",
      opts.message,
      opts.role || null,
      fireAt.toISOString(),
      fireAt.toISOString()
    )
    .run();

  return { success: `One-off reminder set for <t:${Math.floor(fireAt.getTime() / 1000)}:F>.` };
}

export async function handleRemindRepeat(interaction, env) {
  const opts = optionMap(interaction);
  const intervalMinutes = parseDuration(opts.every);
  if (!intervalMinutes) {
    return { error: "Couldn't parse the interval. Try something like `3h`, `45m`, or `1d`." };
  }

  let activeStart = null;
  let activeEnd = null;
  if (opts.active) {
    const parsed = parseActiveHours(opts.active);
    activeStart = parsed.start;
    activeEnd = parsed.end;
  }

  const id = crypto.randomUUID();
  const timezone = opts.timezone || "UTC";
  const now = new Date();

  const draftReminder = {
    active_hours_start: activeStart,
    active_hours_end: activeEnd,
    timezone,
  };
  const nextEligible = isWithinActiveWindow(draftReminder, now)
    ? now
    : nextWindowStart(draftReminder, now);

  await env.DB.prepare(
    `INSERT INTO reminders
     (id, guild_id, channel_id, created_by, type, title, message, ping_role_id,
      interval_minutes, active_hours_start, active_hours_end, timezone,
      next_eligible_at, enabled)
     VALUES (?, ?, ?, ?, 'repeating', ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  )
    .bind(
      id,
      interaction.guild_id,
      interaction.channel_id,
      interaction.member?.user?.id || interaction.user?.id,
      opts.title || "Reminder",
      opts.message,
      opts.role || null,
      intervalMinutes,
      activeStart,
      activeEnd,
      timezone,
      nextEligible.toISOString()
    )
    .run();

  const windowText =
    activeStart != null ? ` (active ${activeStart}:00-${activeEnd}:00 ${timezone})` : "";
  return {
    success: `Repeating reminder set: every ${opts.every}${windowText}. ID: \`${id}\``,
  };
}

export async function handleRemindList(interaction, env) {
  const { results } = await env.DB.prepare(
    `SELECT id, type, title, interval_minutes, fire_at, active_hours_start, active_hours_end, timezone
     FROM reminders WHERE guild_id = ? AND enabled = 1 ORDER BY rowid DESC LIMIT 20`
  )
    .bind(interaction.guild_id)
    .all();

  if (!results.length) return { success: "No active reminders in this server." };

  const lines = results.map((r) => {
    if (r.type === "once") {
      return `\`${r.id.slice(0, 8)}\` **${r.title}** — once at ${r.fire_at}`;
    }
    const window =
      r.active_hours_start != null
        ? ` (active ${r.active_hours_start}:00-${r.active_hours_end}:00 ${r.timezone})`
        : "";
    return `\`${r.id.slice(0, 8)}\` **${r.title}** — every ${r.interval_minutes}m${window}`;
  });

  return { success: lines.join("\n") };
}

export async function handleRemindDelete(interaction, env) {
  const opts = optionMap(interaction);
  const idPrefix = opts.id;
  const { results } = await env.DB.prepare(
    `SELECT id FROM reminders WHERE guild_id = ? AND id LIKE ? AND enabled = 1`
  )
    .bind(interaction.guild_id, `${idPrefix}%`)
    .all();

  if (!results.length) return { error: `No active reminder found matching \`${idPrefix}\`.` };
  if (results.length > 1) return { error: `Multiple reminders match \`${idPrefix}\`, be more specific.` };

  await env.DB.prepare(`UPDATE reminders SET enabled = 0 WHERE id = ?`)
    .bind(results[0].id)
    .run();

  return { success: `Reminder \`${idPrefix}\` deleted.` };
}

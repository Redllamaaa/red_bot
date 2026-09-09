import { db } from "./db.js";
import { commandRegistry, runFunCommand } from "./commandRegistry.js";
import {
  isWithinActiveWindow,
  nextWindowStart,
  parseNaturalDateTime,
  parseNaturalSchedule,
} from "./scheduling.js";
import { EMBED_LIMITS } from "./utils/constants.js";
import { truncate } from "./utils/utils.js";
import {
  hasAnyRole,
  isUser,
  isAdmin,
  checkPermission,
  ROLE_PERMISSIONS,
} from "./utils/permissions.js";
import {
  resolveUserTimezone,
  isValidTimezone,
  setStoredTimezone,
  clearStoredTimezone,
} from "./utils/timezone.js";
import {
  getLeaveChannel,
  setLeaveChannel,
  clearLeaveChannel,
} from "./utils/guildSettings.js";

/** Pulls named options out of a Discord interaction payload into a flat object. */
function optionMap(interaction) {
  const opts = interaction.data?.options || [];
  const map = {};

  for (const o of opts) {
    map[o.name] = o.value;
  }

  return map;
}

/** Parses "3h", "45m", "1d" style durations into minutes. */
function parseDuration(str) {
  const match =
    /^\s*(\d+)\s*(m|min|mins|h|hr|hrs|hour|hours|d|day|days)\s*$/i.exec(
      String(str || "").trim(),
    );
  if (!match) return null;
  const n = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit.startsWith("m")) return n;
  if (unit.startsWith("h")) return n * 60;
  if (unit.startsWith("d")) return n * 60 * 24;
  return null;
}

function parseActiveHours(str) {
  const parts = String(str || "").split("-");
  if (parts.length !== 2) return null;

  const [a, b] = parts.map((s) => s.trim());
  if (!a || !b) return null;

  const parseHour = (s) => {
    if (/^24$/.test(s)) return 24;
    if (!/^\d{1,2}\s*(am|pm)?$/i.test(s)) return null;

    let h = parseInt(s, 10);
    const isPM = /pm/i.test(s);
    const isAM = /am/i.test(s);
    if (isPM && h !== 12) h += 12;
    if (isAM && h === 12) h = 0;
    if (h < 0 || h > 24) return null;
    return h;
  };

  const start = parseHour(a);
  let end = parseHour(b);
  if (start === null || end === null) return null;

  if (end === 0 && start !== 0) end = 24;

  return { start, end };
}

function appendTimezoneHint(result, isExplicit, timezone) {
  if (isExplicit || !result?.success) return result;
  return {
    ...result,
    success: `${result.success}\n-# Guessed timezone **${timezone}** from your Discord locale — run \`/timezone set\` to set it precisely.`,
  };
}

function parseRepeatingScheduleOptions(opts) {
  const scheduleText = String(opts.every || "").trim();
  const parsedSchedule = parseNaturalSchedule(scheduleText);
  const intervalMinutes =
    parsedSchedule && parsedSchedule.kind === "interval"
      ? parsedSchedule.intervalMinutes
      : parseDuration(scheduleText);

  if (!parsedSchedule && !intervalMinutes) {
    return {
      error:
        "Couldn't parse the schedule. Try something like `every week`, `first monday each month`, `every friday at 20`, `3h`, `45m`, or `1d`.",
    };
  }
  if (
    parsedSchedule?.kind === "interval" &&
    parsedSchedule.intervalMinutes <= 0
  ) {
    return { error: "Schedule interval must be greater than zero." };
  }

  let activeStart = null;
  let activeEnd = null;
  if (opts.active) {
    const parsed = parseActiveHours(opts.active);
    if (!parsed) {
      return {
        error:
          "Couldn't parse the active-hours window. Try something like `8-24`, `8am-12am`, or `22-6`.",
      };
    }
    activeStart = parsed.start;
    activeEnd = parsed.end;
  }

  return {
    scheduleText,
    parsedSchedule,
    intervalMinutes,
    activeStart,
    activeEnd,
  };
}

async function insertRepeatingReminder(
  { guildId, channelId, userId },
  schedule,
  payload,
) {
  const {
    scheduleText,
    parsedSchedule,
    intervalMinutes,
    activeStart,
    activeEnd,
  } = schedule;

  const title = truncate(payload.title, EMBED_LIMITS.TITLE);
  const message = truncate(payload.message ?? "", EMBED_LIMITS.DESCRIPTION);

  const id = crypto.randomUUID();
  const timezone = payload.timezone || "UTC";
  const now = new Date();

  const draftReminder = {
    active_hours_start: activeStart,
    active_hours_end: activeEnd,
    timezone,
    schedule_text: parsedSchedule ? scheduleText : null,
    interval_minutes: intervalMinutes,
  };
  const nextEligible = isWithinActiveWindow(draftReminder, now)
    ? now
    : nextWindowStart(draftReminder, now);

  await db
    .prepare(
      `INSERT INTO reminders
     (id, guild_id, channel_id, created_by, type, title, message, command_name, ping_role_id,
      interval_minutes, schedule_text, active_hours_start, active_hours_end, timezone,
      next_eligible_at, snooze_enabled, enabled)
     VALUES (?, ?, ?, ?, 'repeating', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .bind(
      id,
      guildId,
      channelId,
      userId,
      title,
      message,
      payload.commandName || null,
      payload.role || null,
      intervalMinutes,
      parsedSchedule ? scheduleText : null,
      activeStart,
      activeEnd,
      timezone,
      nextEligible.toISOString(),
      payload.snoozeEnabled ? 1 : 0,
    )
    .run();

  const windowText =
    activeStart != null
      ? ` (active ${activeStart}:00-${activeEnd}:00 ${timezone})`
      : "";

  return { id, scheduleText, windowText };
}

export async function createOnceReminder({
  guildId,
  channelId,
  userId,
  message,
  time,
  title,
  role,
  snooze,
  timezone,
}) {
  const fireAt = parseNaturalDateTime(time, new Date(), timezone || "UTC");
  if (!fireAt) {
    return {
      error:
        "Couldn't parse that time. Try a date like `2026-08-14T15:00:00Z` or a natural phrase like `tomorrow at 9pm`.",
    };
  }

  const id = crypto.randomUUID();
  const finalTitle = truncate(title || "Reminder", EMBED_LIMITS.TITLE);
  const finalMessage = truncate(message, EMBED_LIMITS.DESCRIPTION);

  await db
    .prepare(
      `INSERT INTO reminders
      (id, guild_id, channel_id, created_by, type, title, message, ping_role_id,
      fire_at, next_eligible_at, snooze_enabled, enabled)
      VALUES (?, ?, ?, ?, 'once', ?, ?, ?, ?, ?, ?, 1)`,
    )
    .bind(
      id,
      guildId,
      channelId,
      userId,
      finalTitle,
      finalMessage,
      role || null,
      fireAt.toISOString(),
      fireAt.toISOString(),
      snooze ? 1 : 0,
    )
    .run();

  return {
    success: `One-off reminder set for <t:${Math.floor(fireAt.getTime() / 1000)}:F>.`,
  };
}

export async function createRepeatingReminder({
  guildId,
  channelId,
  userId,
  message,
  every,
  active,
  timezone,
  title,
  role,
  snooze,
}) {
  const schedule = parseRepeatingScheduleOptions({ every, active });
  if (schedule.error) return schedule;

  const { id, scheduleText, windowText } = await insertRepeatingReminder(
    { guildId, channelId, userId },
    schedule,
    {
      title: title || "Reminder",
      message,
      role,
      timezone,
      snoozeEnabled: snooze === true,
    },
  );

  return {
    success: `Repeating reminder set: ${scheduleText}${windowText}. ID: \`${id.slice(0, 8)}\``,
  };
}

export async function createCommandReminder({
  guildId,
  channelId,
  userId,
  commandName,
  every,
  active,
  timezone,
  title,
  role,
}) {
  if (!commandRegistry[commandName]) {
    return { error: `Unknown command \`${commandName}\`.` };
  }

  const schedule = parseRepeatingScheduleOptions({ every, active });
  if (schedule.error) return schedule;

  const { id, scheduleText, windowText } = await insertRepeatingReminder(
    { guildId, channelId, userId },
    schedule,
    {
      title: title || commandName,
      message: "", // message stays NOT NULL-safe; command_name drives the content instead
      commandName,
      role,
      timezone,
      snoozeEnabled: false,
    },
  );

  return {
    success: `Repeating command reminder set: \`${commandName}\` ${scheduleText}${windowText}. ID: \`${id.slice(0, 8)}\``,
  };
}

export async function handleRemindCommand(interaction) {
  const permissionError = checkPermission(
    interaction,
    "MANAGE_REMINDERS",
    "You don't have permission to create repeating reminders.",
  );
  if (permissionError) return permissionError;

  const opts = optionMap(interaction);
  const userId = interaction.member?.user?.id || interaction.user?.id;
  const { timezone, isExplicit } = await resolveUserTimezone(
    userId,
    interaction.locale,
  );

  const result = await createCommandReminder({
    guildId: interaction.guild_id,
    channelId: interaction.channel_id,
    userId,
    commandName: opts.command,
    every: opts.every,
    active: opts.active,
    timezone,
    title: opts.title,
    role: opts.role,
  });

  return appendTimezoneHint(result, isExplicit, timezone);
}

export async function handleRemindOnce(interaction) {
  const opts = optionMap(interaction);
  const userId = interaction.member?.user?.id || interaction.user?.id;
  const { timezone, isExplicit } = await resolveUserTimezone(
    userId,
    interaction.locale,
  );

  const result = await createOnceReminder({
    guildId: interaction.guild_id,
    channelId: interaction.channel_id,
    userId,
    message: opts.message,
    time: opts.time,
    title: opts.title,
    role: opts.role,
    snooze: opts.snooze === true,
    timezone,
  });

  return appendTimezoneHint(result, isExplicit, timezone);
}

export async function handleRemindRepeat(interaction) {
  const permissionError = checkPermission(
    interaction,
    "MANAGE_REMINDERS",
    "You don't have permission to create repeating reminders.",
  );
  if (permissionError) return permissionError;

  const opts = optionMap(interaction);
  const userId = interaction.member?.user?.id || interaction.user?.id;
  const { timezone, isExplicit } = await resolveUserTimezone(
    userId,
    interaction.locale,
  );

  const result = await createRepeatingReminder({
    guildId: interaction.guild_id,
    channelId: interaction.channel_id,
    userId,
    message: opts.message,
    every: opts.every,
    active: opts.active,
    timezone,
    title: opts.title,
    role: opts.role,
    snooze: opts.snooze === true,
  });

  return appendTimezoneHint(result, isExplicit, timezone);
}

export async function handleRemindList(interaction) {
  const { results } = await db
    .prepare(
      `SELECT id, type, title, command_name, interval_minutes, schedule_text, fire_at, active_hours_start, active_hours_end, timezone
     FROM reminders WHERE guild_id = ? AND enabled = 1 ORDER BY rowid DESC LIMIT 20`,
    )
    .bind(interaction.guild_id)
    .all();

  if (!results.length)
    return { success: "No active reminders in this server." };

  const lines = results.map((r) => {
    if (r.type === "once") {
      return `\`${r.id.slice(0, 8)}\` **${r.title}** — once at ${r.fire_at}`;
    }
    const schedule = r.schedule_text || `every ${r.interval_minutes}m`;
    const window =
      r.active_hours_start != null
        ? ` (active ${r.active_hours_start}:00-${r.active_hours_end}:00 ${r.timezone})`
        : "";
    const suffix = r.command_name ? ` [runs \`${r.command_name}\`]` : "";
    return `\`${r.id.slice(0, 8)}\` **${r.title}** — ${schedule}${window}${suffix}`;
  });

  return { success: lines.join("\n") };
}

export async function handleRemindDelete(interaction) {
  const opts = optionMap(interaction);
  const idPrefix = opts.id;

  const escapedPrefix = String(idPrefix || "").replace(/[\\%_]/g, "\\$&");

  const { results } = await db
    .prepare(
      `SELECT id, created_by FROM reminders WHERE guild_id = ? AND id LIKE ? ESCAPE '\\' AND enabled = 1`,
    )
    .bind(interaction.guild_id, `${escapedPrefix}%`)
    .all();

  if (!results.length)
    return { error: `No active reminder found matching \`${idPrefix}\`.` };
  if (results.length > 1)
    return {
      error: `Multiple reminders match \`${idPrefix}\`, be more specific.`,
    };

  const reminder = results[0];
  const requesterId = interaction.member?.user?.id || interaction.user?.id;
  const perm = ROLE_PERMISSIONS.MANAGE_REMINDERS;
  const canManage =
    reminder.created_by === requesterId ||
    hasAnyRole(interaction, perm.roles) ||
    isUser(interaction, perm.users) ||
    (perm.allowAdmin && isAdmin(interaction));
  if (!canManage) {
    return {
      error: "You can only delete reminders you created.",
    };
  }

  await db
    .prepare(`UPDATE reminders SET enabled = 0 WHERE id = ?`)
    .bind(reminder.id)
    .run();

  return { success: `Reminder \`${idPrefix}\` deleted.` };
}

export async function handleTimezoneCommand(interaction) {
  const subcommand = interaction.data?.subcommand;
  const userId = interaction.member?.user?.id || interaction.user?.id;

  if (subcommand === "set") {
    const opts = optionMap(interaction);
    const tz = String(opts.timezone || "").trim();
    if (!isValidTimezone(tz)) {
      return {
        error: `\`${tz}\` isn't a recognized IANA timezone. Try something like \`America/New_York\` or \`Europe/London\`.`,
      };
    }
    await setStoredTimezone(userId, tz);
    return {
      success: `Your timezone is now set to **${tz}**. It'll be used for all your reminders.`,
    };
  }

  if (subcommand === "view") {
    const { timezone, isExplicit } = await resolveUserTimezone(
      userId,
      interaction.locale,
    );
    return {
      success: isExplicit
        ? `Your timezone is set to **${timezone}**.`
        : `You haven't set a timezone yet — currently guessing **${timezone}** from your Discord locale. Run \`/timezone set\` to set it precisely.`,
    };
  }

  if (subcommand === "clear") {
    await clearStoredTimezone(userId);
    return {
      success:
        "Your saved timezone was cleared. Reminders will fall back to a guess based on your Discord locale.",
    };
  }

  return { error: "Unknown timezone command." };
}

export async function handleFunCommand(commandName) {
  return runFunCommand(commandName);
}

function parseBirthdayDate(input) {
  if (!input || typeof input !== "string") {
    return null;
  }

  const match = /^(\d{1,2})[/-](\d{1,2})$/.exec(input.trim());

  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);

  if (month < 1 || month > 12) {
    return null;
  }

  const daysInMonth = new Date(Date.UTC(2000, month, 0)).getUTCDate();

  if (day < 1 || day > daysInMonth) {
    return null;
  }

  return {
    month,
    day,
  };
}

function formatBirthdayDate(month, day) {
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2000, month - 1, day)));
}

export async function handleBirthdaySet(interaction) {
  const permissionError = checkPermission(
    interaction,
    "MANAGE_BIRTHDAYS",
    "You don't have permission to manage birthday reminders.",
  );

  if (permissionError) return permissionError;

  const opts = optionMap(interaction);
  const date = parseBirthdayDate(opts.date);

  if (!date) {
    return {
      error: "Invalid birthday date. Use `DD/MM`, for example `18/08`.",
    };
  }

  const guildId = interaction.guild_id;
  const userId = opts.user || interaction.user?.id;
  const channelId = opts.channel || interaction.channel_id;
  const roleId = opts.role || null;

  if (!guildId) {
    return {
      error: "This command can only be used inside a server.",
    };
  }

  if (!userId) {
    return {
      error: "A birthday user is required.",
    };
  }

  if (!channelId) {
    return {
      error: "A channel is required.",
    };
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO birthdays (
        id,
        guild_id,
        user_id,
        channel_id,
        month,
        day,
        role_id,
        enabled,
        last_sent_year,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)
      ON CONFLICT(guild_id, user_id)
      DO UPDATE SET
        channel_id = excluded.channel_id,
        month = excluded.month,
        day = excluded.day,
        role_id = excluded.role_id,
        enabled = 1,
        updated_at = excluded.updated_at`,
    )
    .bind(
      id,
      guildId,
      userId,
      channelId,
      date.month,
      date.day,
      roleId,
      now,
      now,
    )
    .run();

  return {
    success: `Birthday reminder set for <@${userId}> on ${formatBirthdayDate(
      date.month,
      date.day,
    )}. It will be sent at **10:00 UTC**.`,
  };
}

export async function handleBirthdayDelete(interaction) {
  const permissionError = checkPermission(
    interaction,
    "MANAGE_BIRTHDAYS",
    "You don't have permission to manage birthday reminders.",
  );

  if (permissionError) return permissionError;

  const opts = optionMap(interaction);

  const guildId = interaction.guild_id;
  const userId = opts.user;

  if (!guildId) {
    return {
      error: "This command can only be used inside a server.",
    };
  }

  if (!userId) {
    return {
      error: "A user is required.",
    };
  }

  const result = await db
    .prepare(
      `DELETE FROM birthdays
       WHERE guild_id = ?
         AND user_id = ?`,
    )
    .bind(guildId, userId)
    .run();

  if (!result.meta?.changes) {
    return {
      error: `No birthday reminder exists for <@${userId}>.`,
    };
  }

  return {
    success: `Birthday reminder deleted for <@${userId}>.`,
  };
}

export async function handleBirthdayList(interaction) {
  const guildId = interaction.guild_id;

  if (!guildId) {
    return {
      error: "This command can only be used inside a server.",
    };
  }

  const { results } = await db
    .prepare(
      `SELECT *
       FROM birthdays
       WHERE guild_id = ?
         AND enabled = 1
       ORDER BY month ASC, day ASC`,
    )
    .bind(guildId)
    .all();

  if (!results.length) {
    return {
      success: "There are no birthday reminders configured.",
    };
  }

  const lines = results.map((birthday) => {
    const date = formatBirthdayDate(birthday.month, birthday.day);

    return `🎂 **${date}** — <@${birthday.user_id}>`;
  });

  return {
    success: lines.join("\n"),
  };
}

export async function handleBirthdayCommand(interaction) {
  const subcommand = interaction.data?.subcommand;

  switch (subcommand) {
    case "set":
      return handleBirthdaySet(interaction);

    case "delete":
      return handleBirthdayDelete(interaction);

    case "list":
      return handleBirthdayList(interaction);

    default:
      return {
        error: "Unknown birthday command.",
      };
  }
}

export async function handleLeaveMessageCommand(interaction) {
  if (!isAdmin(interaction)) {
    return { error: "You need Administrator permission to manage this." };
  }

  const subcommand = interaction.data?.subcommand;
  const guildId = interaction.guild_id;

  if (subcommand === "set") {
    const opts = optionMap(interaction);
    if (!opts.channel) return { error: "A channel is required." };
    await setLeaveChannel(guildId, opts.channel);
    return {
      success: `Leave messages will now be sent in <#${opts.channel}>.`,
    };
  }

  if (subcommand === "view") {
    const channelId = await getLeaveChannel(guildId);
    return channelId
      ? { success: `Leave messages are currently sent in <#${channelId}>.` }
      : { success: "No leave-message channel is configured." };
  }

  if (subcommand === "clear") {
    await clearLeaveChannel(guildId);
    return { success: "Leave messages are now disabled." };
  }

  return { error: "Unknown leavemessage command." };
}

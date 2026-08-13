/**
 * Returns the local hour (0-23) for a given UTC instant in the given IANA
 * timezone, using the built-in Intl API (no extra deps needed).
 */
function localHour(date, timezone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone || "UTC",
    hour: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const hourPart = parts.find((p) => p.type === "hour").value;
  // Intl can return "24" for midnight in hour12:false in some environments; normalize.
  return Number(hourPart) % 24;
}

const weekdays = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

function parseClockTime(hourText, minuteText, ampm) {
  let hour = Number.parseInt(hourText, 10);
  const minute = minuteText ? Number.parseInt(minuteText, 10) : 0;

  if (Number.isNaN(hour)) return null;
  if (ampm) {
    const isPM = /pm/i.test(ampm);
    if (isPM && hour !== 12) hour += 12;
    if (!isPM && hour === 12) hour = 0;
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function parseNaturalDateTime(input, now = new Date()) {
  if (!input || typeof input !== "string") return null;
  const text = input.trim();
  if (!text) return null;

  const isoDate = new Date(text);
  if (!Number.isNaN(isoDate.getTime())) return isoDate;

  const lower = text.toLowerCase();
  const inMatch = /^in\s+(\d+)\s*(minute|minutes|min|m|hour|hours|hr|h|day|days|d|week|weeks|wk)$/i.exec(lower);
  if (inMatch) {
    const amount = Number(inMatch[1]);
    const unit = inMatch[2].toLowerCase();
    const multiplier = unit.startsWith("m") ? 1 : unit.startsWith("h") ? 60 : unit.startsWith("d") ? 60 * 24 : 60 * 24 * 7;
    return new Date(now.getTime() + amount * multiplier * 60000);
  }

  const clockMatch = /^(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next monday|next tuesday|next wednesday|next thursday|next friday|next saturday|next sunday)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(lower);
  if (clockMatch) {
    const dayName = clockMatch[1].toLowerCase();
    const time = parseClockTime(clockMatch[2], clockMatch[3], clockMatch[4]);
    if (!time) return null;

    const base = new Date(now.getTime());
    const dayOffsetMap = {
      today: 0,
      tomorrow: 1,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
      sunday: 0,
      "next monday": 1,
      "next tuesday": 2,
      "next wednesday": 3,
      "next thursday": 4,
      "next friday": 5,
      "next saturday": 6,
      "next sunday": 7,
    };

    let dayOffset = dayOffsetMap[dayName] ?? 0;
    if (dayName === "today") {
      dayOffset = 0;
    } else if (dayName === "tomorrow") {
      dayOffset = 1;
    } else if (dayName.startsWith("next ")) {
      const current = base.getUTCDay();
      const target = weekdays.indexOf(dayName.replace(/^next\s+/, ""));
      const delta = (target - current + 7) % 7 || 7;
      dayOffset = delta;
    } else {
      const current = base.getUTCDay();
      const target = weekdays.indexOf(dayName);
      let delta = (target - current + 7) % 7;
      if (delta === 0) delta = 7;
      dayOffset = delta;
    }

    const candidate = new Date(base);
    candidate.setUTCDate(base.getUTCDate() + dayOffset);
    candidate.setUTCHours(time.hour, time.minute, 0, 0);
    return candidate;
  }

  return null;
}

function parseIntervalPart(input) {
  const match = /^every\s+(\d+)\s*(minute|minutes|min|m|hour|hours|hr|h|day|days|d|week|weeks|wk|month|months|mo|year|years|yr)s?$/i.exec(input.trim());
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const minuteMap = {
    m: 1,
    min: 1,
    minute: 1,
    minutes: 1,
    h: 60,
    hr: 60,
    hour: 60,
    hours: 60,
    d: 60 * 24,
    day: 60 * 24,
    days: 60 * 24,
    w: 60 * 24 * 7,
    wk: 60 * 24 * 7,
    week: 60 * 24 * 7,
    weeks: 60 * 24 * 7,
    mo: 60 * 24 * 30,
    month: 60 * 24 * 30,
    months: 60 * 24 * 30,
    yr: 60 * 24 * 365,
    year: 60 * 24 * 365,
    years: 60 * 24 * 365,
  };

  const multiplier = minuteMap[unit];
  if (!multiplier) return null;
  return { kind: "interval", intervalMinutes: amount * multiplier };
}

function parseWeekdaySchedule(input) {
  const match = /^every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/i.exec(input.trim());
  if (!match) return null;

  const weekday = match[1].toLowerCase();
  const time = parseClockTime(match[2] || "9", match[3] || "0", match[4] || null);
  if (!time) return null;

  return { kind: "weekday", weekday, hour: time.hour, minute: time.minute };
}

function parseMonthlySchedule(input) {
  const match = /^(?:the\s+)?(first|second|third|fourth|fifth|last)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:each\s+)?month(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/i.exec(input.trim());
  if (!match) return null;

  const ordinalMap = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, last: -1 };
  const time = parseClockTime(match[3] || "9", match[4] || "0", match[5] || null);
  if (!time) return null;

  return {
    kind: "monthly",
    ordinal: ordinalMap[match[1].toLowerCase()],
    weekday: match[2].toLowerCase(),
    hour: time.hour,
    minute: time.minute,
  };
}

export function parseNaturalSchedule(input, now = new Date()) {
  if (!input || typeof input !== "string") return null;
  const text = input.trim();
  if (!text) return null;

  const lower = text.toLowerCase();
  if (/^every\s+(day|daily|days)$/i.test(text)) {
    return { kind: "daily", hour: 9, minute: 0 };
  }
  if (/^every\s+week$/i.test(text) || /^weekly$/i.test(text)) {
    return { kind: "interval", intervalMinutes: 7 * 24 * 60 };
  }
  if (/^every\s+month$/i.test(text) || /^monthly$/i.test(text)) {
    return { kind: "interval", intervalMinutes: 30 * 24 * 60 };
  }

  const intervalSchedule = parseIntervalPart(text);
  if (intervalSchedule) return intervalSchedule;

  const weekdaySchedule = parseWeekdaySchedule(text);
  if (weekdaySchedule) return weekdaySchedule;

  const monthlySchedule = parseMonthlySchedule(text);
  if (monthlySchedule) return monthlySchedule;

  const directDay = /^every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.exec(text);
  if (directDay) {
    return parseWeekdaySchedule(`every ${directDay[1]} at 9:00`);
  }

  const relative = /^every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(text);
  if (relative) {
    return parseWeekdaySchedule(text);
  }

  return null;
}

function nthWeekdayDate(year, monthIndex, weekdayName, ordinal) {
  const targetIndex = weekdays.indexOf(weekdayName.toLowerCase());
  const firstOfMonth = new Date(Date.UTC(year, monthIndex, 1));
  const monthDay = firstOfMonth.getUTCDay();
  const offset = (targetIndex - monthDay + 7) % 7;
  const firstTarget = 1 + offset;

  if (ordinal === -1) {
    const monthLength = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const lastDay = monthLength;
    let candidate = lastDay;
    while (new Date(Date.UTC(year, monthIndex, candidate)).getUTCDay() !== targetIndex) {
      candidate -= 1;
    }
    return new Date(Date.UTC(year, monthIndex, candidate));
  }

  const candidateDay = firstTarget + (ordinal - 1) * 7;
  if (candidateDay > new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()) return null;
  return new Date(Date.UTC(year, monthIndex, candidateDay));
}

function nextScheduleOccurrence(schedule, reference) {
  if (!schedule) return null;

  if (schedule.kind === "interval") {
    return new Date(reference.getTime() + schedule.intervalMinutes * 60000);
  }

  if (schedule.kind === "daily") {
    const candidate = new Date(reference.getTime());
    candidate.setUTCSeconds(0, 0);
    candidate.setUTCHours(schedule.hour, schedule.minute, 0, 0);
    if (candidate <= reference) {
      candidate.setUTCDate(candidate.getUTCDate() + 1);
    }
    return candidate;
  }

  if (schedule.kind === "weekday") {
    const weekdayIndex = weekdays.indexOf(schedule.weekday.toLowerCase());
    const candidate = new Date(reference.getTime());
    candidate.setUTCSeconds(0, 0);
    candidate.setUTCHours(schedule.hour, schedule.minute, 0, 0);
    const daysUntil = (weekdayIndex - candidate.getUTCDay() + 7) % 7;
    candidate.setUTCDate(candidate.getUTCDate() + (daysUntil === 0 && candidate <= reference ? 7 : daysUntil));
    if (candidate <= reference) candidate.setUTCDate(candidate.getUTCDate() + 7);
    return candidate;
  }

  if (schedule.kind === "monthly") {
    const target = weekdays.indexOf(schedule.weekday.toLowerCase());
    const startMonth = new Date(reference.getTime());
    for (let i = 0; i < 24; i++) {
      const year = startMonth.getUTCFullYear();
      const monthIndex = startMonth.getUTCMonth() + i;
      const monthDate = nthWeekdayDate(
        new Date(Date.UTC(year, monthIndex, 1)).getUTCFullYear(),
        new Date(Date.UTC(year, monthIndex, 1)).getUTCMonth(),
        weekdays[target],
        schedule.ordinal
      );
      if (!monthDate) continue;
      const candidate = new Date(monthDate.getTime());
      candidate.setUTCHours(schedule.hour, schedule.minute, 0, 0);
      if (candidate > reference) return candidate;
    }
    return new Date(reference.getTime() + 30 * 24 * 60 * 60000);
  }

  return null;
}

/**
 * Checks whether `now` falls inside the reminder's allowed active window.
 * Window is [active_hours_start, active_hours_end), e.g. start=8, end=24
 * means "active from 8am up to (not including) midnight" — i.e. blocked
 * from 12am-8am. Handles windows that don't wrap and windows that do
 * (e.g. start=22, end=6 for "10pm to 6am").
 */
export function isWithinActiveWindow(reminder, now) {
  if (reminder.active_hours_start == null || reminder.active_hours_end == null) {
    return true; // no restriction configured
  }
  const hour = localHour(now, reminder.timezone);
  const { active_hours_start: start, active_hours_end: end } = reminder;

  if (start === end) return true; // degenerate config, treat as always active
  if (start < end) {
    return hour >= start && hour < end;
  }
  // wrapping window, e.g. 22 -> 6
  return hour >= start || hour < end;
}

/**
 * Given a reminder currently outside its active window, computes the next
 * UTC instant at which its window opens. Walks forward hour by hour, which
 * is cheap since windows are at most 24h and this only runs when a
 * reminder is skipped.
 */
export function nextWindowStart(reminder, now) {
  const probe = new Date(now.getTime());
  probe.setUTCSeconds(0, 0);
  // Step minute-by-minute for up to 25 hours (1500 minutes) so we don't
  // miss the exact window-open minute even across a full day's wrap.
  for (let i = 0; i < 25 * 60; i++) {
    probe.setUTCMinutes(probe.getUTCMinutes() + 1);
    if (isWithinActiveWindow(reminder, probe)) {
      return probe;
    }
  }
  // fallback: shouldn't happen, but avoid an infinite-skip reminder
  return new Date(now.getTime() + 60 * 60 * 1000);
}

/**
 * Computes the next_eligible_at for a repeating reminder after it fires,
 * respecting the active window (skips forward if the plain interval would
 * land outside it).
 */
export function computeNextEligible(reminder, now) {
  const parsed = reminder.schedule_text ? parseNaturalSchedule(reminder.schedule_text, now) : null;
  if (parsed) {
    const candidate = nextScheduleOccurrence(parsed, now);
    if (candidate) {
      const next = isWithinActiveWindow(reminder, candidate) ? candidate : nextWindowStart(reminder, candidate);
      return next;
    }
  }

  const intervalMinutes = reminder.interval_minutes ?? 0;
  const naive = new Date(now.getTime() + intervalMinutes * 60000);
  if (isWithinActiveWindow(reminder, naive)) return naive;
  return nextWindowStart(reminder, naive);
}

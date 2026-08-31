/**
 * Returns the local hour (0-23) for a given UTC instant in the given IANA
 * timezone, using the built-in Intl API (no extra deps needed).
 */

const formatterCache = new Map();
function getFormatter(timezone) {
  const tz = timezone || "UTC";
  let fmt = formatterCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    });
    formatterCache.set(tz, fmt);
  }
  return fmt;
}

function localHour(date, timezone) {
  const parts = getFormatter(timezone).formatToParts(date);
  const hourPart = parts.find((p) => p.type === "hour").value;
  return Number(hourPart) % 24;
}

/**
 * Returns the UTC calendar (year, 0-based month, day) that a given instant
 * falls on when viewed in `timeZone`.
 */
const dateFmtCache = new Map();
function localDateParts(date, timeZone) {
  const tz = timeZone || "UTC";
  let fmt = dateFmtCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dateFmtCache.set(tz, fmt);
  }
  const parts = fmt.formatToParts(date);
  const map = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month) - 1,
    day: Number(map.day),
  };
}

/** Returns the local weekday index (0=Sunday..6=Saturday) of `date` in `timeZone`. */
const weekdayFmtCache = new Map();
function localWeekday(date, timeZone) {
  const tz = timeZone || "UTC";
  let fmt = weekdayFmtCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
    weekdayFmtCache.set(tz, fmt);
  }
  const short = fmt.format(date).toLowerCase().slice(0, 3);
  const map = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  return map[short];
}

/**
 * Offset (ms) such that `instant + offset` gives the same wall-clock
 * numbers in `timeZone` as `instant` does in UTC. Positive for zones ahead
 * of UTC.
 */
function getTimeZoneOffsetMs(instant, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(instant);
  const map = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour) === 24 ? 0 : Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - instant.getTime();
}

/**
 * Converts a "wall clock" date/time (year, 0-based month, day, hour,
 * minute) meant as local time in `timeZone` into the corresponding UTC
 * Date instant. This is the inverse of formatting a Date in that timezone.
 */
function zonedTimeToUtc(year, month, day, hour, minute, timeZone) {
  const wallAsUtcMs = Date.UTC(year, month, day, hour, minute, 0, 0);
  let t = wallAsUtcMs;
  // Two passes converge even right around a DST transition.
  for (let i = 0; i < 2; i++) {
    const offset = getTimeZoneOffsetMs(new Date(t), timeZone);
    t = wallAsUtcMs - offset;
  }
  return new Date(t);
}

/**
 * Builds the UTC instant for `hour:minute` local time in `timeZone`, on the
 * calendar day that is `dayOffset` days after the local calendar day of
 * `reference`.
 */
function localDateTimeToUtc(reference, timeZone, hour, minute, dayOffset = 0) {
  const { year, month, day } = localDateParts(reference, timeZone);
  const base = new Date(Date.UTC(year, month, day));
  base.setUTCDate(base.getUTCDate() + dayOffset);
  return zonedTimeToUtc(
    base.getUTCFullYear(),
    base.getUTCMonth(),
    base.getUTCDate(),
    hour,
    minute,
    timeZone,
  );
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
  const inMatch =
    /^in\s+(\d+)\s*(minute|minutes|min|m|hour|hours|hr|h|day|days|d|week|weeks|wk)$/i.exec(
      lower,
    );
  if (inMatch) {
    const amount = Number(inMatch[1]);
    const unit = inMatch[2].toLowerCase();
    const multiplier = unit.startsWith("m")
      ? 1
      : unit.startsWith("h")
        ? 60
        : unit.startsWith("d")
          ? 60 * 24
          : 60 * 24 * 7;
    return new Date(now.getTime() + amount * multiplier * 60000);
  }

  const clockMatch =
    /^(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next monday|next tuesday|next wednesday|next thursday|next friday|next saturday|next sunday)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(
      lower,
    );
  if (clockMatch) {
    const dayName = clockMatch[1].toLowerCase();
    const time = parseClockTime(clockMatch[2], clockMatch[3], clockMatch[4]);
    if (!time) return null;

    const base = new Date(now.getTime());
    let dayOffset;

    if (dayName === "today") {
      dayOffset = 0;
    } else if (dayName === "tomorrow") {
      dayOffset = 1;
    } else {
      // Plain weekday ("monday") and "next monday" resolve the same way:
      // the next upcoming occurrence of that weekday, always at least a
      // day away (so naming today's weekday means "in 7 days", not
      // "today" — use "today"/"tomorrow" for that).
      const targetName = dayName.replace(/^next\s+/, "");
      const current = base.getUTCDay();
      const target = weekdays.indexOf(targetName);
      dayOffset = (target - current + 7) % 7 || 7;
    }

    const candidate = new Date(base);
    candidate.setUTCDate(base.getUTCDate() + dayOffset);
    candidate.setUTCHours(time.hour, time.minute, 0, 0);
    return candidate;
  }

  return null;
}

const MONTH_UNITS = new Set(["mo", "month", "months"]);
const YEAR_UNITS = new Set(["yr", "year", "years"]);

function parseIntervalPart(input) {
  const match =
    /^every\s+(\d+)\s*(minute|minutes|min|m|hour|hours|hr|h|day|days|d|week|weeks|wk|month|months|mo|year|years|yr)s?$/i.exec(
      input.trim(),
    );
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();

  // Months and years aren't fixed-length durations. Stepping them as a
  // constant number of minutes (30 days, 365 days) drifts against the
  // calendar over time — a reminder anchored to "the 1st of the month"
  // slowly wanders to the 2nd, 3rd, etc. Step by actual calendar
  // months/years instead (handled in nextScheduleOccurrence) so it stays
  // pinned to the same day.
  if (MONTH_UNITS.has(unit)) {
    return { kind: "monthlyInterval", months: amount };
  }
  if (YEAR_UNITS.has(unit)) {
    return { kind: "yearlyInterval", years: amount };
  }

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
  };

  const multiplier = minuteMap[unit];
  if (!multiplier) return null;
  return { kind: "interval", intervalMinutes: amount * multiplier };
}

function parseWeekdaySchedule(input) {
  const match =
    /^every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/i.exec(
      input.trim(),
    );
  if (!match) return null;

  const weekday = match[1].toLowerCase();
  const time = parseClockTime(
    match[2] || "11",
    match[3] || "0",
    match[4] || null,
  );
  if (!time) return null;

  return { kind: "weekday", weekday, hour: time.hour, minute: time.minute };
}

function parseMonthlySchedule(input) {
  const match =
    /^(?:the\s+)?(first|second|third|fourth|fifth|last)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:each\s+)?month(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/i.exec(
      input.trim(),
    );
  if (!match) return null;

  const ordinalMap = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    last: -1,
  };
  const time = parseClockTime(
    match[3] || "11",
    match[4] || "0",
    match[5] || null,
  );
  if (!time) return null;

  return {
    kind: "monthly",
    ordinal: ordinalMap[match[1].toLowerCase()],
    weekday: match[2].toLowerCase(),
    hour: time.hour,
    minute: time.minute,
  };
}

export function parseNaturalSchedule(input) {
  if (!input || typeof input !== "string") return null;
  const text = input.trim();
  if (!text) return null;

  const lower = text.toLowerCase();
  if (/^every\s+(day|daily|days)$/i.test(text)) {
    return { kind: "daily", hour: 11, minute: 0 };
  }
  if (/^every\s+week$/i.test(text) || /^weekly$/i.test(text)) {
    return { kind: "interval", intervalMinutes: 7 * 24 * 60 };
  }
  if (/^every\s+month$/i.test(text) || /^monthly$/i.test(text)) {
    return { kind: "monthlyInterval", months: 1 };
  }

  const intervalSchedule = parseIntervalPart(text);
  if (intervalSchedule) return intervalSchedule;

  const weekdaySchedule = parseWeekdaySchedule(text);
  if (weekdaySchedule) return weekdaySchedule;

  const monthlySchedule = parseMonthlySchedule(text);
  if (monthlySchedule) return monthlySchedule;

  const directDay =
    /^every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.exec(
      text,
    );
  if (directDay) {
    return parseWeekdaySchedule(`every ${directDay[1]} at 11:00`);
  }

  const relative =
    /^every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(
      text,
    );
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
    const monthLength = new Date(
      Date.UTC(year, monthIndex + 1, 0),
    ).getUTCDate();
    const lastDay = monthLength;
    let candidate = lastDay;
    while (
      new Date(Date.UTC(year, monthIndex, candidate)).getUTCDay() !==
      targetIndex
    ) {
      candidate -= 1;
    }
    return new Date(Date.UTC(year, monthIndex, candidate));
  }

  const candidateDay = firstTarget + (ordinal - 1) * 7;
  if (candidateDay > new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate())
    return null;
  return new Date(Date.UTC(year, monthIndex, candidateDay));
}

function nextScheduleOccurrence(schedule, reference) {
  if (!schedule) return null;

  if (schedule.kind === "interval") {
    return new Date(reference.getTime() + schedule.intervalMinutes * 60000);
  }

  if (schedule.kind === "monthlyInterval") {
    const candidate = new Date(reference.getTime());
    candidate.setUTCMonth(candidate.getUTCMonth() + schedule.months);
    return candidate;
  }

  if (schedule.kind === "yearlyInterval") {
    const candidate = new Date(reference.getTime());
    candidate.setUTCFullYear(candidate.getUTCFullYear() + schedule.years);
    return candidate;
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
    candidate.setUTCDate(
      candidate.getUTCDate() +
        (daysUntil === 0 && candidate <= reference ? 7 : daysUntil),
    );
    if (candidate <= reference)
      candidate.setUTCDate(candidate.getUTCDate() + 7);
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
        schedule.ordinal,
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
  if (
    reminder.active_hours_start == null ||
    reminder.active_hours_end == null
  ) {
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
  for (let i = 0; i < 25; i++) {
    probe.setUTCMinutes(probe.getUTCMinutes() + 60);
    if (isWithinActiveWindow(reminder, probe)) {
      return probe;
    }
  }
  return new Date(now.getTime() + 60 * 60 * 1000);
}

/**
 * Computes the next_eligible_at for a repeating reminder after it fires,
 * respecting the active window (skips forward if the plain interval would
 * land outside it).
 */
export function computeNextEligible(reminder, now) {
  const parsed = reminder.schedule_text
    ? parseNaturalSchedule(reminder.schedule_text)
    : null;
  if (parsed) {
    const candidate = nextScheduleOccurrence(parsed, now);
    if (candidate) {
      const next = isWithinActiveWindow(reminder, candidate)
        ? candidate
        : nextWindowStart(reminder, candidate);
      return next;
    }
  }

  const intervalMinutes = reminder.interval_minutes ?? 0;
  const naive = new Date(now.getTime() + intervalMinutes * 60000);
  if (isWithinActiveWindow(reminder, naive)) return naive;
  return nextWindowStart(reminder, naive);
}

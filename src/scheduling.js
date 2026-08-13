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
  const naive = new Date(now.getTime() + reminder.interval_minutes * 60000);
  if (isWithinActiveWindow(reminder, naive)) return naive;
  return nextWindowStart(reminder, naive);
}

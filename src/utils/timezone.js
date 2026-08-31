import { db } from "../db.js";

/**
 * Best-guess default timezone per Discord client locale, used only until
 * the user runs `/timezone set`. Several locales span multiple real-world
 * zones (en-US, es-419, pt-BR, zh-CN...) so these are a single reasonable
 * default, not a precise lookup.
 */
export const LOCALE_TIMEZONE_DEFAULTS = {
  "en-US": "America/New_York",
  "en-GB": "Europe/London",
  id: "Asia/Jakarta",
  da: "Europe/Copenhagen",
  de: "Europe/Berlin",
  "es-ES": "Europe/Madrid",
  "es-419": "America/Mexico_City",
  fr: "Europe/Paris",
  hr: "Europe/Zagreb",
  it: "Europe/Rome",
  lt: "Europe/Vilnius",
  hu: "Europe/Budapest",
  nl: "Europe/Amsterdam",
  no: "Europe/Oslo",
  pl: "Europe/Warsaw",
  "pt-BR": "America/Sao_Paulo",
  ro: "Europe/Bucharest",
  fi: "Europe/Helsinki",
  "sv-SE": "Europe/Stockholm",
  vi: "Asia/Ho_Chi_Minh",
  tr: "Europe/Istanbul",
  cs: "Europe/Prague",
  el: "Europe/Athens",
  bg: "Europe/Sofia",
  ru: "Europe/Moscow",
  uk: "Europe/Kyiv",
  hi: "Asia/Kolkata",
  th: "Asia/Bangkok",
  "zh-CN": "Asia/Shanghai",
  "zh-TW": "Asia/Taipei",
  ja: "Asia/Tokyo",
  ko: "Asia/Seoul",
};

export function isValidTimezone(tz) {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function localeDefaultTimezone(locale) {
  return LOCALE_TIMEZONE_DEFAULTS[locale] || "UTC";
}

export async function getStoredTimezone(userId) {
  const { results } = await db
    .prepare(`SELECT timezone FROM user_settings WHERE user_id = ?`)
    .bind(userId)
    .all();
  return results[0]?.timezone || null;
}

export async function setStoredTimezone(userId, timezone) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO user_settings (user_id, timezone, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         timezone = excluded.timezone,
         updated_at = excluded.updated_at`,
    )
    .bind(userId, timezone, now)
    .run();
}

export async function clearStoredTimezone(userId) {
  await db
    .prepare(`DELETE FROM user_settings WHERE user_id = ?`)
    .bind(userId)
    .run();
}

/**
 * Resolves the timezone to use for a user: an explicit `/timezone set`
 * value if present, otherwise a best-guess default from their Discord
 * client locale, otherwise UTC. `isExplicit` lets callers nudge the user
 * toward `/timezone set` when we're only guessing.
 */
export async function resolveUserTimezone(userId, locale) {
  const stored = await getStoredTimezone(userId);
  if (stored) return { timezone: stored, isExplicit: true };
  return { timezone: localeDefaultTimezone(locale), isExplicit: false };
}

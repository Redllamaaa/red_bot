DROP TABLE IF EXISTS reminders;

CREATE TABLE reminders (
  id                 TEXT PRIMARY KEY,
  guild_id           TEXT NOT NULL,
  channel_id         TEXT NOT NULL,
  created_by         TEXT NOT NULL,

  type               TEXT NOT NULL,             -- 'once' | 'repeating'
  title              TEXT NOT NULL,
  message            TEXT NOT NULL,
  ping_role_id       TEXT,                      -- nullable, role to @-mention

  -- repeating-only fields
  interval_minutes   INTEGER,                   -- e.g. 180 for every 3 hours
  schedule_text      TEXT,                      -- natural-language schedule, e.g. 'every week'
  active_hours_start INTEGER,                   -- 0-23, inclusive window start
  active_hours_end   INTEGER,                   -- 0-24, exclusive window end
  timezone           TEXT DEFAULT 'UTC',         -- IANA tz, e.g. 'America/New_York'

  -- once-only field
  fire_at            TEXT,                       -- ISO timestamp

  last_sent_at       TEXT,
  next_eligible_at   TEXT NOT NULL,               -- indexed lookup for the cron job
  enabled            INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_reminders_due ON reminders (enabled, next_eligible_at);
CREATE INDEX idx_reminders_guild ON reminders (guild_id);




CREATE TABLE birthdays (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,

    month INTEGER NOT NULL,
    day INTEGER NOT NULL,

    role_id TEXT,

    enabled INTEGER NOT NULL DEFAULT 1,
    last_sent_year INTEGER,

    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    UNIQUE (guild_id, user_id)
);

CREATE INDEX idx_birthdays_date
ON birthdays (month, day, enabled);
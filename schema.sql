CREATE TABLE IF NOT EXISTS reminders (
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
  command_name       TEXT,                        -- registered fun command for command reminders
  snooze_enabled     INTEGER NOT NULL DEFAULT 0,
  monthly_anchor_day INTEGER,

  -- once-only field
  fire_at            TEXT,                       -- ISO timestamp

  last_sent_at       TEXT,
  next_eligible_at   TEXT NOT NULL,               -- indexed lookup for the cron job
  processing_token   TEXT,
  processing_until   TEXT,
  enabled            INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders (enabled, next_eligible_at);
CREATE INDEX IF NOT EXISTS idx_reminders_guild ON reminders (guild_id);

CREATE TABLE IF NOT EXISTS birthdays (
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

CREATE INDEX IF NOT EXISTS idx_birthdays_date
ON birthdays (month, day, enabled);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id    TEXT PRIMARY KEY,
  timezone   TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id         TEXT PRIMARY KEY,
  leave_channel_id TEXT,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reaction_role_messages (
  message_id  TEXT PRIMARY KEY,
  channel_id  TEXT NOT NULL,
  guild_id    TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT
);

CREATE INDEX IF NOT EXISTS idx_reaction_role_messages_guild
ON reaction_role_messages (guild_id, message_id);

CREATE TABLE IF NOT EXISTS reaction_roles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL,
  message_id    TEXT NOT NULL,
  channel_id    TEXT NOT NULL,
  emoji_key     TEXT NOT NULL,
  emoji_display TEXT NOT NULL,
  role_id       TEXT NOT NULL,
  group_name    TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE (guild_id, message_id, emoji_key)
);

CREATE INDEX IF NOT EXISTS idx_reaction_roles_message
ON reaction_roles (guild_id, message_id);

CREATE INDEX IF NOT EXISTS idx_reaction_roles_group
ON reaction_roles (guild_id, group_name);

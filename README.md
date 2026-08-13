# hydro-bot

A Discord reminder bot that runs entirely on Cloudflare Workers: slash
commands via an Interactions endpoint, reminder storage in D1, and a Cron
Trigger that checks every minute for due reminders — one-off or recurring,
with optional "active hours" windows (e.g. hydration pings every 3 hours,
skipped overnight).

## How it works

- `src/index.js` — the Worker's two entry points:
  - `fetch` handles Discord's HTTP interaction webhooks (slash commands)
  - `scheduled` runs every minute (cron) and fires any due reminders
- `src/commands.js` — parses `/remind` subcommands and writes rows to D1
- `src/scheduling.js` — active-window math (is now inside the allowed
  hours? when does the window next open?)
- `src/discord.js` — signature verification + sending messages via the bot
  token
- `schema.sql` — the `reminders` table

## One-time setup

1. **Create a Discord application** at https://discord.com/developers/applications,
   add a bot to it, and invite it to your server with the `bot` and
   `applications.commands` scopes, plus `Send Messages` / `Mention Everyone`
   (for role pings) permissions.

2. **Install dependencies**
   ```
   npm install
   ```

3. **Create the D1 database**
   ```
   npx wrangler d1 create hydro-bot-db
   ```
   Copy the `database_id` it prints into `wrangler.toml`.

4. **Run the schema migration**
   ```
   npm run db:migrate:remote
   ```
   (use `db:migrate:local` while iterating with `wrangler dev`)

5. **Set secrets**
   ```
   npx wrangler secret put DISCORD_TOKEN
   npx wrangler secret put DISCORD_PUBLIC_KEY
   ```
   Both values are on your application's page in the Discord Developer
   Portal (Bot > Token, and General Information > Public Key).

6. **Deploy**
   ```
   npm run deploy
   ```
   This gives you a `*.workers.dev` URL.

7. **Set the Interactions Endpoint URL** on your Discord application's
   General Information page to your deployed Worker URL. Discord will send
   a test PING immediately — the `fetch` handler already responds to it.

8. **Register the slash commands**
   ```
   DISCORD_TOKEN=your_bot_token DISCORD_APPLICATION_ID=your_app_id node register-commands.js
   ```
   Global commands can take up to an hour to show up; see the comment in
   `register-commands.js` for a guild-scoped option that's instant, handy
   while testing.

## Usage examples

Hydration reminder, every 3 hours, skipped midnight-8am, Eastern time:
```
/remind repeat message:Drink some water! every:3h active:8-24 timezone:America/New_York title:💧 Hydration Check role:@Hydrate
```

One-off reminder:
```
/remind once message:Submit the report time:2026-08-14T15:00:00Z
```

List / delete:
```
/remind list
/remind delete id:3f9a2b1c
```

## Notes & things to adjust for your own use

- `time` for `/remind once` currently expects an ISO timestamp
  (`2026-08-14T15:00:00Z`). A natural-language parser (e.g. `chrono-node`)
  is a nice upgrade if you want to type things like "tomorrow at 3pm" — it
  runs fine in the Workers runtime.
- `active` windows are parsed as `start-end` in 24h or `8am-12am` style;
  see `parseActiveHours` in `src/commands.js` if you want to support more
  formats.
- The cron runs every minute and grabs up to 100 due reminders per tick —
  raise the `LIMIT` in `processDueReminders` if you expect more scale.
- Sending is done via the bot token so embeds + role pings both work. If
  you'd rather avoid storing a bot token, you could switch to a webhook,
  but you'd lose reliable role-ping support.

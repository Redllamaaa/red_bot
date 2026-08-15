/**
 * Run once (and again whenever you change command definitions):
 *   DISCORD_TOKEN=... DISCORD_APPLICATION_ID=... node register-commands.js
 *
 * Registers commands globally. Global commands can take up to an hour to
 * propagate; for instant testing during development, register per-guild
 * instead (swap the URL below for
 * /applications/{app_id}/guilds/{guild_id}/commands).
 */

import { commandRegistry, commandChoices } from "./src/commandRegistry.js"; // adjust path to match your project layout

const APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
const TOKEN = process.env.DISCORD_TOKEN;

if (!APPLICATION_ID || !TOKEN) {
  console.error("Set DISCORD_APPLICATION_ID and DISCORD_TOKEN env vars first.");
  process.exit(1);
}

// Human-friendly descriptions for each fun command. Falls back to a generic
// description if a name isn't listed here, so new commandRegistry entries
// don't need to be added twice.
const FUN_COMMAND_DESCRIPTIONS = {
  compliment: "Get a random compliment",
  fortune: "Get a random fortune",
  funfact: "Get a random fun fact",
  pizzaidea: "Get a random pizza topping idea",
  lifetruth: "Get a random life truth",
  thought: "Get a random thought",
};

// One slash command per entry in commandRegistry (compliment, fortune, etc.)
const funCommands = Object.keys(commandRegistry).map((name) => ({
  name,
  description: FUN_COMMAND_DESCRIPTIONS[name] || `Get a random ${name}`,
}));

const commands = [
  ...funCommands,
  {
    name: "remind",
    description: "Manage reminders",
    options: [
      {
        type: 1, // SUB_COMMAND
        name: "once",
        description: "Set a one-off reminder",
        options: [
          {
            type: 3,
            name: "message",
            description: "Reminder text",
            required: true,
          },
          {
            type: 3,
            name: "time",
            description:
              "When to fire, e.g. 2026-08-14T15:00:00Z or tomorrow at 9pm",
            required: true,
          },
          {
            type: 3,
            name: "title",
            description: "Embed title (default: Reminder)",
            required: false,
          },
          {
            type: 8,
            name: "role",
            description: "Role to ping (defaults to you if omitted)",
            required: false,
          },
        ],
      },
      {
        type: 1,
        name: "repeat",
        description: "Set a recurring reminder",
        options: [
          {
            type: 3,
            name: "message",
            description: "Reminder text",
            required: true,
          },
          {
            type: 3,
            name: "every",
            description:
              "Schedule, e.g. every week, first monday each month, every friday at 20, or 3h",
            required: true,
          },
          {
            type: 3,
            name: "active",
            description: "Active hour window, e.g. 8-24 (blocks 12am-8am)",
            required: false,
          },
          {
            type: 3,
            name: "timezone",
            description:
              "IANA timezone for the active window, e.g. America/New_York",
            required: false,
          },
          {
            type: 3,
            name: "title",
            description: "Embed title (default: Reminder)",
            required: false,
          },
          {
            type: 8,
            name: "role",
            description: "Role to ping (defaults to you if omitted)",
            required: false,
          },
        ],
      },
      {
        type: 1,
        name: "command",
        description: "Run a registered command on a repeating schedule",
        options: [
          {
            type: 3,
            name: "command",
            description: "Which command to run",
            required: true,
            choices: commandChoices, // compliment, fortune, funfact, etc.
          },
          {
            type: 3,
            name: "every",
            description:
              "Schedule, e.g. every week, first monday each month, every friday at 20, or 3h",
            required: true,
          },
          {
            type: 3,
            name: "active",
            description: "Active hour window, e.g. 8-24 (blocks 12am-8am)",
            required: false,
          },
          {
            type: 3,
            name: "timezone",
            description:
              "IANA timezone for the active window, e.g. America/New_York",
            required: false,
          },
          {
            type: 3,
            name: "title",
            description: "Embed title (default: the command name)",
            required: false,
          },
          {
            type: 8,
            name: "role",
            description: "Role to ping (defaults to you if omitted)",
            required: false,
          },
        ],
      },
      {
        type: 1,
        name: "list",
        description: "List active reminders in this server",
      },
      {
        type: 1,
        name: "delete",
        description: "Delete a reminder by ID",
        options: [
          { type: 3, name: "id", description: "Reminder ID", required: true },
        ],
      },
    ],
  },
];

const res = await fetch(
  `https://discord.com/api/v10/applications/${APPLICATION_ID}/commands`,
  {
    method: "PUT",
    headers: {
      Authorization: `Bot ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  },
);

if (!res.ok) {
  console.error(`Failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}

console.log("Commands registered successfully.");

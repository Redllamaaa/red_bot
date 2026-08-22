/**
 * Run once (and again whenever you change command definitions):
 * node --env-file=.env register-commands.js
 */

import { commandRegistry, commandChoices } from "./src/commandRegistry.js";

const APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
const TOKEN = process.env.DISCORD_TOKEN;

if (!APPLICATION_ID || !TOKEN) {
  console.error("Set DISCORD_APPLICATION_ID and DISCORD_TOKEN env vars first.");
  process.exit(1);
}

// Human-friendly descriptions for each fun command.
const FUN_COMMAND_DESCRIPTIONS = {
  compliment: "Get a random compliment",
  fortune: "Get a random fortune",
  funfact: "Get a random fun fact",
  pizzaidea: "Get a random pizza topping idea",
  lifetruth: "Get a random life truth",
  thought: "Get a random thought",
};

// One slash command per entry in commandRegistry.
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
            type: 5,
            name: "snooze",
            description: "Allow this reminder to be snoozed for 1 hour",
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
            type: 5,
            name: "snooze",
            description: "Allow this reminder to be snoozed for 1 hour",
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
            choices: commandChoices,
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
          {
            type: 3,
            name: "id",
            description: "Reminder ID",
            required: true,
          },
        ],
      },
    ],
  },

  {
    name: "birthday",
    description: "Manage birthday reminders",
    options: [
      {
        type: 1, // SUB_COMMAND
        name: "set",
        description: "Set a birthday reminder",
        options: [
          {
            type: 6, // USER
            name: "user",
            description: "User whose birthday this is",
            required: true,
          },
          {
            type: 3, // STRING
            name: "date",
            description: "Birthday date in DD/MM format",
            required: true,
          },
          {
            type: 7, // CHANNEL
            name: "channel",
            description: "Channel to send the birthday message in",
            required: true,
            channel_types: [0], // GUILD_TEXT
          },
          {
            type: 8, // ROLE
            name: "role",
            description: "Role to mention with the birthday message",
            required: false,
          },
        ],
      },

      {
        type: 1, // SUB_COMMAND
        name: "delete",
        description: "Delete a birthday reminder",
        options: [
          {
            type: 6, // USER
            name: "user",
            description: "User whose birthday reminder to delete",
            required: true,
          },
        ],
      },

      {
        type: 1, // SUB_COMMAND
        name: "list",
        description: "List birthday reminders",
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

import { commandRegistry, commandChoices } from "./src/commandRegistry.js";

// Human-friendly descriptions for each fun command.
const FUN_COMMAND_DESCRIPTIONS = {
  compliment: "Get a random compliment",
  fortune: "Get a random fortune",
  funfact: "Get a random fun fact",
  pizzaidea: "Get a random pizza topping idea",
  lifetruth: "Get a random life truth",
  thought: "Get a random thought",
};

function buildCommands() {
  // One slash command per entry in commandRegistry.
  const funCommands = Object.keys(commandRegistry).map((name) => ({
    name,
    description: FUN_COMMAND_DESCRIPTIONS[name] || `Get a random ${name}`,
  }));

  return [
    ...funCommands,

    {
      name: "remind",
      description: "Manage reminders",
      options: [
        {
          type: 1, // SUB_COMMAND
          name: "menu",
          description:
            "Open a guided menu to create a reminder step by step (good for new users)",
        },

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

    {
      name: "timezone",
      description: "Manage your personal timezone for reminders",
      options: [
        {
          type: 1,
          name: "set",
          description: "Set your IANA timezone, e.g. America/New_York",
          options: [
            {
              type: 3,
              name: "timezone",
              description: "IANA timezone name, e.g. Europe/London",
              required: true,
            },
          ],
        },
        {
          type: 1,
          name: "view",
          description: "Show the timezone currently used for your reminders",
        },
        {
          type: 1,
          name: "clear",
          description:
            "Clear your saved timezone (falls back to a guess from your Discord locale)",
        },
      ],
    },
    {
      name: "clear",
      description: "Bulk delete recent messages in this channel",
      options: [
        {
          type: 4, // INTEGER
          name: "amount",
          description: "Number of messages to delete (2-100)",
          required: true,
          min_value: 2,
          max_value: 100,
        },
      ],
    },
  ];
}

/**
 * Bulk-overwrites the application's global slash commands. Callable both
 * as a one-off CLI script (`npm run register`) and from index.js on every
 * boot, so command definitions never drift out of sync with the code.
 */
export async function registerCommands({ applicationId, token } = {}) {
  const APPLICATION_ID = applicationId || process.env.DISCORD_APPLICATION_ID;
  const TOKEN = token || process.env.DISCORD_TOKEN;

  if (!APPLICATION_ID || !TOKEN) {
    throw new Error(
      "Set DISCORD_APPLICATION_ID and DISCORD_TOKEN env vars first.",
    );
  }

  const commands = buildCommands();

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
    const body = await res.text();
    throw new Error(`Command registration failed: ${res.status} ${body}`);
  }

  return commands.length;
}

// Still runnable directly: `node register-commands.js` / `npm run register`.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  try {
    const count = await registerCommands();
    console.log(
      `Commands registered successfully (${count} top-level commands).`,
    );
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

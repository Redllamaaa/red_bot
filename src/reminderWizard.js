import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { commandChoices } from "./commandRegistry.js";
import {
  createOnceReminder,
  createRepeatingReminder,
  createCommandReminder,
} from "./commands.js";
import { checkPermission } from "./utils/permissions.js";
import { COLORS } from "./utils/constants.js";

/**
 * Guided, button/modal-driven alternative to typing `/remind once`,
 * `/remind repeat`, or `/remind command` by hand. Entry point is the
 * `/remind menu` subcommand (wired up in index.js), which shows a type
 * picker; everything after that is component interactions routed here
 * from index.js based on customId prefix ("rw:").
 *
 * Wizard state lives in an in-memory Map keyed by a short session id
 * threaded through every customId (e.g. "rw:confirm:ab12cd34"). This is
 * intentionally not persisted — a wizard session is meant to be finished
 * in a couple of minutes, and if the process restarts mid-wizard the user
 * just gets an "expired" message and starts over.
 */

const SESSION_TTL_MS = 10 * 60 * 1000;
const sessions = new Map();

function createSession(type, interaction) {
  const id = crypto.randomUUID().slice(0, 8);
  const session = {
    id,
    type,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    userId: interaction.member?.user?.id || interaction.user?.id,
    data: {},
    createdAt: Date.now(),
  };
  sessions.set(id, session);
  return session;
}

function getSession(id) {
  const session = sessions.get(id);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(id);
    return null;
  }
  return session;
}

// Periodic sweep so abandoned sessions don't accumulate forever.
const cleanupTimer = setInterval(
  () => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.createdAt > SESSION_TTL_MS) sessions.delete(id);
    }
  },
  5 * 60 * 1000,
);
cleanupTimer.unref?.();

function expiredMessage() {
  return {
    embeds: [
      {
        title: "Session expired",
        description: "This wizard session expired. Run `/remind menu` again.",
        color: COLORS.ERROR,
      },
    ],
    components: [],
  };
}

function textRow(customId, label, style, required, value, placeholder) {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(style)
    .setRequired(required);
  if (value) input.setValue(value);
  if (placeholder) input.setPlaceholder(placeholder);
  return new ActionRowBuilder().addComponents(input);
}

function buildDetailsModal(type, sessionId) {
  const modal = new ModalBuilder()
    .setCustomId(`rw:modal:${type}:${sessionId}`)
    .setTitle("Reminder details");

  const rows = [];

  if (type === "once") {
    rows.push(
      textRow(
        "message",
        "What should the reminder say?",
        TextInputStyle.Paragraph,
        true,
      ),
    );
    rows.push(
      textRow(
        "time",
        "When? (e.g. tomorrow at 9pm)",
        TextInputStyle.Short,
        true,
      ),
    );
    rows.push(
      textRow("title", "Embed title (optional)", TextInputStyle.Short, false),
    );
  } else if (type === "repeat") {
    rows.push(
      textRow(
        "message",
        "What should the reminder say?",
        TextInputStyle.Paragraph,
        true,
      ),
    );
    rows.push(
      textRow(
        "every",
        "Schedule",
        TextInputStyle.Short,
        true,
        null,
        "e.g. every week, every friday at 20, 3h",
      ),
    );
    rows.push(
      textRow(
        "active",
        "Active hours, e.g. 8-24 (optional)",
        TextInputStyle.Short,
        false,
      ),
    );
    rows.push(
      textRow(
        "timezone",
        "Timezone (optional)",
        TextInputStyle.Short,
        false,
        null,
        "e.g. America/New_York",
      ),
    );
    rows.push(
      textRow("title", "Embed title (optional)", TextInputStyle.Short, false),
    );
  } else if (type === "command") {
    rows.push(
      textRow(
        "every",
        "Schedule",
        TextInputStyle.Short,
        true,
        null,
        "e.g. every week, every friday at 20, 3h",
      ),
    );
    rows.push(
      textRow(
        "active",
        "Active hours, e.g. 8-24 (optional)",
        TextInputStyle.Short,
        false,
      ),
    );
    rows.push(
      textRow(
        "timezone",
        "Timezone (optional)",
        TextInputStyle.Short,
        false,
        null,
        "e.g. America/New_York",
      ),
    );
    rows.push(
      textRow(
        "title",
        "Embed title (optional)",
        TextInputStyle.Short,
        false,
        null,
        "Default: the command name",
      ),
    );
  }

  modal.addComponents(rows);
  return modal;
}

/**
 * Builds the "review before you confirm" message: a summary embed plus
 * role/snooze pickers and confirm/cancel buttons. Re-rendered (via
 * interaction.update) every time a select menu changes so the summary
 * always reflects current choices.
 */
function buildReviewMessage(session) {
  const { id, type, data } = session;

  const lines = [];
  if (type === "once") {
    lines.push(`**Message:** ${data.message || "_not set_"}`);
    lines.push(`**Time:** ${data.time || "_not set_"}`);
  } else if (type === "repeat") {
    lines.push(`**Message:** ${data.message || "_not set_"}`);
    lines.push(`**Schedule:** ${data.every || "_not set_"}`);
    if (data.active) lines.push(`**Active hours:** ${data.active}`);
    if (data.timezone) lines.push(`**Timezone:** ${data.timezone}`);
  } else if (type === "command") {
    lines.push(`**Command:** \`${data.commandName}\``);
    lines.push(`**Schedule:** ${data.every || "_not set_"}`);
    if (data.active) lines.push(`**Active hours:** ${data.active}`);
    if (data.timezone) lines.push(`**Timezone:** ${data.timezone}`);
  }
  if (data.title) lines.push(`**Title:** ${data.title}`);
  lines.push(`**Ping:** ${data.roleId ? `<@&${data.roleId}>` : "you"}`);
  if (type !== "command") {
    lines.push(`**Snooze button:** ${data.snooze ? "Yes" : "No"}`);
  }

  const components = [
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(`rw:role:${id}`)
        .setPlaceholder("Optional: role to ping (default: you)")
        .setMinValues(0)
        .setMaxValues(1),
    ),
  ];

  if (type !== "command") {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`rw:snooze:${id}`)
          .setPlaceholder("Allow this reminder to be snoozed?")
          .addOptions(
            { label: "No snooze button", value: "no", default: !data.snooze },
            {
              label: "Add a snooze button",
              value: "yes",
              default: !!data.snooze,
            },
          ),
      ),
    );
  }

  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`rw:confirm:${id}`)
        .setLabel("Create Reminder")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`rw:cancel:${id}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Danger),
    ),
  );

  return {
    embeds: [
      {
        title: "Review your reminder",
        description: lines.join("\n"),
        color: COLORS.DEFAULT,
      },
    ],
    components,
  };
}

/** Entry point: `/remind menu` shows this after the command defers. */
export async function sendReminderTypeMenu(interaction) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("rw:type:once")
      .setLabel("One-off reminder")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("rw:type:repeat")
      .setLabel("Repeating reminder")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("rw:type:command")
      .setLabel("Scheduled command")
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.editReply({
    embeds: [
      {
        title: "Create a Reminder",
        description:
          "Pick the kind of reminder you'd like to set up, and I'll walk you through the rest.\n\n" +
          "-# Prefer typing it directly? Use `/remind once`, `/remind repeat`, or `/remind command`.",
        color: COLORS.DEFAULT,
      },
    ],
    components: [row],
  });
}

async function startWizardType(interaction, type) {
  if (type === "repeat" || type === "command") {
    const permissionError = checkPermission(
      interaction,
      "MANAGE_REMINDERS",
      "You don't have permission to create repeating reminders.",
    );
    if (permissionError) {
      return interaction.reply({
        content: permissionError.error,
        ephemeral: true,
      });
    }
  }

  const session = createSession(type, interaction);

  if (type === "command") {
    // The command name comes from a fixed list, so collect it with a
    // select menu instead of a modal text field.
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`rw:cmd:${session.id}`)
        .setPlaceholder("Choose a command to run on schedule")
        .addOptions(
          commandChoices.map((c) => ({ label: c.name, value: c.value })),
        ),
    );
    return interaction.reply({
      content: "Which command should run on a schedule?",
      components: [row],
      ephemeral: true,
    });
  }

  return interaction.showModal(buildDetailsModal(type, session.id));
}

async function finalizeWizard(interaction, sessionId) {
  const session = getSession(sessionId);
  if (!session) {
    return interaction.update(expiredMessage());
  }

  await interaction.deferUpdate();

  const { type, data, guildId, channelId, userId } = session;
  let result;

  if (type === "once") {
    result = await createOnceReminder({
      guildId,
      channelId,
      userId,
      message: data.message,
      time: data.time,
      title: data.title,
      role: data.roleId,
      snooze: !!data.snooze,
    });
  } else if (type === "repeat") {
    result = await createRepeatingReminder({
      guildId,
      channelId,
      userId,
      message: data.message,
      every: data.every,
      active: data.active,
      timezone: data.timezone,
      title: data.title,
      role: data.roleId,
      snooze: !!data.snooze,
    });
  } else if (type === "command") {
    result = await createCommandReminder({
      guildId,
      channelId,
      userId,
      commandName: data.commandName,
      every: data.every,
      active: data.active,
      timezone: data.timezone,
      title: data.title,
      role: data.roleId,
    });
  }

  sessions.delete(sessionId);

  const isError = Boolean(result?.error);
  await interaction.editReply({
    embeds: [
      {
        title: isError ? "Error" : "Reminder Created",
        description:
          result?.success || result?.error || "Something went wrong.",
        color: isError ? COLORS.ERROR : COLORS.DEFAULT,
      },
    ],
    components: [],
  });
}

/** Routes `rw:*` button interactions (type picker, confirm, cancel). */
export async function handleWizardButton(interaction) {
  const [, action, arg] = interaction.customId.split(":");

  if (action === "type") {
    return startWizardType(interaction, arg);
  }

  if (action === "confirm") {
    return finalizeWizard(interaction, arg);
  }

  if (action === "cancel") {
    sessions.delete(arg);
    return interaction.update({
      embeds: [
        {
          title: "Cancelled",
          description: "No reminder was created.",
          color: COLORS.DEFAULT,
        },
      ],
      components: [],
    });
  }
}

/** Routes `rw:modal:*` submissions (the "once"/"repeat"/"command" detail forms). */
export async function handleWizardModalSubmit(interaction) {
  const [, , type, sessionId] = interaction.customId.split(":");
  const session = getSession(sessionId);
  if (!session) {
    return interaction.reply({
      content: "This wizard session expired, run `/remind menu` again.",
      ephemeral: true,
    });
  }

  const getField = (fieldId) => {
    try {
      return interaction.fields.getTextInputValue(fieldId);
    } catch {
      return "";
    }
  };

  if (type === "once") {
    session.data.message = getField("message");
    session.data.time = getField("time");
    session.data.title = getField("title") || undefined;
  } else if (type === "repeat") {
    session.data.message = getField("message");
    session.data.every = getField("every");
    session.data.active = getField("active") || undefined;
    session.data.timezone = getField("timezone") || undefined;
    session.data.title = getField("title") || undefined;
  } else if (type === "command") {
    session.data.every = getField("every");
    session.data.active = getField("active") || undefined;
    session.data.timezone = getField("timezone") || undefined;
    session.data.title = getField("title") || undefined;
  }

  await interaction.reply({ ...buildReviewMessage(session), ephemeral: true });
}

/** Routes `rw:*` select-menu interactions (command picker, role picker, snooze picker). */
export async function handleWizardSelectMenu(interaction) {
  const [, action, sessionId] = interaction.customId.split(":");
  const session = getSession(sessionId);
  if (!session) {
    return interaction.update(expiredMessage());
  }

  if (action === "cmd") {
    session.data.commandName = interaction.values[0];
    return interaction.showModal(buildDetailsModal("command", sessionId));
  }

  if (action === "role") {
    session.data.roleId = interaction.values[0] || null;
    return interaction.update(buildReviewMessage(session));
  }

  if (action === "snooze") {
    session.data.snooze = interaction.values[0] === "yes";
    return interaction.update(buildReviewMessage(session));
  }
}

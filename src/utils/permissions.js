import { PermissionsBitField } from "discord.js";

export const ROLE_PERMISSIONS = {
  MANAGE_REMINDERS: {
    roles: [
      process.env.REMINDER_REPEAT_ROLE_ID,
      process.env.REMINDER_REPEAT_ROLE_ID_TOKU,
      process.env.REMINDER_MOD_ID_TOKU,
    ],
    users: ["661140312248549376"],
    allowAdmin: true,
  },
  MANAGE_BIRTHDAYS: {
    roles: [
      process.env.REMINDER_REPEAT_ROLE_ID,
      process.env.REMINDER_MOD_ID_TOKU,
    ],
    users: ["661140312248549376"],
    allowAdmin: true,
  },
};

export function hasRole(interaction, roleId) {
  if (!roleId) return false;
  const roles = interaction.member?.roles;
  if (!roles) return false;
  if (roles.cache) return roles.cache.has(roleId);
  if (Array.isArray(roles)) return roles.includes(roleId);
  return false;
}

export function hasAnyRole(interaction, roleIds = []) {
  return roleIds.filter(Boolean).some((roleId) => hasRole(interaction, roleId));
}

function getUserId(interaction) {
  return interaction.member?.user?.id || interaction.user?.id || null;
}

export function isUser(interaction, userIds = []) {
  const userId = getUserId(interaction);
  if (!userId) return false;
  return userIds.filter(Boolean).includes(userId);
}

export function isAdmin(interaction) {
  const permissions = interaction.member?.permissions;
  if (!permissions) return false;

  if (typeof permissions.has === "function") {
    return permissions.has(PermissionsBitField.Flags.Administrator);
  }
  if (typeof permissions === "string") {
    return (
      (BigInt(permissions) & PermissionsBitField.Flags.Administrator) ===
      PermissionsBitField.Flags.Administrator
    );
  }
  return false;
}

export function checkPermission(interaction, permissionKey, message) {
  const permission = ROLE_PERMISSIONS[permissionKey] || {};

  const allowed =
    hasAnyRole(interaction, permission.roles || []) ||
    isUser(interaction, permission.users || []) ||
    (permission.allowAdmin && isAdmin(interaction));

  if (!allowed) {
    return {
      error: message || "You don't have permission to do that.",
    };
  }

  return null;
}

export function hasRole(interaction, roleId) {
  if (!roleId) return false;
  const roles = interaction.member?.roles;
  if (!roles) return false;
  if (roles.cache) return roles.cache.has(roleId);
  if (Array.isArray(roles)) return roles.includes(roleId);
  return false;
}

export function checkRole(interaction, allowedRoleIds, message) {
  const roles = Array.isArray(allowedRoleIds)
    ? allowedRoleIds
    : [allowedRoleIds];

  if (!roles.some((roleId) => hasRole(interaction, roleId))) {
    return {
      error: message || "You don't have permission to do that.",
    };
  }

  return null;
}

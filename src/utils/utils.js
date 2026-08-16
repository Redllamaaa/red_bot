export function truncate(str, maxLength) {
  if (typeof str !== "string" || str.length <= maxLength) return str;
  return `${str.slice(0, Math.max(0, maxLength - 1))}…`;
}

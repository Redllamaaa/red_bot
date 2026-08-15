// Discord embed colors
export const COLORS = {
  DEFAULT: 0x5865f2, // reminder confirmations
  ERROR: 0xed4245, // Errors
  FUN: 0x9d00ff, // fun-command replies
  REMINDER_SENT: 0x3498db, // reminder messages
};

// Discord's hard limits on embed field lengths.
// https://discord.com/developers/docs/resources/message#embed-object-embed-limits
export const EMBED_LIMITS = {
  TITLE: 256,
  DESCRIPTION: 4096,
  FOOTER_TEXT: 2048,
};

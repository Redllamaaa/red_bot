// Discord embed colors
export const COLORS = {
  DEFAULT: 0xe8e4f0, // reminder confirmations
  ERROR: 0xed4245, // Errors
  FUN: 0xf4d58d, // fun-command replies
  REMINDER_SENT: 0xb8d8e8, // reminder messages
};

// Discord's hard limits on embed field lengths.
// https://discord.com/developers/docs/resources/message#embed-object-embed-limits
export const EMBED_LIMITS = {
  TITLE: 256,
  DESCRIPTION: 4096,
  FOOTER_TEXT: 2048,
};

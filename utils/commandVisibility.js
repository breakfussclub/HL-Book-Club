// utils/commandVisibility.js — Centralized Visibility Rules (Phase 10 HL Book Club)
// ✅ Handles ephemeral (private) vs public command responses
// ✅ Ensures HL Book Club behavior is consistent across modules

// ---------------------------------------------------------------------------
// Private commands — replies are visible only to the user
// ---------------------------------------------------------------------------
const DEFAULT_PRIVATE = [
  "tracker",
  "my-stats",
  "quote",
  "my-quotes",
];

// ---------------------------------------------------------------------------
// Public commands — visible in the channel for social / club engagement
// ---------------------------------------------------------------------------
const DEFAULT_PUBLIC = [
  "search",
  "leaderboard",
  "show-quotes",
  "profile",   // 🆕 Phase 10: public profile view
  "shelf",     // 🆕 Phase 10: public community bookshelf
];

// ---------------------------------------------------------------------------
// Optional overrides for future flexibility
// Example: VISIBILITY_OVERRIDES["profile"] = true // force private
// ---------------------------------------------------------------------------
const VISIBILITY_OVERRIDES = {};

/**
 * Returns true if the command should be ephemeral (private)
 * @param {string} commandName
 * @returns {boolean}
 */
export function isEphemeral(commandName) {
  if (commandName in VISIBILITY_OVERRIDES) {
    return VISIBILITY_OVERRIDES[commandName];
  }

  if (DEFAULT_PUBLIC.includes(commandName)) return false;
  if (DEFAULT_PRIVATE.includes(commandName)) return true;

  // Default to private if unknown (safe fallback)
  return true;
}

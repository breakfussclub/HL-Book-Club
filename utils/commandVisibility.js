// utils/commandVisibility.js — Centralized Visibility Rules
// ✅ Determines if a command's replies should be ephemeral (private)
// ✅ Keeps index.js clean and future-proof

const DEFAULT_PRIVATE = [
  "tracker",
  "my-stats",
  "my-quotes",
  "schedule-add",
  "schedule-remove",
];

// Optional command-specific overrides (for new commands you’ll add later)
const VISIBILITY_OVERRIDES = {
  // example:
  // "profile": true,   // private
  // "leaderboard": false,  // public
};

/**
 * Returns true if the command should be ephemeral (private)
 * @param {string} commandName
 * @returns {boolean}
 */
export function isEphemeral(commandName) {
  if (commandName in VISIBILITY_OVERRIDES) {
    return VISIBILITY_OVERRIDES[commandName];
  }
  return DEFAULT_PRIVATE.includes(commandName);
}

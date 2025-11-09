// utils/commandVisibility.js — Centralized Visibility Rules (Updated)
// ✅ Handles ephemeral (private) vs public command responses
// ✅ Now reads from config.js
// ✅ Includes admin command

import { config } from "../config.js";

// Use config values if available, otherwise fall back to defaults
const DEFAULT_PRIVATE = config.commands?.private || [
  "tracker",
  "my-stats",
  "quote",
  "my-quotes",
  "admin", // Admin command is always private
];

const DEFAULT_PUBLIC = config.commands?.public || [
  "search",
  "leaderboard",
  "show-quotes",
  "profile",
  "shelf",
  "book",
];

// Optional overrides for future flexibility
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

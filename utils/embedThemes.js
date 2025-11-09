// utils/embedThemes.js — Phase 10 HL Book Club (Updated for config.js)
// 🎨 Centralized embed color theme for HL Book Club commands
// ✅ Now reads from config.js for consistency

import { config } from "../config.js";

export const EMBED_THEME = {
  DEFAULT: { color: config.colors.primary },
  HL_BOOK_CLUB: { color: config.colors.primary },
  primary: config.colors.primary,
  gold: config.colors.gold,
  GOLD: config.colors.gold,
  SUCCESS: config.colors.success,
  ERROR: config.colors.error,
  footer: "HL Book Club • Higher-er Learning",
};

// Backward compatibility alias
EMBED_THEME.BOOKCORD = EMBED_THEME.HL_BOOK_CLUB;

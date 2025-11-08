// utils/embedThemes.js — Phase 10 HL Book Club
// 🎨 Centralized embed color theme for HL Book Club commands
// ✅ Simplified — no footer or icon fields

export const EMBED_THEME = {
  DEFAULT: { color: 0x8b5cf6 }, // fallback purple
  HL_BOOK_CLUB: { color: 0x8b5cf6 }, // HL Book Club purple
  GOLD: { color: 0xfbbf24 },
  SUCCESS: { color: 0x22c55e },
  ERROR: { color: 0xef4444 },
};

// Temporary backward compatibility alias (safe to remove later)
EMBED_THEME.BOOKCORD = EMBED_THEME.HL_BOOK_CLUB;

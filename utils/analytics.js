// utils/analytics.js — Phase 8 Modernized
// ✅ Provides appendReadingLog, getUserLogs, calcBookStats
// ✅ Works with new storage.js JSON structure
// ✅ Adds DEBUG logging for Railway
// ✅ Handles missing files gracefully

import { loadJSON, saveJSON, FILES } from "./storage.js";

const DEBUG = process.env.DEBUG === "true";

// ---------------------------------------------------------------------------
// Helper: Format Date
// ---------------------------------------------------------------------------

function shortDate(iso) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// 📘 appendReadingLog
// ---------------------------------------------------------------------------
// Adds a new log entry when user updates progress.
// Structure: logs[userId] = [ { bookId, page, at } ]

export async function appendReadingLog(userId, bookTitle, page) {
  try {
    const logs = await loadJSON(FILES.READING_LOGS);
    if (!logs[userId]) logs[userId] = [];

    logs[userId].push({
      bookId: bookTitle,
      page,
      at: new Date().toISOString(),
    });

    // Keep logs tidy
    if (logs[userId].length > 2000) logs[userId] = logs[userId].slice(-2000);

    await saveJSON(FILES.READING_LOGS, logs);
    if (DEBUG)
      console.log(`[analytics.appendReadingLog] ${userId} → ${bookTitle} (${page})`);
  } catch (err) {
    console.error("[analytics.appendReadingLog]", err);
  }
}

// ---------------------------------------------------------------------------
// 📗 getUserLogs
// ---------------------------------------------------------------------------
// Returns a user’s logs, optionally filtered by book title

export async function getUserLogs(userId, bookTitle = null) {
  try {
    const logs = await loadJSON(FILES.READING_LOGS);
    const arr = logs[userId] || [];
    if (bookTitle)
      return arr.filter((l) =>
        l.bookId.toLowerCase().includes(bookTitle.toLowerCase())
      );
    return arr;
  } catch (err) {
    console.error("[analytics.getUserLogs]", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// 📙 calcBookStats
// ---------------------------------------------------------------------------
// Calculates progress percentage and simple stats for embed display

export function calcBookStats(entry) {
  if (!entry?.totalPages) return "";
  const pct = Math.min(
    100,
    Math.round((entry.currentPage / entry.totalPages) * 100)
  );
  const start = entry.startedAt ? shortDate(entry.startedAt) : "—";
  const last = entry.updatedAt ? shortDate(entry.updatedAt) : "—";

  let msg = `Progress: **${pct}%**`;
  if (entry.currentPage >= entry.totalPages)
    msg += ` ✅ Completed on ${last}`;
  else msg += ` (started ${start}, updated ${last})`;

  return msg;
}

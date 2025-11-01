// utils/analytics.js — Phase 8 Modernized + Compatibility Patch
// ✅ Provides appendReadingLog, getUserLogs, calcBookStats
// ✅ Adds backward-compatibility with Phase 8 tracker (streak / avgPerDay)

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
export async function appendReadingLog(userId, bookId, page) {
  try {
    const logs = await loadJSON(FILES.READING_LOGS);
    if (!logs[userId]) logs[userId] = [];

    logs[userId].push({
      bookId,
      page,
      at: new Date().toISOString(),
    });

    // Keep logs tidy
    if (logs[userId].length > 2000) logs[userId] = logs[userId].slice(-2000);

    await saveJSON(FILES.READING_LOGS, logs);
    if (DEBUG)
      console.log(`[analytics.appendReadingLog] ${userId} → ${bookId} (${page})`);
  } catch (err) {
    console.error("[analytics.appendReadingLog]", err);
  }
}

// ---------------------------------------------------------------------------
// 📗 getUserLogs
// ---------------------------------------------------------------------------
export async function getUserLogs(userId, bookId = null) {
  try {
    const logs = await loadJSON(FILES.READING_LOGS);
    const arr = logs[userId] || [];
    if (bookId)
      return arr.filter((l) =>
        l.bookId.toLowerCase().includes(bookId.toLowerCase())
      );
    return arr;
  } catch (err) {
    console.error("[analytics.getUserLogs]", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// 📙 calcBookStats (Legacy structure expected by tracker.js)
// ---------------------------------------------------------------------------
// Returns an object { streak, avgPerDay } instead of a string

export function calcBookStats(logs, bookId) {
  try {
    const entries = (logs || []).filter((l) => l.bookId === bookId);
    if (!entries.length) return { streak: 0, avgPerDay: 0 };

    const sorted = entries.sort(
      (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
    );

    // --- Calculate streak
    let streak = 1;
    let bestStreak = 1;
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1].at);
      const curr = new Date(sorted[i].at);
      const diff = (curr - prev) / (1000 * 60 * 60 * 24);
      if (diff <= 1.5) streak++;
      else {
        bestStreak = Math.max(bestStreak, streak);
        streak = 1;
      }
    }
    bestStreak = Math.max(bestStreak, streak);

    // --- Calculate average pages per day
    const totalPages = sorted.reduce((sum, l) => sum + Number(l.page || 0), 0);
    const days =
      (new Date(sorted.at(-1).at) - new Date(sorted[0].at)) /
        (1000 * 60 * 60 * 24) || 1;
    const avgPerDay = totalPages / days;

    return { streak: bestStreak, avgPerDay };
  } catch (err) {
    console.error("[analytics.calcBookStats]", err);
    return { streak: 0, avgPerDay: 0 };
  }
}

// ---------------------------------------------------------------------------
// 📒 calcBookStatsSimple (your modern summary version)
// ---------------------------------------------------------------------------

export function calcBookStatsSimple(entry) {
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

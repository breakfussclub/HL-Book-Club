// utils/analytics.js — Bookcord Phase 8
// Handles reading progress logs and analytics calculations

import { loadJSON, saveJSON, FILES } from "./storage.js";

// ===== Record User Progress =====
export async function logProgress(userId, bookId, page) {
  const logs = await loadJSON(FILES.READING_LOGS);
  logs[userId] = logs[userId] || [];
  logs[userId].push({
    bookId,
    page,
    at: new Date().toISOString(),
  });

  // Keep only the latest 500 entries per user
  if (logs[userId].length > 500) logs[userId].shift();

  await saveJSON(FILES.READING_LOGS, logs);
  return true;
}

// ===== Get All Logs for a User =====
export async function getUserLogs(userId) {
  const logs = await loadJSON(FILES.READING_LOGS);
  return logs[userId] || [];
}

// ===== Compute Basic User Analytics =====
export async function getUserAnalytics(userId) {
  const logs = await getUserLogs(userId);
  if (!logs.length) return { totalPages: 0, streak: 0 };

  // total pages read
  let total = 0;
  for (let i = 1; i < logs.length; i++) {
    const a = logs[i - 1];
    const b = logs[i];
    if (a.bookId === b.bookId && b.page > a.page) total += b.page - a.page;
  }

  // simple reading streak
  const days = [...new Set(logs.map(l => l.at.slice(0, 10)))].sort();
  let streak = 1;
  let maxStreak = 1;
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1]);
    const curr = new Date(days[i]);
    const diff = (curr - prev) / 86400000;
    if (diff === 1) {
      streak++;
      if (streak > maxStreak) maxStreak = streak;
    } else streak = 1;
  }

  return { totalPages: total, streak: maxStreak };
}

// ===== Calculate Stats for a Specific Book =====
export function calcBookStats(logs, bookId, totalPages = null) {
  // Filter only logs for this book
  const filtered = logs.filter(l => l.bookId === bookId);
  if (!filtered.length)
    return { pagesRead: 0, avgPerDay: 0, percentComplete: 0 };

  // Sort logs by timestamp
  filtered.sort((a, b) => new Date(a.at) - new Date(b.at));

  // Total pages read
  let pages = 0;
  for (let i = 1; i < filtered.length; i++) {
    const diff = filtered[i].page - filtered[i - 1].page;
    if (diff > 0) pages += diff;
  }

  // Duration between first and last entries (days)
  const first = new Date(filtered[0].at);
  const last = new Date(filtered[filtered.length - 1].at);
  const days = Math.max(1, (last - first) / 86400000);

  // Calculate averages and completion
  const avgPerDay = Math.round(pages / days);
  const percentComplete =
    totalPages && totalPages > 0
      ? Math.min(100, Math.round((filtered.at(-1).page / totalPages) * 100))
      : 0;

  return { pagesRead: pages, avgPerDay, percentComplete };
}

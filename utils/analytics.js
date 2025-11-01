// utils/analytics.js — Bookcord Phase 8
// Reading stats + streak calculations
import { loadJSON, saveJSON, FILES } from './storage.js';

// ===== Basic Utilities =====
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function safeDateISO(input) {
  const d = new Date(input);
  if (isNaN(d)) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfDayISO(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function daysBetweenInclusive(a, b) {
  const d1 = new Date(startOfDayISO(a));
  const d2 = new Date(startOfDayISO(b));
  return Math.floor((d2 - d1) / (24 * 60 * 60 * 1000)) + 1;
}

// ===== Core Logging =====

// Append a page update event
export async function appendReadingLog(userId, bookId, page, atISO = new Date().toISOString()) {
  const logs = await loadJSON(FILES.READING_LOGS);
  logs[userId] = logs[userId] || [];
  logs[userId].push({ bookId, page: Number(page) || 0, at: atISO });

  // prevent runaway file size
  if (logs[userId].length > 500) logs[userId] = logs[userId].slice(-500);
  await saveJSON(FILES.READING_LOGS, logs);
}

// Get all logs for one user
export async function getUserLogs(userId) {
  const logs = await loadJSON(FILES.READING_LOGS);
  return logs[userId] || [];
}

// ===== Derived Analytics =====

// Calculate stats for a single book (avg/day, streak, etc.)
export function calcBookStats(allLogsForUser, bookId) {
  const logs = allLogsForUser
    .filter(l => l.bookId === bookId)
    .sort((a, b) => new Date(a.at) - new Date(b.at));

  if (!logs.length)
    return { avgPerDay: 0, streak: 0, lastAt: null, totalDelta: 0 };

  // sum of positive deltas
  let totalDelta = 0;
  for (let i = 1; i < logs.length; i++) {
    const diff = Number(logs[i].page) - Number(logs[i - 1].page);
    if (diff > 0) totalDelta += diff;
  }

  const firstAt = logs[0].at;
  const lastAt = logs.at(-1).at;
  const spanDays = Math.max(1, daysBetweenInclusive(firstAt, lastAt));
  const avgPerDay = totalDelta / spanDays;

  // build per-day map to compute streak
  const perDay = new Map();
  for (const l of logs) {
    const day = safeDateISO(l.at);
    if (day) perDay.set(day, true);
  }

  let streak = 0;
  let cursor = new Date(startOfDayISO(lastAt));
  while (true) {
    const key = safeDateISO(cursor);
    if (!perDay.has(key)) break;
    streak++;
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  }

  return { avgPerDay, streak, lastAt, totalDelta };
}

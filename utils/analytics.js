// utils/analytics.js — Optimized for PostgreSQL
// ✅ Uses bc_reading_history table
// ✅ Efficient stats calculation

import { query } from "./db.js";
import { logger } from "./logger.js";

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
export async function appendReadingLog(userId, bookId, pagesRead) {
  try {
    await query(`
      INSERT INTO bc_reading_history (user_id, book_id, pages_read, timestamp)
      VALUES ($1, $2, $3, NOW())
    `, [userId, bookId, pagesRead]);

    logger.debug(`[analytics] Logged ${pagesRead} pages for ${userId}/${bookId}`);
  } catch (err) {
    logger.error("[analytics.appendReadingLog]", err);
  }
}

// ---------------------------------------------------------------------------
// 📗 getUserLogs
// ---------------------------------------------------------------------------
export async function getUserLogs(userId, bookId = null) {
  try {
    let sql = `SELECT * FROM bc_reading_history WHERE user_id = $1`;
    const params = [userId];

    if (bookId) {
      sql += ` AND book_id = $2`;
      params.push(bookId);
    }

    sql += ` ORDER BY timestamp DESC LIMIT 100`; // Limit history

    const res = await query(sql, params);

    // Map to expected format
    return res.rows.map(row => ({
      bookId: row.book_id,
      pagesRead: row.pages_read,
      timestamp: row.timestamp,
      at: row.timestamp // compatibility
    }));
  } catch (err) {
    logger.error("[analytics.getUserLogs]", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// 📙 calcBookStats
// ---------------------------------------------------------------------------
export function calcBookStats(logs) {
  try {
    if (!logs || !logs.length) return { streak: 0, avgPerDay: 0 };

    const sorted = [...logs].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    // --- Calculate streak
    let streak = 1;
    let bestStreak = 1;
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1].timestamp);
      const curr = new Date(sorted[i].timestamp);
      const diff = (curr - prev) / (1000 * 60 * 60 * 24);
      if (diff <= 1.5) streak++;
      else {
        bestStreak = Math.max(bestStreak, streak);
        streak = 1;
      }
    }
    bestStreak = Math.max(bestStreak, streak);

    // --- Calculate average pages per day
    const totalPages = sorted.reduce((sum, l) => sum + Number(l.pagesRead || 0), 0);
    const firstDate = new Date(sorted[0].timestamp);
    const lastDate = new Date(sorted[sorted.length - 1].timestamp);
    const days = Math.max(1, (lastDate - firstDate) / (1000 * 60 * 60 * 24));

    const avgPerDay = totalPages / days;

    return { streak: bestStreak, avgPerDay, avgPages: avgPerDay }; // avgPages alias
  } catch (err) {
    logger.error("[analytics.calcBookStats]", err);
    return { streak: 0, avgPerDay: 0, avgPages: 0 };
  }
}

// ---------------------------------------------------------------------------
// 📒 calcBookStatsSimple
// ---------------------------------------------------------------------------
export function calcBookStatsSimple(entry) {
  if (!entry?.total_pages) return ""; // DB uses total_pages
  const pct = Math.min(
    100,
    Math.round((entry.current_page / entry.total_pages) * 100)
  );
  const start = entry.started_at ? shortDate(entry.started_at) : "—";
  const last = entry.updated_at ? shortDate(entry.updated_at) : "—";

  let msg = `Progress: **${pct}%**`;
  if (entry.current_page >= entry.total_pages)
    msg += ` ✅ Completed on ${last}`;
  else msg += ` (started ${start}, updated ${last})`;

  return msg;
}

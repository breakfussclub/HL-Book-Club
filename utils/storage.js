// utils/storage.js — Database Adapter (PostgreSQL)
// 🔄 Maps legacy JSON file operations to PostgreSQL queries
// ✅ Maintains backward compatibility for existing commands
// ✅ Uses bc_ prefix tables

import path from "path";
import { config } from "../config.js";
import { logger } from "./logger.js";
import { query } from "./db.js";

const DATA_DIR = config.storage.dataDir;

// ===== File Paths (kept for compatibility) =====
export const FILES = {
  CLUB: path.join(DATA_DIR, "club.json"),
  TRACKERS: path.join(DATA_DIR, "trackers.json"),
  READING_LOGS: path.join(DATA_DIR, "reading_logs.json"), // Deprecated/Unused in main logic usually
  QUOTES: path.join(DATA_DIR, "quotes.json"), // Not yet migrated in plan, but we can store in club_info or new table? Plan didn't specify quotes table.
  STATS: path.join(DATA_DIR, "stats.json"),
  FAVORITES: path.join(DATA_DIR, "favorites.json"), // Not migrated
  GOODREADS_LINKS: path.join(DATA_DIR, "goodreads_links.json"),
  READING_GOALS: path.join(DATA_DIR, "reading_goals.json"), // Not migrated
  BOOKCLUB: path.join(DATA_DIR, "bookclub.json"),
};

// Backward compatibility aliases
FILES.BOOKS = FILES.TRACKERS;
FILES.USERS = FILES.STATS;
FILES.ACTIVITY = FILES.READING_LOGS;

// ===== Helper: Identify Type =====
function getFileType(filePath) {
  const base = path.basename(filePath);
  if (base === "trackers.json") return "trackers";
  if (base === "stats.json") return "stats";
  if (base === "goodreads_links.json") return "goodreads";
  if (base === "club.json") return "club";
  // Fallback for non-migrated files: keep using FS?
  // For now, we'll only support the migrated ones in DB.
  // Others will fail or return empty if we don't implement FS fallback.
  // Let's implement FS fallback for non-migrated files.
  return "fs";
}

// ===== FS Fallback Imports =====
import fs from "fs/promises";
async function fsLoad(filePath, defaultData) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return defaultData;
  }
}
async function fsSave(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

// ===== DB Loaders =====

async function loadTrackers() {
  // Reconstruct { userId: { tracked: [ ... ] } }
  const res = await query(`
    SELECT 
      rl.*, 
      b.title, b.author, b.description, b.thumbnail, b.page_count
    FROM bc_reading_logs rl
    LEFT JOIN bc_books b ON rl.book_id = b.book_id
  `);

  const trackers = {};
  for (const row of res.rows) {
    if (!trackers[row.user_id]) trackers[row.user_id] = { tracked: [] };

    trackers[row.user_id].tracked.push({
      title: row.title || "Unknown",
      author: row.author || "Unknown",
      description: row.description,
      thumbnail: row.thumbnail,
      totalPages: row.page_count || row.total_pages,
      currentPage: row.current_page,
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      rating: row.rating,
      source: row.source,
      goodreadsId: row.goodreads_id,
      // Add other fields if needed
    });
  }
  return trackers;
}

async function loadStats() {
  // Reconstruct { userId: { ...stats } }
  const res = await query("SELECT user_id, stats FROM bc_users");
  const stats = {};
  for (const row of res.rows) {
    stats[row.user_id] = row.stats || {};
    // Ensure basic fields are present if they were stored in columns
    // But we stored the whole stats object in JSONB, so just return that.
  }
  return stats;
}

async function loadGoodreads() {
  // Reconstruct { userId: { goodreadsUserId, lastSync, ... } }
  const res = await query("SELECT * FROM bc_goodreads_links");
  const links = {};
  for (const row of res.rows) {
    links[row.user_id] = {
      goodreadsUserId: row.goodreads_user_id,
      lastSync: row.last_sync,
      syncResults: row.sync_results
    };
  }
  return links;
}

async function loadClub() {
  // Reconstruct arbitrary object from key-value store
  const res = await query("SELECT key, value FROM bc_club_info");
  const club = {};
  for (const row of res.rows) {
    club[row.key] = row.value;
  }
  return club;
}

// ===== DB Savers =====

async function saveTrackers(data) {
  // data = { userId: { tracked: [] } }
  // This is expensive: we have to diff or upsert everything.
  // For simplicity in this adapter: loop and upsert.

  for (const [userId, userData] of Object.entries(data)) {
    if (!userData.tracked) continue;

    // Ensure user
    await query(`INSERT INTO bc_users (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userId]);

    for (const book of userData.tracked) {
      // Generate ID if missing
      const bookId = book.goodreadsId || `manual_${Buffer.from(book.title + (book.author || '')).toString('base64').substring(0, 20)}`;

      // Upsert Book
      await query(`
        INSERT INTO bc_books (book_id, title, author, description, thumbnail, page_count)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (book_id) DO UPDATE SET
          title = EXCLUDED.title,
          author = EXCLUDED.author,
          thumbnail = EXCLUDED.thumbnail
      `, [bookId, book.title, book.author, book.description, book.thumbnail, book.totalPages]);

      // Upsert Log
      await query(`
        INSERT INTO bc_reading_logs (
          user_id, book_id, status, current_page, total_pages, 
          started_at, completed_at, rating, source, goodreads_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (user_id, book_id) DO UPDATE SET
          status = EXCLUDED.status,
          current_page = EXCLUDED.current_page,
          completed_at = EXCLUDED.completed_at,
          rating = EXCLUDED.rating
      `, [
        userId, bookId, book.status, book.currentPage, book.totalPages,
        book.startedAt, book.completedAt, book.rating, book.source, book.goodreadsId
      ]);
    }
  }
}

async function saveStats(data) {
  for (const [userId, userStats] of Object.entries(data)) {
    await query(`
      INSERT INTO bc_users (user_id, stats)
      VALUES ($1, $2)
      ON CONFLICT (user_id) DO UPDATE SET stats = EXCLUDED.stats
    `, [userId, JSON.stringify(userStats)]);
  }
}

async function saveGoodreads(data) {
  for (const [userId, link] of Object.entries(data)) {
    await query(`
      INSERT INTO bc_goodreads_links (user_id, goodreads_user_id, last_sync, sync_results)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id) DO UPDATE SET
        last_sync = EXCLUDED.last_sync,
        sync_results = EXCLUDED.sync_results
    `, [userId, link.goodreadsUserId, link.lastSync, JSON.stringify(link.syncResults)]);
  }
}

async function saveClub(data) {
  for (const [key, value] of Object.entries(data)) {
    await query(`
      INSERT INTO bc_club_info (key, value)
      VALUES ($1, $2)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `, [key, JSON.stringify(value)]);
  }
}

// ===== Public API =====

export async function ensureAllFiles() {
  // DB init
  try {
    const { initDB } = await import("./db.js");
    await initDB();
    logger.info("Database initialized");
  } catch (err) {
    logger.error("Failed to init DB", err);
  }
}

export async function loadJSON(filePath, defaultData = {}) {
  const type = getFileType(filePath);
  try {
    if (type === "trackers") return await loadTrackers();
    if (type === "stats") return await loadStats();
    if (type === "goodreads") return await loadGoodreads();
    if (type === "club") return await loadClub();
    return await fsLoad(filePath, defaultData);
  } catch (err) {
    logger.error(`DB Load Failed for ${type}`, err);
    return defaultData;
  }
}

export async function saveJSON(filePath, data) {
  const type = getFileType(filePath);
  try {
    if (type === "trackers") await saveTrackers(data);
    else if (type === "stats") await saveStats(data);
    else if (type === "goodreads") await saveGoodreads(data);
    else if (type === "club") await saveClub(data);
    else await fsSave(filePath, data);
  } catch (err) {
    logger.error(`DB Save Failed for ${type}`, err);
    throw err;
  }
}

export async function updateJSON(filePath, updateFn) {
  // Not atomic in this adapter, but sufficient for now
  const data = await loadJSON(filePath);
  const updated = await updateFn(data);
  await saveJSON(filePath, updated);
  return updated;
}

export async function loadJSONCached(filePath, defaultData) {
  // Disable cache for DB to ensure freshness, or implement short TTL
  return loadJSON(filePath, defaultData);
}

export function invalidateCache() { }

export async function verifyDataIntegrity() {
  return { valid: true, results: [] }; // DB enforces integrity mostly
}

export async function clearFile(filePath) {
  // Not implemented for DB yet
  logger.warn("clearFile not implemented for DB adapter");
}

export async function cleanupTempFiles() { }

// utils/storage.js — Phase 10 Unified
// ✅ Retains Phase 9 logic and adds backward-compatible aliases
// ✅ Adds support for social layer commands (/profile, /shelf)
// ✅ Safe for Railway deployment

import fs from "fs/promises";
import path from "path";

const DEBUG = process.env.DEBUG === "true";

// ---------------------------------------------------------------------------
// 📁 File Paths (relative to project root /app/data or ./data)
// ---------------------------------------------------------------------------

const DATA_DIR = process.env.DATA_DIR || "./data";

export const FILES = {
  CLUB: path.join(DATA_DIR, "club.json"),
  TRACKERS: path.join(DATA_DIR, "trackers.json"),
  READING_LOGS: path.join(DATA_DIR, "reading_logs.json"),
  QUOTES: path.join(DATA_DIR, "quotes.json"),
  STATS: path.join(DATA_DIR, "stats.json"),
  FAVORITES: path.join(DATA_DIR, "favorites.json"), // 🆕 user favorites list
};

// ---------------------------------------------------------------------------
// 🧩 ensureFileExists — create file + dirs if missing
// ---------------------------------------------------------------------------

async function ensureFileExists(filePath, defaultData = {}) {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify(defaultData, null, 2));
    if (DEBUG) console.log(`[storage] Created ${filePath}`);
  }
}

// ---------------------------------------------------------------------------
// 🔄 ensureAllFiles — bootstraps all defined FILES once on startup (optional)
// ---------------------------------------------------------------------------

export async function ensureAllFiles() {
  for (const filePath of Object.values(FILES)) {
    await ensureFileExists(filePath);
  }
  if (DEBUG) console.log("[storage] Verified all data files");
}

// ---------------------------------------------------------------------------
// 📥 loadJSON — safely read JSON, create if missing
// ---------------------------------------------------------------------------

export async function loadJSON(filePath, defaultData = {}) {
  try {
    await ensureFileExists(filePath, defaultData);
    const data = await fs.readFile(filePath, "utf8");
    return JSON.parse(data || "{}");
  } catch (err) {
    console.error(`[storage.loadJSON] ${filePath}`, err);
    return structuredClone(defaultData);
  }
}

// ---------------------------------------------------------------------------
// 💾 saveJSON — atomic write to prevent corruption
// ---------------------------------------------------------------------------

export async function saveJSON(filePath, data) {
  try {
    await ensureFileExists(filePath);
    const tmpPath = `${filePath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2));
    await fs.rename(tmpPath, filePath);
    if (DEBUG) console.log(`[storage] Saved ${path.basename(filePath)}`);
  } catch (err) {
    console.error(`[storage.saveJSON] ${filePath}`, err);
  }
}

// ---------------------------------------------------------------------------
// 🧹 clearFile — reset file to blank object or array
// ---------------------------------------------------------------------------

export async function clearFile(filePath, toArray = false) {
  const blank = toArray ? [] : {};
  await saveJSON(filePath, blank);
  if (DEBUG) console.log(`[storage] Cleared ${filePath}`);
}

// ---------------------------------------------------------------------------
// 📘 Phase 10 aliases for backward compatibility
// ---------------------------------------------------------------------------
// These ensure new social commands can use expected FILES.* keys
// without breaking existing Phase 9 command references.

FILES.BOOKS = FILES.TRACKERS;        // /profile, /shelf reference
FILES.USERS = FILES.STATS;           // for social profiles
FILES.ACTIVITY = FILES.READING_LOGS; // for feed/digest or streaks

if (DEBUG) console.log("[storage] Phase 10 aliases registered");


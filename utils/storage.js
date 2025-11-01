// utils/storage.js — Phase 8 Modernized
// ✅ Central file registry + resilient JSON helpers
// ✅ Works in Railway ephemeral storage environments
// ✅ DEBUG-safe logging, auto-creates missing files

import fs from "fs/promises";
import path from "path";

const DEBUG = process.env.DEBUG === "true";

// ---------------------------------------------------------------------------
// File Paths (relative to project root /app/data or ./data)
// ---------------------------------------------------------------------------

const DATA_DIR = process.env.DATA_DIR || "./data";

export const FILES = {
  CLUB: path.join(DATA_DIR, "club.json"),
  TRACKERS: path.join(DATA_DIR, "trackers.json"),
  READING_LOGS: path.join(DATA_DIR, "reading_logs.json"),
  QUOTES: path.join(DATA_DIR, "quotes.json"),
  STATS: path.join(DATA_DIR, "stats.json"),
};

// ---------------------------------------------------------------------------
// Ensure file + directory exist
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
// loadJSON: safely read JSON file, create if missing
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
// saveJSON: atomic write to prevent corruption
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
// clearFile: reset a data file to empty object/array
// ---------------------------------------------------------------------------

export async function clearFile(filePath, toArray = false) {
  const blank = toArray ? [] : {};
  await saveJSON(filePath, blank);
  if (DEBUG) console.log(`[storage] Cleared ${filePath}`);
}

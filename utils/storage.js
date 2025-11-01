// utils/storage.js — Bookcord Phase 8
// Handles reading, writing, and ensuring data JSON files exist
import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');

// default file paths
export const FILES = {
  CLUB: path.join(DATA_DIR, 'club.json'),
  TRACKERS: path.join(DATA_DIR, 'trackers.json'),
  MEMBERS: path.join(DATA_DIR, 'members.json'),
  QUOTES: path.join(DATA_DIR, 'quotes.json'),
  READING_LOGS: path.join(DATA_DIR, 'readingLogs.json'),
};

// default seed data for each file
const SEEDS = {
  [FILES.CLUB]: { clubCurrent: null, books: [], schedules: [] },
  [FILES.TRACKERS]: {},
  [FILES.MEMBERS]: {},
  [FILES.QUOTES]: {},
  [FILES.READING_LOGS]: {},
};

// ensure /data directory and JSON files exist with defaults
export async function ensureDataFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  for (const [file, seed] of Object.entries(SEEDS)) {
    try {
      await fs.access(file);
    } catch {
      await fs.writeFile(file, JSON.stringify(seed, null, 2));
      console.log(`[init] created ${path.basename(file)}`);
    }
  }
}

// read JSON safely
export async function loadJSON(file) {
  await ensureDataFiles();
  const raw = await fs.readFile(file, 'utf8');
  return JSON.parse(raw);
}

// write JSON safely
export async function saveJSON(file, data) {
  await ensureDataFiles();
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

// quick helper to reset (useful for debugging)
export async function resetFile(file) {
  const seed = SEEDS[file];
  if (!seed) throw new Error(`Unknown file: ${file}`);
  await fs.writeFile(file, JSON.stringify(seed, null, 2));
}

// optional: get path constants easily
export function getFilePaths() {
  return FILES;
}

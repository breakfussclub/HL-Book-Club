// utils/goodreadsScheduler.js — Goodreads Automatic Sync Scheduler
// ✅ Polls RSS feeds at configured intervals
// ✅ Syncs all linked users automatically
// ✅ Graceful error handling and logging

import { syncAllUsers } from "./goodreadsSync.js";
import { logger } from "./logger.js";
import { getConfig } from "../config.js";

const config = getConfig();

let syncInterval = null;
let clientInstance = null;

// ─────────────────────────────────────────────────────────────
//   START SCHEDULER
// ─────────────────────────────────────────────────────────────

export function startGoodreadsScheduler(client) {
  if (!config.goodreads.enabled) {
    logger.info("Goodreads sync is disabled in config");
    return;
  }

  if (syncInterval) {
    logger.warn("Goodreads scheduler already running");
    return;
  }

  clientInstance = client;
  const intervalMs = config.goodreads.pollIntervalMinutes * 60 * 1000;

  logger.info("Starting Goodreads sync scheduler", {
    intervalMinutes: config.goodreads.pollIntervalMinutes,
  });

  // Run initial sync after a short delay
  setTimeout(() => {
    runSync();
  }, 30000); // 30 seconds after startup

  // Set up recurring sync
  syncInterval = setInterval(() => {
    runSync();
  }, intervalMs);

  logger.info("✅ Goodreads scheduler started");
}

// ─────────────────────────────────────────────────────────────
//   STOP SCHEDULER
// ─────────────────────────────────────────────────────────────

export function stopGoodreadsScheduler() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    logger.info("Goodreads scheduler stopped");
  }
}

// ─────────────────────────────────────────────────────────────
//   RUN SYNC
// ─────────────────────────────────────────────────────────────

async function runSync() {
  try {
    logger.debug("Running scheduled Goodreads sync");

    const result = await syncAllUsers(clientInstance);

    if (result.success) {
      logger.info("Scheduled Goodreads sync completed", {
        synced: result.synced,
        newBooks: result.newBooks,
      });
    } else {
      logger.error("Scheduled Goodreads sync failed", {
        error: result.error,
      });
    }
  } catch (error) {
    logger.error("Goodreads sync scheduler error", {
      error: error.message,
      stack: error.stack,
    });
  }
}

// ─────────────────────────────────────────────────────────────
//   MANUAL TRIGGER (for admin commands)
// ─────────────────────────────────────────────────────────────

export async function triggerManualSync() {
  logger.info("Manual Goodreads sync triggered");
  return await runSync();
}

// Graceful shutdown
process.on("SIGINT", () => {
  stopGoodreadsScheduler();
});

process.on("SIGTERM", () => {
  stopGoodreadsScheduler();
});

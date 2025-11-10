// utils/backup.js — Automated Backup System (Stable)
// 💾 Regular backups of JSON data files
// ✅ Automatic retention policy
// ✅ Manual backup trigger
// ✅ Restore functionality

import fs from "fs/promises";
import path from "path";
import { config } from "../config.js";
import { logger } from "./logger.js";
import { FILES } from "./storage.js";

// ===== Backup Utilities =====

/**
 * Create a timestamped backup of all data files
 */
export async function createBackup() {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDir = path.join(config.storage.backupDir, timestamp);

    await fs.mkdir(backupDir, { recursive: true });

    const backedUp = [];
    const failed = [];

    for (const [name, filePath] of Object.entries(FILES)) {
      try {
        const backupPath = path.join(backupDir, path.basename(filePath));
        await fs.copyFile(filePath, backupPath);
        backedUp.push(name);
      } catch (error) {
        if (error.code !== "ENOENT") {
          failed.push({ name, error: error.message });
        }
      }
    }

    logger.info("Backup created", {
      timestamp,
      backedUp,
      failed: failed.length > 0 ? failed : undefined,
    });

    return {
      success: true,
      timestamp,
      backupDir,
      backedUp,
      failed,
    };
  } catch (error) {
    logger.error("Backup creation failed", { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * List all available backups
 */
export async function listBackups() {
  try {
    await fs.mkdir(config.storage.backupDir, { recursive: true });
    const entries = await fs.readdir(config.storage.backupDir, {
      withFileTypes: true,
    });

    const backups = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const backupPath = path.join(config.storage.backupDir, entry.name);
        const files = await fs.readdir(backupPath);
        const stats = await fs.stat(backupPath);

        backups.push({
          timestamp: entry.name,
          path: backupPath,
          files: files.length,
          size: stats.size,
          created: stats.birthtime,
        });
      }
    }

    return backups.sort((a, b) => b.created - a.created);
  } catch (error) {
    logger.error("Failed to list backups", { error: error.message });
    return [];
  }
}

/**
 * Restore from a specific backup
 */
export async function restoreBackup(timestamp) {
  try {
    const backupDir = path.join(config.storage.backupDir, timestamp);

    try {
      await fs.access(backupDir);
    } catch {
      throw new Error(`Backup ${timestamp} not found`);
    }

    const preRestoreBackup = await createBackup();
    logger.info("Pre-restore backup created", {
      backup: preRestoreBackup.timestamp,
    });

    const restored = [];
    const failed = [];

    for (const [name, filePath] of Object.entries(FILES)) {
      try {
        const backupPath = path.join(backupDir, path.basename(filePath));
        await fs.copyFile(backupPath, filePath);
        restored.push(name);
      } catch (error) {
        failed.push({ name, error: error.message });
      }
    }

    logger.info("Backup restored", {
      timestamp,
      restored,
      failed: failed.length > 0 ? failed : undefined,
    });

    return {
      success: true,
      restored,
      failed,
      preRestoreBackup: preRestoreBackup.timestamp,
    };
  } catch (error) {
    logger.error("Backup restoration failed", { error: error.message });
    throw error;
  }
}

/**
 * Clean up old backups based on retention policy
 */
export async function cleanupOldBackups() {
  try {
    const backups = await listBackups();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - config.storage.backupRetention);

    const toDelete = backups.filter((backup) => backup.created < cutoffDate);

    for (const backup of toDelete) {
      try {
        await fs.rm(backup.path, { recursive: true, force: true });
        logger.info("Old backup deleted", { timestamp: backup.timestamp });
      } catch (error) {
        logger.warn("Failed to delete old backup", {
          timestamp: backup.timestamp,
          error: error.message,
        });
      }
    }

    return {
      deleted: toDelete.length,
      remaining: backups.length - toDelete.length,
    };
  } catch (error) {
    logger.error("Backup cleanup failed", { error: error.message });
    return { deleted: 0, remaining: 0 };
  }
}

/**
 * Start automatic backup scheduler
 */
export function startBackupScheduler() {
  // ✅ fixed to use autoBackupHours key
  const hours = config.storage.autoBackupHours || 24;
  const intervalMs = hours * 60 * 60 * 1000;

  logger.info("Backup scheduler started", { intervalHours: hours });

  // Run initial backup safely
  createBackup().then(() => cleanupOldBackups());

  // Schedule recurring backups
  setInterval(async () => {
    await createBackup();
    await cleanupOldBackups();
  }, intervalMs);
}

/**
 * Export data as JSON for manual download
 */
export async function exportData() {
  try {
    const data = {};

    for (const [name, filePath] of Object.entries(FILES)) {
      try {
        const content = await fs.readFile(filePath, "utf-8");
        data[name] = JSON.parse(content);
      } catch (error) {
        if (error.code !== "ENOENT") {
          logger.warn(`Failed to export ${name}`, { error: error.message });
        }
        data[name] = null;
      }
    }

    return {
      exportedAt: new Date().toISOString(),
      version: "1.0.0",
      data,
    };
  } catch (error) {
    logger.error("Data export failed", { error: error.message });
    throw error;
  }
}

/**
 * Verify backup integrity
 */
export async function verifyBackup(timestamp) {
  try {
    const backupDir = path.join(config.storage.backupDir, timestamp);
    const files = await fs.readdir(backupDir);

    const checks = [];

    for (const file of files) {
      const filePath = path.join(backupDir, file);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        JSON.parse(content);
        checks.push({ file, valid: true });
      } catch (error) {
        checks.push({ file, valid: false, error: error.message });
      }
    }

    const allValid = checks.every((c) => c.valid);

    return { valid: allValid, checks };
  } catch (error) {
    logger.error("Backup verification failed", { error: error.message });
    return { valid: false, error: error.message };
  }
}

/**
 * Get backup status for display in commands
 */
export async function getBackupStatus() {
  const backups = await listBackups();
  const latest = backups[0];

  return {
    totalBackups: backups.length,
    latestBackup: latest
      ? {
          timestamp: latest.timestamp,
          created: latest.created.toISOString(),
          files: latest.files,
        }
      : null,
    retentionDays: config.storage.backupRetention,
    autoBackupInterval: config.storage.autoBackupHours,
  };
}

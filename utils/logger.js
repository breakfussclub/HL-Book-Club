// utils/logger.js — Structured Logging System
// 📝 Centralized logging with levels and formatting
// ✅ Console and file output
// ✅ Structured JSON logs for production
// ✅ Pretty console output for development

import fs from "fs/promises";
import path from "path";
import { config } from "../config.js";

// ===== Log Levels =====
const LogLevel = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

const levelNames = {
  0: "ERROR",
  1: "WARN",
  2: "INFO",
  3: "DEBUG",
};

const levelColors = {
  ERROR: "\x1b[31m", // Red
  WARN: "\x1b[33m",  // Yellow
  INFO: "\x1b[36m",  // Cyan
  DEBUG: "\x1b[90m", // Gray
};

const RESET = "\x1b[0m";

// ===== Logger Class =====
class Logger {
  constructor() {
    this.level = this.parseLevelString(config.debug.logLevel);
    this.logToFile = config.debug.logToFile;
    this.logFilePath = config.debug.logFilePath;
    this.fileStream = null;

    if (this.logToFile) {
      this.initFileLogging();
    }
  }

  parseLevelString(level) {
    const levels = {
      error: LogLevel.ERROR,
      warn: LogLevel.WARN,
      info: LogLevel.INFO,
      debug: LogLevel.DEBUG,
    };
    return levels[level.toLowerCase()] ?? LogLevel.INFO;
  }

  async initFileLogging() {
    try {
      const dir = path.dirname(this.logFilePath);
      await fs.mkdir(dir, { recursive: true });

      // Open file stream in append mode
      this.fileStream = await fs.open(this.logFilePath, "a");
      this.log(LogLevel.INFO, "File logging initialized", {
        path: this.logFilePath,
      });
    } catch (error) {
      console.error("Failed to initialize file logging:", error);
      this.logToFile = false;
    }
  }

  formatTimestamp() {
    const now = new Date();
    return now.toISOString();
  }

  formatConsoleMessage(level, message, metadata) {
    const timestamp = this.formatTimestamp();
    const levelName = levelNames[level];
    const color = levelColors[levelName];

    let output = `${color}[${timestamp}] [${levelName}]${RESET} ${message}`;

    if (metadata && Object.keys(metadata).length > 0) {
      output += `\n  ${JSON.stringify(metadata, null, 2)}`;
    }

    return output;
  }

  formatFileMessage(level, message, metadata) {
    return JSON.stringify({
      timestamp: this.formatTimestamp(),
      level: levelNames[level],
      message,
      ...metadata,
    });
  }

  async writeToFile(message) {
    if (!this.fileStream) return;

    try {
      await this.fileStream.write(message + "\n");
    } catch (error) {
      console.error("Failed to write to log file:", error);
    }
  }

  log(level, message, metadata = {}) {
    // Check if this level should be logged
    if (level > this.level) return;

    // Console output
    const consoleMsg = this.formatConsoleMessage(level, message, metadata);
    console.log(consoleMsg);

    // File output
    if (this.logToFile) {
      const fileMsg = this.formatFileMessage(level, message, metadata);
      this.writeToFile(fileMsg);
    }
  }

  error(message, metadata = {}) {
    this.log(LogLevel.ERROR, message, metadata);
  }

  warn(message, metadata = {}) {
    this.log(LogLevel.WARN, message, metadata);
  }

  info(message, metadata = {}) {
    this.log(LogLevel.INFO, message, metadata);
  }

  debug(message, metadata = {}) {
    this.log(LogLevel.DEBUG, message, metadata);
  }

  // Performance timing utility
  startTimer(label) {
    const start = Date.now();
    return () => {
      const duration = Date.now() - start;
      this.debug(`Timer: ${label}`, { durationMs: duration });
      return duration;
    };
  }

  // Log command execution
  logCommand(interaction, additionalData = {}) {
    this.info("Command executed", {
      command: interaction.commandName,
      user: interaction.user.username,
      userId: interaction.user.id,
      guild: interaction.guild?.name,
      guildId: interaction.guild?.id,
      ...additionalData,
    });
  }

  // Log component interaction
  logComponent(interaction, additionalData = {}) {
    this.debug("Component interaction", {
      type: interaction.isButton()
        ? "button"
        : interaction.isStringSelectMenu()
        ? "select"
        : "unknown",
      customId: interaction.customId,
      user: interaction.user.username,
      userId: interaction.user.id,
      ...additionalData,
    });
  }

  // Graceful shutdown
  async close() {
    if (this.fileStream) {
      try {
        await this.fileStream.close();
        this.info("Logger closed");
      } catch (error) {
        console.error("Error closing logger:", error);
      }
    }
  }
}

// ===== Singleton Instance =====
export const logger = new Logger();

// ===== Graceful Shutdown Handler =====
process.on("SIGTERM", () => logger.close());
process.on("SIGINT", () => logger.close());

// ===== Helper Functions =====
export function logExecutionTime(fn, label) {
  return async (...args) => {
    const timer = logger.startTimer(label);
    try {
      const result = await fn(...args);
      timer();
      return result;
    } catch (error) {
      timer();
      throw error;
    }
  };
}

export function createContextLogger(context) {
  return {
    error: (msg, meta = {}) => logger.error(msg, { ...context, ...meta }),
    warn: (msg, meta = {}) => logger.warn(msg, { ...context, ...meta }),
    info: (msg, meta = {}) => logger.info(msg, { ...context, ...meta }),
    debug: (msg, meta = {}) => logger.debug(msg, { ...context, ...meta }),
  };
}

// config.js — Centralized Configuration
// 🎯 Single source of truth for all bot settings
// ✅ Environment variable management
// ✅ Type validation and defaults

import dotenv from "dotenv";
dotenv.config();

// Validate required environment variables
const required = ["DISCORD_TOKEN", "CLIENT_ID", "GUILD_ID"];
const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error(`❌ Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

export const config = {
  // ===== Discord Configuration =====
  discord: {
    token: process.env.DISCORD_TOKEN || process.env.TOKEN,
    clientId: process.env.CLIENT_ID,
    guildId: process.env.GUILD_ID,
    activity: process.env.BOT_ACTIVITY || "Reading: Separation of Church and Hate",
  },

  // ===== API Keys =====
  apis: {
    googleBooks: process.env.GOOGLE_BOOKS_KEY || null,
  },

  // ===== Storage Configuration =====
  storage: {
    dataDir: process.env.DATA_DIR || "./data",
    backupDir: process.env.BACKUP_DIR || "./backups",
    backupRetention: parseInt(process.env.BACKUP_RETENTION_DAYS) || 7,
    autoBackupInterval: parseInt(process.env.AUTO_BACKUP_HOURS) || 24,
  },

  // ===== Feature Settings =====
  features: {
    // Pagination
    shelfPageSize: 10,
    leaderboardLimit: 10,
    quotesDisplayLimit: 10,
    searchResultsLimit: 10,

    // Progress bars
    progressBarWidth: 18,

    // Analytics
    maxReadingLogsPerUser: 2000,
    streakDayThreshold: 1.5, // days

    // Rate limiting
    searchCacheTimeout: 300000, // 5 minutes
    maxCachedSearches: 100,
  },

  // ===== Theme Colors =====
  colors: {
    primary: 0x8b5cf6,    // Purple
    gold: 0xfbbf24,       // Gold
    success: 0x22c55e,    // Green
    error: 0xef4444,      // Red
    info: 0x0ea5e9,       // Blue
    warning: 0xfacc15,    // Yellow
  },

  // ===== Validation Rules =====
  validation: {
    maxTitleLength: 200,
    maxAuthorLength: 100,
    maxQuoteLength: 1000,
    maxNotesLength: 500,
    maxPageNumber: 99999,
    minPageNumber: 0,
    maxSearchQueryLength: 100,
  },

  // ===== Debug & Logging =====
  debug: {
    enabled: process.env.DEBUG === "true",
    logLevel: process.env.LOG_LEVEL || "info", // error, warn, info, debug
    logToFile: process.env.LOG_TO_FILE === "true",
    logFilePath: process.env.LOG_FILE_PATH || "./logs/bot.log",
  },

  // ===== Command Visibility =====
  commands: {
    private: ["tracker", "my-stats", "quote", "my-quotes"],
    public: ["search", "leaderboard", "show-quotes", "profile", "shelf", "book"],
  },
};

// Helper to get nested config values safely
export function getConfig(path, defaultValue = null) {
  const keys = path.split(".");
  let value = config;
  
  for (const key of keys) {
    if (value && typeof value === "object" && key in value) {
      value = value[key];
    } else {
      return defaultValue;
    }
  }
  
  return value;
}

// Validate configuration on load
function validateConfig() {
  const errors = [];

  // Check numeric values
  if (config.storage.backupRetention < 1) {
    errors.push("backupRetention must be >= 1");
  }

  if (config.features.shelfPageSize < 1 || config.features.shelfPageSize > 25) {
    errors.push("shelfPageSize must be between 1 and 25");
  }

  // Check color values
  for (const [key, value] of Object.entries(config.colors)) {
    if (typeof value !== "number" || value < 0 || value > 0xffffff) {
      errors.push(`Invalid color value for ${key}: ${value}`);
    }
  }

  if (errors.length > 0) {
    console.error("❌ Configuration validation failed:");
    errors.forEach((err) => console.error(`   - ${err}`));
    process.exit(1);
  }
}

validateConfig();

export default config;

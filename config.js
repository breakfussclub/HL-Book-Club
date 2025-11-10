// config.js — HL Book Club Configuration (Final Stable Build)
// ✅ Compatible with both named and default imports
// ✅ Fixes getConfig() undefined crash
// ✅ Adds both autoBackupHours + autoBackupInterval for backward compatibility

import dotenv from "dotenv";
dotenv.config();

const config = {
  discord: {
    token: process.env.DISCORD_TOKEN || process.env.TOKEN || "",
    clientId: process.env.CLIENT_ID || "",
    guildId: process.env.GUILD_ID || "",
    activity: process.env.BOT_ACTIVITY || "📚 Reading with HL Book Club",
  },

  apis: {
    googleBooks: process.env.GOOGLE_BOOKS_KEY || "",
  },

  storage: {
    dataDir: process.env.DATA_DIR || "./data",
    backupDir: process.env.BACKUP_DIR || "./backups",
    backupRetention: parseInt(process.env.BACKUP_RETENTION_DAYS || "7", 10),

    // ✅ support both keys to avoid breaking old files
    autoBackupHours: parseInt(process.env.AUTO_BACKUP_HOURS || "24", 10),
    get autoBackupInterval() {
      return this.autoBackupHours;
    },
  },

  colors: {
    primary: 0x9b59b6,
    gold: 0xf1c40f,
    success: 0x2ecc71,
    error: 0xe74c3c,
    info: 0x3498db,
    warning: 0xf39c12,
  },

  validation: {
    maxTitleLength: 150,
    maxAuthorLength: 80,
    maxQuoteLength: 800,
    minPage: 1,
    maxPage: 20000,
  },

  features: {
    shelfPageSize: 10,
    leaderboardLimit: 10,
    quoteLimit: 10,
    searchCacheLimit: 20,
    progressBarWidth: 20,
  },

  debug: {
    enabled: process.env.DEBUG === "true",
    logLevel: process.env.LOG_LEVEL || "info",
    logToFile: process.env.LOG_TO_FILE === "true",
    logFilePath: process.env.LOG_FILE_PATH || "./bot.log",
  },

  commands: {
    public: ["shelf", "leaderboard", "profile"],
    private: [
      "tracker",
      "search",
      "book",
      "quote",
      "my-quotes",
      "my-stats",
      "admin",
    ],
  },
};

// ─────────────────────────────────────────────────────────────
//  VALIDATION
// ─────────────────────────────────────────────────────────────
function validateConfig() {
  const required = [
    { key: "DISCORD_TOKEN", val: config.discord.token },
    { key: "CLIENT_ID", val: config.discord.clientId },
    { key: "GUILD_ID", val: config.discord.guildId },
  ];

  const missing = required.filter((r) => !r.val);
  if (missing.length) {
    console.error(
      `❌ Missing environment variables: ${missing.map((r) => r.key).join(", ")}`
    );
    process.exit(1);
  }
}

validateConfig();

// ─────────────────────────────────────────────────────────────
//  ACCESSOR FUNCTION (SAFE)
// ─────────────────────────────────────────────────────────────
export function getConfig(path) {
  if (!path) return config;
  const keys = path.split(".");
  return keys.reduce((obj, key) => (obj ? obj[key] : undefined), config);
}

export { config };
export default config;

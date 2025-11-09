// commands/admin.js — Admin Management Command
// 🔧 Bot administration and monitoring
// ✅ Backup management
// ✅ Data integrity checks
// ✅ System health monitoring
// ✅ Permission-restricted

import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import {
  createBackup,
  listBackups,
  getBackupStatus,
  cleanupOldBackups,
  verifyBackup,
} from "../utils/backup.js";
import {
  verifyDataIntegrity,
  cleanupTempFiles,
  FILES,
} from "../utils/storage.js";
import { validationError } from "../utils/errorHandler.js";
import fs from "fs/promises";

// ===== Slash Command Definition =====
export const definitions = [
  new SlashCommandBuilder()
    .setName("admin")
    .setDescription("Bot administration commands (Admin only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("View bot status and health")
    )
    .addSubcommand((sub) =>
      sub
        .setName("backup")
        .setDescription("Create a manual backup")
    )
    .addSubcommand((sub) =>
      sub
        .setName("backups")
        .setDescription("List all available backups")
    )
    .addSubcommand((sub) =>
      sub
        .setName("verify")
        .setDescription("Verify data integrity")
    )
    .addSubcommand((sub) =>
      sub
        .setName("cleanup")
        .setDescription("Clean up temporary files and old backups")
    )
    .addSubcommand((sub) =>
      sub
        .setName("logs")
        .setDescription("View recent log entries")
        .addIntegerOption((opt) =>
          opt
            .setName("lines")
            .setDescription("Number of lines to show")
            .setMinValue(10)
            .setMaxValue(100)
        )
    ),
].map((c) => c.toJSON());

// ===== Execute =====
export async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();

  try {
    switch (subcommand) {
      case "status":
        await handleStatus(interaction);
        break;
      case "backup":
        await handleBackup(interaction);
        break;
      case "backups":
        await handleBackups(interaction);
        break;
      case "verify":
        await handleVerify(interaction);
        break;
      case "cleanup":
        await handleCleanup(interaction);
        break;
      case "logs":
        await handleLogs(interaction);
        break;
      default:
        await interaction.editReply({
          content: "⚠️ Unknown subcommand.",
        });
    }

    logger.info("Admin command executed", {
      subcommand,
      user: interaction.user.username,
    });
  } catch (error) {
    logger.error("Admin command failed", {
      subcommand,
      error: error.message,
    });
    throw error;
  }
}

// ===== Status Handler =====
async function handleStatus(interaction) {
  const uptime = process.uptime();
  const uptimeStr = formatUptime(uptime);
  const memory = process.memoryUsage();
  const backupStatus = await getBackupStatus();

  // Get data file sizes
  const fileSizes = await getDataFileSizes();

  const embed = new EmbedBuilder()
    .setColor(config.colors.success)
    .setTitle("🤖 Bot Status")
    .addFields(
      {
        name: "⏱️ Uptime",
        value: uptimeStr,
        inline: true,
      },
      {
        name: "💾 Memory Usage",
        value: `${Math.round(memory.heapUsed / 1024 / 1024)} MB`,
        inline: true,
      },
      {
        name: "🌐 Latency",
        value: `${interaction.client.ws.ping}ms`,
        inline: true,
      },
      {
        name: "📊 Guilds",
        value: String(interaction.client.guilds.cache.size),
        inline: true,
      },
      {
        name: "👥 Users",
        value: String(interaction.client.users.cache.size),
        inline: true,
      },
      {
        name: "💾 Data Files",
        value: fileSizes.join("\n"),
        inline: false,
      },
      {
        name: "🔄 Backups",
        value: backupStatus.latestBackup
          ? `${backupStatus.totalBackups} total\nLatest: ${formatDate(
              backupStatus.latestBackup.created
            )}`
          : "No backups yet",
        inline: true,
      },
      {
        name: "⚙️ Configuration",
        value: [
          `Debug: ${config.debug.enabled ? "ON" : "OFF"}`,
          `Log Level: ${config.debug.logLevel}`,
          `Auto-backup: Every ${config.storage.autoBackupInterval}h`,
        ].join("\n"),
        inline: true,
      }
    )
    .setFooter({ text: `Node.js ${process.version}` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ===== Backup Handler =====
async function handleBackup(interaction) {
  const result = await createBackup();

  const embed = new EmbedBuilder()
    .setColor(result.success ? config.colors.success : config.colors.error)
    .setTitle(result.success ? "✅ Backup Created" : "❌ Backup Failed")
    .setDescription(
      result.success
        ? `Backup timestamp: \`${result.timestamp}\``
        : `Error: ${result.error}`
    );

  if (result.success && result.backedUp.length > 0) {
    embed.addFields({
      name: "📦 Backed Up Files",
      value: result.backedUp.map((f) => `• ${f}`).join("\n"),
    });
  }

  if (result.failed && result.failed.length > 0) {
    embed.addFields({
      name: "⚠️ Failed Files",
      value: result.failed.map((f) => `• ${f.name}: ${f.error}`).join("\n"),
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

// ===== Backups List Handler =====
async function handleBackups(interaction) {
  const backups = await listBackups();

  if (backups.length === 0) {
    return interaction.editReply({
      content: "📦 No backups found.",
    });
  }

  const lines = backups.slice(0, 10).map((b, i) => {
    const age = getAge(b.created);
    return `${i + 1}. \`${b.timestamp}\` - ${b.files} files (${age})`;
  });

  const embed = new EmbedBuilder()
    .setColor(config.colors.info)
    .setTitle("📦 Available Backups")
    .setDescription(lines.join("\n"))
    .setFooter({
      text: `Showing ${Math.min(10, backups.length)} of ${
        backups.length
      } backups • Retention: ${config.storage.backupRetention} days`,
    });

  await interaction.editReply({ embeds: [embed] });
}

// ===== Verify Handler =====
async function handleVerify(interaction) {
  const integrity = await verifyDataIntegrity();

  const embed = new EmbedBuilder()
    .setColor(integrity.valid ? config.colors.success : config.colors.error)
    .setTitle(
      integrity.valid ? "✅ Data Integrity: OK" : "⚠️ Data Integrity: Issues Found"
    );

  const resultLines = integrity.results.map((r) => {
    const icon = r.valid ? "✅" : "❌";
    const size = r.sizeMB ? ` (${r.sizeMB} MB)` : "";
    const error = r.error ? `: ${r.error}` : "";
    return `${icon} ${r.file}${size}${error}`;
  });

  embed.setDescription(resultLines.join("\n"));

  if (!integrity.valid) {
    embed.addFields({
      name: "🔧 Recommended Actions",
      value: [
        "1. Review the errors above",
        "2. Check log files for details",
        "3. Consider restoring from backup",
        "4. Contact support if issues persist",
      ].join("\n"),
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

// ===== Cleanup Handler =====
async function handleCleanup(interaction) {
  const tempCleaned = await cleanupTempFiles();
  const backupResult = await cleanupOldBackups();

  const embed = new EmbedBuilder()
    .setColor(config.colors.success)
    .setTitle("🧹 Cleanup Complete")
    .addFields(
      {
        name: "🗑️ Temporary Files",
        value: `Removed ${tempCleaned} temp file(s)`,
        inline: true,
      },
      {
        name: "📦 Old Backups",
        value: `Deleted ${backupResult.deleted}, kept ${backupResult.remaining}`,
        inline: true,
      }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ===== Logs Handler =====
async function handleLogs(interaction) {
  if (!config.debug.logToFile) {
    return interaction.editReply({
      content: "⚠️ File logging is not enabled. Set `LOG_TO_FILE=true` in .env",
    });
  }

  const lines = interaction.options.getInteger("lines") || 20;

  try {
    const logContent = await fs.readFile(config.debug.logFilePath, "utf-8");
    const logLines = logContent.trim().split("\n");
    const recentLines = logLines.slice(-lines);

    // Format for Discord (truncate if needed)
    let formatted = recentLines.join("\n");
    if (formatted.length > 4000) {
      formatted = formatted.slice(-4000);
    }

    const embed = new EmbedBuilder()
      .setColor(config.colors.info)
      .setTitle(`📝 Recent Logs (last ${lines} lines)`)
      .setDescription(`\`\`\`${formatted}\`\`\``)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    throw validationError("Could not read log file", {
      error: error.message,
    });
  }
}

// ===== Helper Functions =====

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);

  return parts.join(" ") || "< 1m";
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getAge(date) {
  const now = new Date();
  const diff = now - new Date(date);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  return "< 1h ago";
}

async function getDataFileSizes() {
  const sizes = [];

  for (const [name, path] of Object.entries(FILES)) {
    try {
      const stats = await fs.stat(path);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      sizes.push(`• ${name}: ${sizeMB} MB`);
    } catch {
      sizes.push(`• ${name}: N/A`);
    }
  }

  return sizes;
}

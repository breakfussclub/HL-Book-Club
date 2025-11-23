// commands/admin.js — Admin Management Command
// 🔧 Bot administration and monitoring
// ✅ System health monitoring
// ✅ Permission-restricted

import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
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

  // Defer reply for all admin commands (ephemeral)
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: 1 << 6 });
  }

  try {
    switch (subcommand) {
      case "status":
        await handleStatus(interaction);
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
        name: "⚙️ Configuration",
        value: [
          `Debug: ${config.debug.enabled ? "ON" : "OFF"}`,
          `Log Level: ${config.debug.logLevel}`,
        ].join("\n"),
        inline: true,
      }
    )
    .setFooter({ text: `Node.js ${process.version}` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ===== Logs Handler =====
async function handleLogs(interaction) {
  if (!config.debug.logToFile) {
    return interaction.editReply({
      content: "⚠️ File logging is not enabled. Set `LOG_TO_FILE=true` in Railway variables",
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
    // If file doesn't exist or can't be read
    await interaction.editReply({
      content: `⚠️ Could not read log file: ${error.message}`
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

// commands/my-stats.js — Phase 8 Classic + QoL Merge (Final Fixed)
// ✅ Displays user's reading analytics across all active books
// ✅ Compatible with index.js auto-defer (no duplicate replies)
// ✅ Fully Discord.js v14.16+ safe

import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { loadJSON, FILES } from "../utils/storage.js";
import { getUserLogs, calcBookStats } from "../utils/analytics.js";

const PURPLE = 0x8b5cf6;
const DEBUG = process.env.DEBUG === "true";

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const fmtTime = (d) => new Date(d).toLocaleString();

const progressBarPages = (current, total, width = 18) => {
  if (!total || total <= 0) return "▱".repeat(width);
  const pct = clamp(current / total, 0, 1);
  const filled = Math.round(pct * width);
  return "▰".repeat(filled) + "▱".repeat(width - filled);
};

// ===== Slash Command Definition =====
export const definitions = [
  new SlashCommandBuilder()
    .setName("my-stats")
    .setDescription("Show your reading stats for all active books"),
].map((c) => c.toJSON());

// ===== Execute =====
export async function execute(interaction) {
  try {
    // ❌ Removed deferReply — already handled by index.js

    const trackers = await loadJSON(FILES.TRACKERS);
    const userTrackers =
      trackers[interaction.user.id]?.tracked?.filter((t) => !t.archived) || [];

    if (!userTrackers.length) {
      return await interaction.editReply({
        content: "You have no active trackers yet. Use `/tracker` to start one.",
      });
    }

    const logs = await getUserLogs(interaction.user.id);

    const lines = userTrackers.slice(0, 8).map((t) => {
      const stats = calcBookStats(logs, t.id);
      const cp = Number(t.currentPage || 0);
      const tp = Number(t.totalPages || 0);
      const pct = tp ? `${Math.round(clamp(cp / tp, 0, 1) * 100)}%` : "—";
      return [
        `• **${t.title}** ${t.author ? `— *${t.author}*` : ""}`,
        `${progressBarPages(cp, tp)} Page ${cp}${tp ? `/${tp}` : ""} (${pct})`,
        `📈 avg **${stats.avgPerDay.toFixed(1)}**/day • 🔥 **${stats.streak}d** • ⏱ ${
          stats.lastAt ? fmtTime(stats.lastAt) : "—"
        }`,
      ].join("\n");
    });

    const e = new EmbedBuilder()
      .setTitle("📊 My Reading Stats (Active Books)")
      .setColor(PURPLE)
      .setDescription(lines.join("\n\n"))
      .setFooter({ text: `Total active trackers: ${userTrackers.length}` });

    await interaction.editReply({ embeds: [e] });

    if (DEBUG)
      console.log(
        `[my-stats] ${interaction.user.username} viewed ${userTrackers.length} trackers`
      );
  } catch (err) {
    console.error("[my-stats.execute]", err);
    const msg = { content: "⚠️ Failed to load your stats.", flags: 1 << 6 };
    try {
      if (interaction.deferred || interaction.replied)
        await interaction.editReply(msg);
      else await interaction.reply(msg);
    } catch (nested) {
      console.error("[my-stats fallback]", nested);
    }
  }
}


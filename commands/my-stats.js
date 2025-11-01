// commands/my-stats.js — Phase 8 Classic + QoL Merge
// ✅ Displays user's reading analytics across all active books
// ✅ Adds error safety, consistent visuals, and optional debug logs

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
    await interaction.deferReply({ ephemeral: true });

    const trackers = await loadJSON(FILES.TRACKERS);
    const userTrackers =
      trackers[interaction.user.id]?.tracked?.filter((t) => !t.archived) || [];

    if (!userTrackers.length) {
      return interaction.editReply({
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
        `📈 avg **${stats.avgPerDay.toFixed(1)}**/day • 🔥 **${stats.streak}d** • ⏱ ${stats.lastAt ? fmtTime(stats.lastAt) : "—"}`,
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
    const msg = { content: "⚠️ Failed to load your stats.", ephemeral: true };
    if (interaction.deferred || interaction.replied)
      await interaction.editReply(msg);
    else await interaction.reply(msg);
  }
}


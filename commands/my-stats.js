// commands/my-stats.js — Optimized with SQL
// ✅ Displays user's reading analytics across all active books
// ✅ Uses SQL for trackers and history
// ✅ Consistent with new DB schema

import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { query } from "../utils/db.js";
import { getUserLogs, calcBookStats } from "../utils/analytics.js";
import { logger } from "../utils/logger.js";

const PURPLE = 0x8b5cf6;

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const fmtTime = (d) => new Date(d).toLocaleString();

const progressBarPages = (current, total, width = 18) => {
  if (!total || total <= 0) return "▱".repeat(width);
  const pct = clamp(current / total, 0, 1);
  const filled = Math.round(pct * width);
  return "▰".repeat(filled) + "▱".repeat(width - filled);
};

export const definitions = [
  new SlashCommandBuilder()
    .setName("my-stats")
    .setDescription("Show your reading stats for all active books"),
].map((c) => c.toJSON());

export async function execute(interaction) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply();
    }

    const userId = interaction.user.id;

    // 1. Get Active Trackers from DB
    const sql = `
      SELECT rl.*, b.title, b.author
      FROM bc_reading_logs rl
      JOIN bc_books b ON rl.book_id = b.book_id
      WHERE rl.user_id = $1 AND rl.status = 'reading'
      ORDER BY rl.updated_at DESC
      LIMIT 8
    `;
    const res = await query(sql, [userId]);
    const activeBooks = res.rows;

    if (!activeBooks.length) {
      return await interaction.editReply({
        content: "You have no active trackers yet. Use `/tracker` to start one.",
      });
    }

    // 2. Get Logs for stats calculation
    // We can fetch logs for all these books in one go or per book.
    // getUserLogs fetches from bc_reading_history.
    // Let's iterate for now as getUserLogs is already optimized to use DB.

    const lines = [];
    for (const t of activeBooks) {
      const logs = await getUserLogs(userId, t.book_id);
      const stats = calcBookStats(logs);

      const cp = Number(t.current_page || 0);
      const tp = Number(t.total_pages || 0);
      const pct = tp ? `${Math.round(clamp(cp / tp, 0, 1) * 100)}%` : "—";

      // Find last activity from logs or updated_at
      const lastAt = logs.length > 0 ? logs[0].timestamp : t.updated_at;

      lines.push([
        `• **${t.title}** ${t.author ? `— *${t.author}*` : ""}`,
        `${progressBarPages(cp, tp)} Page ${cp}${tp ? `/${tp}` : ""} (${pct})`,
        `📈 avg **${stats.avgPerDay.toFixed(1)}**/day • 🔥 **${stats.streak}d** • ⏱ ${lastAt ? fmtTime(lastAt) : "—"
        }`,
      ].join("\n"));
    }

    const e = new EmbedBuilder()
      .setTitle("📊 My Reading Stats (Active Books)")
      .setColor(PURPLE)
      .setDescription(lines.join("\n\n"))
      .setFooter({ text: `Total active trackers: ${activeBooks.length}` });

    await interaction.editReply({ embeds: [e] });

  } catch (err) {
    logger.error("[my-stats.execute]", err);
    const msg = { content: "⚠️ Failed to load your stats.", flags: 1 << 6 };
    if (interaction.deferred || interaction.replied)
      await interaction.editReply(msg);
    else await interaction.reply(msg);
  }
}

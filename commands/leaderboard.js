// commands/leaderboard.js
// 🏆 Displays top readers
// ✅ Optimized SQL queries
// ✅ Uses bc_reading_history for accurate page counts

import { SlashCommandBuilder } from "discord.js";
import { query } from "../utils/db.js";
import { leaderboardEmbed } from "../views/leaderboard.js";
import { logger } from "../utils/logger.js";

export const definitions = [
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show top readers by pages read or books completed")
    .addStringOption((o) =>
      o
        .setName("range")
        .setDescription("Time range")
        .setChoices(
          { name: "All time", value: "all" },
          { name: "This month", value: "month" },
          { name: "This week", value: "week" }
        )
    ),
].map((c) => c.toJSON());

async function getScores(range) {
  const now = new Date();
  let since = null;

  if (range === "week") {
    since = new Date(now.getTime() - 7 * 86400000);
  } else if (range === "month") {
    since = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  // 1. Get Pages Read (from history)
  let pagesSql = `
    SELECT user_id, SUM(pages_read) as pages
    FROM bc_reading_history
  `;
  const params = [];

  if (since) {
    pagesSql += ` WHERE timestamp >= $1`;
    params.push(since);
  }

  pagesSql += ` GROUP BY user_id`;

  const pagesRes = await query(pagesSql, params);
  const pagesMap = new Map();
  pagesRes.rows.forEach(r => pagesMap.set(r.user_id, parseInt(r.pages)));

  // 2. Get Completed Books (from logs)
  // Note: This relies on completed_at being set correctly
  let compSql = `
    SELECT user_id, COUNT(*) as count
    FROM bc_reading_logs
    WHERE status = 'completed'
  `;
  const compParams = [];

  if (since) {
    compSql += ` AND completed_at >= $1`;
    compParams.push(since);
  }

  compSql += ` GROUP BY user_id`;

  const compRes = await query(compSql, compParams);
  const compMap = new Map();
  compRes.rows.forEach(r => compMap.set(r.user_id, parseInt(r.count)));

  // 3. Combine
  const allUsers = new Set([...pagesMap.keys(), ...compMap.keys()]);
  const scores = [];

  for (const uid of allUsers) {
    scores.push({
      userId: uid,
      pages: pagesMap.get(uid) || 0,
      completed: compMap.get(uid) || 0
    });
  }

  // Sort: Pages desc, then Completed desc
  scores.sort((a, b) => b.pages - a.pages || b.completed - a.completed);

  return scores;
}

export async function execute(interaction) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply();
    }

    const range = interaction.options.getString("range") || "all";
    const scores = await getScores(range);
    const embed = leaderboardEmbed(interaction, scores, range);

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    logger.error("[leaderboard.execute]", err);
    const msg = { content: "⚠️ Something went wrong.", flags: 1 << 6 };
    if (interaction.deferred || interaction.replied)
      await interaction.editReply(msg);
    else await interaction.reply(msg);
  }
}

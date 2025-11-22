// commands/profile.js — Optimized with SQL
// 📘 /profile — Displays a member's reading stats
// ✅ Uses SQL for book stats (performance)
// ✅ Uses JSON for quotes/goals (legacy compatibility)

import { SlashCommandBuilder } from "discord.js";
import { query } from "../utils/db.js";
import { loadJSON, FILES } from "../utils/storage.js";
import { buildProfileEmbed } from "../views/profile.js";
import { logger } from "../utils/logger.js";

async function getUserProfileData(userId) {
  // 1. Get Book Stats from DB
  const statsSql = `
    SELECT 
      COUNT(*) as books_tracked,
      SUM(current_page) as pages_read,
      COUNT(CASE WHEN status = 'completed' AND EXTRACT(YEAR FROM completed_at) = EXTRACT(YEAR FROM CURRENT_DATE) THEN 1 END) as completed_this_year
    FROM bc_reading_logs
    WHERE user_id = $1
  `;
  const statsRes = await query(statsSql, [userId]);
  const dbStats = statsRes.rows[0];

  // 2. Get Recent Books from DB
  const recentSql = `
    SELECT b.title, b.author, b.preview_link, b.thumbnail
    FROM bc_reading_logs rl
    JOIN bc_books b ON rl.book_id = b.book_id
    WHERE rl.user_id = $1
    ORDER BY rl.updated_at DESC
    LIMIT 3
  `;
  const recentRes = await query(recentSql, [userId]);

  // 3. Get Legacy Data (Quotes, Favorites, Goals)
  // TODO: Migrate these to DB
  const quotes = await loadJSON(FILES.QUOTES, {});
  const favorites = await loadJSON(FILES.FAVORITES, {});
  const goals = await loadJSON(FILES.READING_GOALS, {});

  const userQuotes = quotes[userId] || [];
  const userFavorites = favorites[userId] || [];
  const userGoal = goals[userId] || null;

  return {
    booksTracked: parseInt(dbStats.books_tracked || 0),
    pagesRead: parseInt(dbStats.pages_read || 0),
    completedThisYear: parseInt(dbStats.completed_this_year || 0),
    recentBooks: recentRes.rows.map(b => ({
      title: b.title,
      author: b.author,
      previewLink: b.preview_link || b.thumbnail
    })),
    quotesSaved: userQuotes.length,
    favorites: userFavorites.length,
    favoriteQuote: userQuotes.length > 0 ? userQuotes[userQuotes.length - 1].text : null,
    goal: userGoal
  };
}

export const definitions = [
  new SlashCommandBuilder()
    .setName("profile")
    .setDescription("View your HL Book Club profile")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("View another member's profile")
    ),
].map((c) => c.toJSON());

export async function execute(interaction) {
  try {
    const target = interaction.options.getUser("user") || interaction.user;
    if (!interaction.deferred && !interaction.replied)
      await interaction.deferReply({ ephemeral: false });

    const stats = await getUserProfileData(target.id);
    const embed = buildProfileEmbed(interaction, target, stats);

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    logger.error("[profile.execute]", err);
    const msg = { content: "⚠️ Something went wrong.", flags: 1 << 6 };
    if (interaction.deferred || interaction.replied)
      await interaction.editReply(msg);
    else await interaction.reply(msg);
  }
}

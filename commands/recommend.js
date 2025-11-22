// commands/recommend.js — Optimized with SQL
// ✅ Analyzes reading history from DB
// ✅ Uses Google Books API for related books
// ✅ Filters out already-read books

import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { getRecommendations } from "../utils/recommendations.js";
import { query } from "../utils/db.js";
import { logger } from "../utils/logger.js";

const PURPLE = 0x9b59b6;
const INFO_BLUE = 0x3498db;

export const definitions = [
  new SlashCommandBuilder()
    .setName("recommend")
    .setDescription("Get personalized book recommendations")
    .addStringOption((opt) =>
      opt
        .setName("genre")
        .setDescription("Filter by genre (optional)")
        .setRequired(false)
    )
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("Get recommendations for another user (optional)")
        .setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("count")
        .setDescription("Number of recommendations (default: 5)")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(10)
    ),
].map((c) => c.toJSON());

export async function execute(interaction) {
  await interaction.deferReply();

  const targetUser = interaction.options.getUser("user") || interaction.user;
  const genre = interaction.options.getString("genre");
  const count = interaction.options.getInteger("count") || 5;

  try {
    // Get user's reading history from DB
    const sql = `
      SELECT b.title, b.author, rl.status
      FROM bc_reading_logs rl
      JOIN bc_books b ON rl.book_id = b.book_id
      WHERE rl.user_id = $1
    `;
    const res = await query(sql, [targetUser.id]);
    const userBooks = res.rows;

    if (userBooks.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(INFO_BLUE)
        .setTitle("📚 No Reading History")
        .setDescription(
          `${targetUser.id === interaction.user.id ? "You haven't" : `${targetUser.username} hasn't`} tracked any books yet.\n\n` +
          "Add some books to your tracker first:\n" +
          "• Use `/search` to find books\n" +
          "• Use `/tracker` to add books\n" +
          "• Sync from Goodreads with `/goodreads link`"
        );

      return interaction.editReply({ embeds: [embed] });
    }

    // Get recommendations
    // Note: getRecommendations likely expects a list of books with title/author/status
    // We pass the DB result which matches the structure expected (mostly)
    // We might need to verify getRecommendations signature.
    // Assuming it takes (userId, options, userBooksOverride) or fetches internally.
    // If it fetches internally using loadJSON, we need to update IT too.
    // Let's assume for now we pass the books or update the util.
    // Checking the import: import { getRecommendations } from "../utils/recommendations.js";
    // I should check utils/recommendations.js.
    // If it uses loadJSON internally, I need to refactor it OR pass the books.
    // The previous code called: getRecommendations(targetUser.id, { genre, limit: count });
    // It didn't pass books. So getRecommendations likely loads JSON.

    // I will update this command to pass the books if the function supports it, 
    // OR I need to refactor utils/recommendations.js.
    // Given I can't see utils/recommendations.js right now, I'll assume I need to refactor it.
    // But wait, I can just pass the books if I modify the util.

    // Let's pause and check utils/recommendations.js in the next step.
    // For now, I'll write this file assuming I'll update the util to accept `userBooks` or use DB.

    const recommendations = await getRecommendations(targetUser.id, {
      genre,
      limit: count,
      userBooks // Passing this to be safe, will update util to use it
    });

    if (!recommendations || recommendations.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(INFO_BLUE)
        .setTitle("📚 No Recommendations Found")
        .setDescription(
          "We couldn't find recommendations based on your reading history.\n\n" +
          "This might happen if:\n" +
          "• Your books don't have enough metadata\n" +
          "• The genre filter is too specific\n" +
          "• Google Books API is temporarily unavailable\n\n" +
          "Try again without filters or add more books to your tracker!"
        );

      return interaction.editReply({ embeds: [embed] });
    }

    // Build recommendation embed
    const completedCount = userBooks.filter((b) => b.status === "completed").length;

    const embed = new EmbedBuilder()
      .setColor(PURPLE)
      .setTitle(
        `📚 Recommendations${genre ? ` (${genre})` : ""} for ${targetUser.id === interaction.user.id ? "You" : targetUser.username
        }`
      )
      .setDescription(
        `Based on ${completedCount} completed book${completedCount === 1 ? "" : "s"
        }\n\n` +
        `Showing **${recommendations.length}** recommendation${recommendations.length === 1 ? "" : "s"
        }`
      );

    // Add each recommendation as a field
    for (let i = 0; i < recommendations.length; i++) {
      const book = recommendations[i];
      const fieldValue =
        `**By:** ${book.authors?.join(", ") || "Unknown"}\n` +
        (book.pageCount ? `**Pages:** ${book.pageCount}\n` : "") +
        (book.averageRating ? `**Rating:** ⭐ ${book.averageRating}/5\n` : "") +
        (book.reason ? `*${book.reason}*\n` : "") +
        (book.previewLink ? `[View on Google Books](${book.previewLink})` : "");

      embed.addFields({
        name: `${i + 1}. ${book.title}`,
        value: fieldValue,
        inline: false,
      });
    }

    embed.setFooter({
      text: "Use /search to find these books and add them to your tracker!",
    });

    if (recommendations[0]?.thumbnail) {
      embed.setThumbnail(recommendations[0].thumbnail);
    }

    await interaction.editReply({ embeds: [embed] });

    logger.info("Generated recommendations", {
      userId: targetUser.id,
      count: recommendations.length,
      genre: genre || "all",
    });
  } catch (error) {
    logger.error("Recommendations error", {
      userId: targetUser.id,
      error: error.message,
    });

    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle("❌ Error Generating Recommendations")
      .setDescription(
        "Something went wrong while generating recommendations.\n\n" +
        "Please try again later or contact a server admin."
      );

    await interaction.editReply({ embeds: [embed] });
  }
}

export const commandName = "recommend";

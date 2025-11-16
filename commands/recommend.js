// commands/recommend.js — Personalized Book Recommendations
// ✅ Analyzes reading history for personalized suggestions
// ✅ Uses Google Books API for related books
// ✅ Filters out already-read books
// ✅ Genre and author-based recommendations
// ✅ Considers reading goals for length suggestions

import { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } from "discord.js";
import { getRecommendations } from "../utils/recommendations.js";
import { loadJSON, FILES } from "../utils/storage.js";
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
    // Get user's reading history
    const trackers = await loadJSON(FILES.TRACKERS, {});
    const userBooks = trackers[targetUser.id]?.tracked || [];

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
    const recommendations = await getRecommendations(targetUser.id, {
      genre,
      limit: count,
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
    const embed = new EmbedBuilder()
      .setColor(PURPLE)
      .setTitle(
        `📚 Recommendations${genre ? ` (${genre})` : ""} for ${
          targetUser.id === interaction.user.id ? "You" : targetUser.username
        }`
      )
      .setDescription(
        `Based on ${userBooks.filter((b) => b.status === "completed").length} completed book${
          userBooks.filter((b) => b.status === "completed").length === 1 ? "" : "s"
        }\n\n` +
        `Showing **${recommendations.length}** recommendation${
          recommendations.length === 1 ? "" : "s"
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

    // Add thumbnail from first recommendation
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

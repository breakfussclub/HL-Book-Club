// commands/profile.js — HL Book Club Member Profile (Phase 10 Final)
// 📘 /profile — Displays a member’s reading stats, activity, and avatar
// ✅ Reads data from trackers, favorites, quotes
// ✅ Includes avatar thumbnail + HL Book Club branding
// ✅ Unified visual style with Bookshelf

import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { loadJSON, FILES } from "../utils/storage.js";
import { EMBED_THEME } from "../utils/embedThemes.js";

// 📊 Helper — aggregate data across trackers, quotes, favorites
async function getUserProfileData(userId) {
  const trackers = await loadJSON(FILES.TRACKERS);
  const quotes = await loadJSON(FILES.QUOTES);
  const favorites = await loadJSON(FILES.FAVORITES);

  const trackedBooks = trackers[userId]?.tracked || [];
  const totalPages = trackedBooks.reduce(
    (sum, b) => sum + (b.currentPage || 0),
    0
  );

  const stats = {
    booksTracked: trackedBooks.length,
    pagesRead: totalPages,
    quotesSaved: quotes[userId]?.length || 0,
    favorites: favorites[userId]?.length || 0,
    recentBooks: trackedBooks.slice(-3).reverse(),
    favoriteQuote:
      quotes[userId]?.length > 0
        ? quotes[userId][quotes[userId].length - 1].text
        : null,
  };

  return stats;
}

// 🏅 Helper — assign badges dynamically
function generateBadges(stats) {
  const badges = [];
  if (stats.booksTracked >= 10) badges.push("📚 **Bookworm**");
  if (stats.quotesSaved >= 5) badges.push("💬 **Quote Keeper**");
  if (stats.favorites >= 10) badges.push("❤️ **Curator**");
  if (stats.pagesRead >= 1000) badges.push("🏆 **Page Turner**");
  if (badges.length === 0) badges.push("✨ **Getting Started**");
  return badges.join(" • ");
}

export const definitions = [
  new SlashCommandBuilder()
    .setName("profile")
    .setDescription("View your HL Book Club profile")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("View another member’s profile")
    ),
].map((c) => c.toJSON());

export async function execute(interaction) {
  const target = interaction.options.getUser("user") || interaction.user;
  if (!interaction.deferred && !interaction.replied)
    await interaction.deferReply({ ephemeral: false });

  const theme = EMBED_THEME.HL_BOOK_CLUB || EMBED_THEME.DEFAULT;
  const stats = await getUserProfileData(target.id);
  const badges = generateBadges(stats);

  // Build description body
  const descLines = [
    `**Books Tracked:** ${stats.booksTracked}`,
    `**Pages Read:** ${stats.pagesRead}`,
    `**Quotes Saved:** ${stats.quotesSaved}`,
    `**Favorites:** ${stats.favorites}`,
  ];

  const recentSection =
    stats.recentBooks.length > 0
      ? "\n**📖 Recent Reads:**\n" +
        stats.recentBooks
          .map(
            (b) =>
              `• [${b.title || "Untitled"}](${
                b.previewLink ||
                `https://www.google.com/search?q=${encodeURIComponent(
                  b.title || ""
                )}`
              })${b.author ? ` by ${b.author}` : ""}`
          )
          .join("\n")
      : "";

  const quoteSection = stats.favoriteQuote
    ? `\n**🪶 Favorite Quote:**\n“${stats.favoriteQuote}”`
    : "";

  const embed = new EmbedBuilder()
    .setColor(theme.color)
    .setTitle(`📘 ${target.username}'s HL Book Club Profile`)
    .setThumbnail(target.displayAvatarURL({ dynamic: true, size: 256 }))
    .setDescription(`${descLines.join("\n")}${recentSection}${quoteSection}`)
    .addFields({
      name: "🏅 Achievements",
      value: badges,
      inline: false,
    })
    .setFooter({
      text: "HL Book Club • Higher-er Learning",
      iconURL: interaction.client.user.displayAvatarURL(),
    });

  await interaction.editReply({ embeds: [embed] });
}

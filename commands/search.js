// commands/search.js — HL Book Club Edition (Force Public Output)
// ✅ Forces /search to display publicly regardless of global defaults
// ✅ Retains ❤️ Favorite logic (PostgreSQL)
// ✅ Google Books integration
// ✅ FIXED: Amazon links now use proper ISBN filtering

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
} from "discord.js";

import { hybridSearchMany } from "../utils/search.js";
import { EMBED_THEME } from "../utils/embedThemes.js";
import { query } from "../utils/db.js";

const DEBUG = process.env.DEBUG === "true";

export const definitions = [
  new SlashCommandBuilder()
    .setName("search")
    .setDescription("Search for a book by title, author, or ISBN")
    .addStringOption((o) =>
      o
        .setName("query")
        .setDescription("Enter a book title, author, or ISBN")
        .setRequired(true)
    ),
].map((c) => c.toJSON());

export async function execute(interaction) {
  try {
    const searchQuery = interaction.options.getString("query", true);

    // ✅ Defer quietly (private placeholder) so no errors
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true });
    }

    const results = await hybridSearchMany(searchQuery, 1);

    if (!results?.length) {
      return interaction.followUp({
        content: `No results found for **${searchQuery}**.`,
      });
    }

    const book = results[0];

    // ✅ FIXED: Extract actual ISBN (not EAN), prefer ISBN_10
    const isbn10 = book.industryIdentifiers?.find(id => id.type === 'ISBN_10')?.identifier;
    const isbn13 = book.industryIdentifiers?.find(id => id.type === 'ISBN_13')?.identifier;
    const isbn = isbn10 || isbn13;

    // Build Amazon URL with proper format
    const amazonUrl = isbn
      ? `https://www.amazon.com/dp/${isbn.replace(/-/g, '')}`
      : `https://www.amazon.com/s?i=stripbooks&k=${encodeURIComponent(book.title + ' ' + (book.authors?.[0] || ''))}`;

    const theme =
      EMBED_THEME.HL_BOOK_CLUB ??
      EMBED_THEME.DEFAULT ??
      { color: 0x8b5cf6 };

    const embed = new EmbedBuilder()
      .setColor(theme.color)
      .setAuthor({
        name: "HL Book Club",
        iconURL: interaction.client.user.displayAvatarURL(),
      })
      .setTitle(book.title || "Untitled")
      .setURL(book.previewLink || null)
      .setDescription(
        book.description
          ? book.description.slice(0, 400) +
          (book.description.length > 400 ? "..." : "")
          : "No summary available."
      )
      .addFields(
        {
          name: "Authors",
          value: book.authors?.join(", ") || "Unknown",
          inline: true,
        },
        {
          name: "Language",
          value: book.language?.toUpperCase() || "—",
          inline: true,
        },
        {
          name: "Page Count",
          value: book.pageCount ? String(book.pageCount) : "—",
          inline: true,
        }
      )
      .setFooter({
        text: `${book.source || "Google Books"}${book.publishedDate ? ` • Published ${book.publishedDate}` : ""
          } • HL Book Club • Higher-er Learning`,
      });

    if (book.thumbnail) embed.setThumbnail(book.thumbnail);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("View on Google Books")
        .setStyle(ButtonStyle.Link)
        .setURL(
          book.previewLink ||
          `https://www.google.com/search?q=${encodeURIComponent(book.title)}`
        ),
      new ButtonBuilder()
        .setLabel("View on Amazon")
        .setStyle(ButtonStyle.Link)
        .setURL(amazonUrl),
      new ButtonBuilder()
        .setCustomId("fav_add")
        .setLabel("❤️ Favorite")
        .setStyle(ButtonStyle.Secondary)
    );

    // ✅ cache the book for favorites
    interaction.client.latestSearch = interaction.client.latestSearch || new Map();
    interaction.client.latestSearch.set(interaction.user.id, book);

    // ✅ Force a new PUBLIC message
    await interaction.followUp({ embeds: [embed], components: [row] });

    if (DEBUG)
      console.log(`[search] "${book.title}" shown to ${interaction.user.username}`);
  } catch (err) {
    console.error("[search.execute]", err);
    try {
      await interaction.followUp({ content: "⚠️ Something went wrong." });
    } catch { }
  }
}

// ❤️ Favorite button handler (ephemeral confirmation)
export async function handleComponent(i) {
  try {
    if (i.isButton() && i.customId === "fav_add") {
      const book = i.client.latestSearch?.get(i.user.id);

      if (!book)
        return i.reply({
          content: "⚠️ No recent book found. Try searching again.",
          flags: 1 << 6,
        });

      const userId = i.user.id;

      // Ensure user exists
      await query(`INSERT INTO bc_users (user_id, username) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`, [userId, i.user.username]);

      // Check if already favorited
      const check = await query(`SELECT 1 FROM bc_favorites WHERE user_id = $1 AND book_id = $2`, [userId, book.id]);

      if (check.rowCount > 0) {
        return i.reply({
          content: `❤️ **${book.title || "Untitled"}** is already in your favorites.`,
          flags: 1 << 6,
        });
      }

      // Add to favorites
      await query(`
        INSERT INTO bc_favorites (user_id, book_id, title, author, thumbnail)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        userId,
        book.id,
        book.title || "Untitled",
        book.authors?.[0] || "Unknown",
        book.thumbnail || null
      ]);

      await i.reply({
        content: `✅ Added **${book.title || "Untitled"}** to your favorites!`,
        flags: 1 << 6,
      });

      if (DEBUG)
        console.log(`[fav_add] ${i.user.username} favorited "${book.title}"`);
    }
  } catch (err) {
    console.error("[search.handleComponent]", err);
    try {
      await i.reply({ content: "⚠️ Couldn't add to favorites.", flags: 1 << 6 });
    } catch { }
  }
}

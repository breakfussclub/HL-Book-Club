// commands/search.js — HL Book Club Edition (Force Public Output)
// ✅ Forces /search to display publicly regardless of global defaults
// ✅ Retains ❤️ Favorite logic and Google Books integration
// ✅ Keeps debug logging + safety guards
// ✅ FIXED: Amazon links now properly search books category

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
} from "discord.js";

import { hybridSearchMany } from "../utils/search.js";
import { EMBED_THEME } from "../utils/embedThemes.js";
import { loadJSON, saveJSON, FILES } from "../utils/storage.js";

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
    const query = interaction.options.getString("query", true);

    // ✅ Defer quietly (private placeholder) so no errors
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true });
    }

    const results = await hybridSearchMany(query, 1);

    if (!results?.length) {
      return interaction.followUp({
        content: `No results found for **${query}**.`,
      });
    }

    const book = results[0];
    
    // ✅ FIXED: Proper Amazon book search
    const isbn = book.industryIdentifiers?.[0]?.identifier;
    const amazonUrl = isbn
      ? `https://www.amazon.com/s?i=stripbooks&rh=p_66:${isbn.replace(/-/g, '')}`
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
        text: `${book.source || "Google Books"}${
          book.publishedDate ? ` • Published ${book.publishedDate}` : ""
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
    } catch {}
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

      const favorites = await loadJSON(FILES.FAVORITES);
      favorites[i.user.id] = favorites[i.user.id] || [];
      const list = favorites[i.user.id];

      if (list.some((b) => b.id === book.id)) {
        return i.reply({
          content: `❤️ **${book.title || "Untitled"}** is already in your favorites.`,
          flags: 1 << 6,
        });
      }

      list.push({
        id: book.id,
        userId: i.user.id,
        title: book.title || "Untitled",
        authors: book.authors || [],
        thumbnail: book.thumbnail || null,
        previewLink: book.previewLink || null,
        addedAt: new Date().toISOString(),
      });

      await saveJSON(FILES.FAVORITES, favorites);

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
    } catch {}
  }
}

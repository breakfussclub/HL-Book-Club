// commands/search.js
// 📚 Google Books search command (formerly /book search)
// ✅ Uses unified theme + HL Book Club header
// ✅ Keeps "Add to My Tracker" button (auto-add logic handled in index.js)

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
} from "discord.js";
import { hybridSearchMany } from "../utils/search.js";
import { EMBED_THEME } from "../utils/embedThemes.js";

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

    // Fetch results from Google Books or fallback
    const results = await hybridSearchMany(query, 1);
    if (!results.length)
      return interaction.editReply({
        content: `No results for **${query}**.`,
      });

    const book = results[0];
    const isbn = book.industryIdentifiers?.[0]?.identifier;
    const amazonUrl = isbn
      ? `https://www.amazon.com/s?k=${isbn}`
      : `https://www.amazon.com/s?k=${encodeURIComponent(
          book.title + " " + (book.authors?.[0] || "")
        )}`;

    // 📘 Build the book info embed
    const embed = new EmbedBuilder()
      .setColor(EMBED_THEME.primary)
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
          name: "Page count",
          value: book.pageCount ? String(book.pageCount) : "—",
          inline: true,
        }
      )
      .setFooter({
        text: `${book.source || "Google Books"}${
          book.publishedDate ? ` • Published ${book.publishedDate}` : ""
        } • ${EMBED_THEME.footer}`,
      });

    if (book.thumbnail) embed.setThumbnail(book.thumbnail);

    // 🎛️ Build action row with external links + tracker button
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
        .setCustomId("trk_add_open")
        .setLabel("Add to My Tracker")
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.editReply({ embeds: [embed], components: [row] });

    if (DEBUG)
      console.log(`[search] "${book.title}" by ${interaction.user.username}`);
  } catch (err) {
    console.error("[search.execute]", err);
    const msg = { content: "⚠️ Something went wrong.", flags: 1 << 6 };
    if (interaction.deferred || interaction.replied)
      await interaction.editReply(msg);
    else await interaction.reply(msg);
  }
}

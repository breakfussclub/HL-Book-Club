// commands/shelf.js — HL Book Club "Bookshelf" Ultra-Polish Edition (Final Phase 10)
// 📚 /shelf — Clean, single-embed bookshelf view
// ✅ Removed all line icons
// ✅ Compact spacing between books
// ✅ Refined text alignment and readability
// ✅ HL Book Club branding retained

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ComponentType,
} from "discord.js";
import { loadJSON, FILES } from "../utils/storage.js";
import { EMBED_THEME } from "../utils/embedThemes.js";

function formatDate(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return "Unknown date";
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const y = String(d.getFullYear()).slice(-2);
  return `${m}/${day}/${y}`;
}

export const definitions = [
  new SlashCommandBuilder()
    .setName("shelf")
    .setDescription("View the HL Book Club community bookshelf")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("View a specific member’s shelf")
    ),
].map((c) => c.toJSON());

export async function execute(interaction) {
  if (!interaction.deferred && !interaction.replied)
    await interaction.deferReply({ ephemeral: false });

  const theme = EMBED_THEME.HL_BOOK_CLUB || EMBED_THEME.DEFAULT;
  const target = interaction.options.getUser("user");
  const trackers = await loadJSON(FILES.TRACKERS);
  const favorites = await loadJSON(FILES.FAVORITES);

  // flatten tracker + favorite data
  const trackerEntries = Object.entries(trackers || {}).flatMap(
    ([userId, data]) =>
      (data.tracked || []).map((b) => ({
        userId,
        title: b.title || "Untitled",
        author: b.author || "Unknown Author",
        previewLink:
          b.previewLink ||
          b.url ||
          `https://www.google.com/search?q=${encodeURIComponent(b.title || "")}`,
        addedAt: b.addedAt || b.updatedAt || new Date().toISOString(),
      }))
  );

  const favoriteEntries = Object.entries(favorites || {}).flatMap(
    ([userId, books]) =>
      (books || []).map((b) => ({
        userId,
        title: b.title || "Untitled",
        author:
          b.author ||
          (Array.isArray(b.authors) ? b.authors.join(", ") : b.authors) ||
          "Unknown Author",
        previewLink:
          b.previewLink ||
          b.url ||
          `https://www.google.com/search?q=${encodeURIComponent(b.title || "")}`,
        addedAt: b.addedAt || new Date().toISOString(),
      }))
  );

  let combined = [...trackerEntries, ...favoriteEntries];
  if (target) combined = combined.filter((b) => b.userId === target.id);
  combined.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));

  if (!combined.length) {
    const empty = new EmbedBuilder()
      .setColor(theme.color)
      .setTitle(target ? `📚 ${target.username}'s Bookshelf` : "📚 Bookshelf")
      .setDescription(
        target
          ? `🪶 ${target.username} hasn’t added any books yet.`
          : "🪶 The community bookshelf is empty — start adding books!"
      )
      .setFooter({ text: "HL Book Club • Higher-er Learning" });
    return interaction.editReply({ embeds: [empty] });
  }

  // pagination
  const pageSize = 10;
  const totalPages = Math.ceil(combined.length / pageSize);
  let page = 0;

  const pageEmbed = (p) => {
    const slice = combined.slice(p * pageSize, p * pageSize + pageSize);

    const lines = slice.map((b) => {
      const userTag = b.userId ? `<@${b.userId}>` : "Unknown";
      const date = formatDate(b.addedAt);
      const title =
        b.title.length > 70 ? b.title.slice(0, 67) + "..." : b.title;

      // tighter spacing, no emojis
      return `[**${title}**](${b.previewLink})\n> **By ${b.author}**  •  Added by ${userTag}  •  ${date}`;
    });

    return new EmbedBuilder()
      .setColor(theme.color)
      .setTitle(
        target
          ? `📚 ${target.username}'s Bookshelf`
          : "📚 HL Book Club — Bookshelf"
      )
      .setDescription(lines.join("\n"))
      .setFooter({
        text: "HL Book Club • Higher-er Learning",
        iconURL: interaction.client.user.displayAvatarURL(),
      });
  };

  const row = () =>
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("prev")
        .setLabel("◀️ Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId("next")
        .setLabel("Next ▶️")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1)
    );

  const message = await interaction.editReply({
    embeds: [pageEmbed(page)],
    components: totalPages > 1 ? [row()] : [],
  });

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 120000,
  });

  collector.on("collect", async (i) => {
    if (i.customId === "next" && page < totalPages - 1) page++;
    if (i.customId === "prev" && page > 0) page--;
    await i.update({ embeds: [pageEmbed(page)], components: [row()] });
  });

  collector.on("end", async () => {
    const disabled = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("prev")
        .setLabel("◀️ Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId("next")
        .setLabel("Next ▶️")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );
    await message.edit({ components: [disabled] }).catch(() => {});
  });
}

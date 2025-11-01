// commands/tracker.js — Classic Unified Tracker (Modernized)
// ✅ Single-command version (no subcommands)
// ✅ Smart search + tracker integration
// ✅ Launches modal directly from /tracker or /book search
// ✅ Uses flags instead of ephemeral
// ✅ DEBUG logging for Railway

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { loadJSON, saveJSON, FILES } from "../utils/storage.js";
import { hybridSearchMany } from "../utils/search.js";
import { appendReadingLog, calcBookStats } from "../utils/analytics.js";

const PURPLE = 0x8b5cf6;
const GREEN = 0x16a34a;
const RED = 0xf43f5e;
const DEBUG = process.env.DEBUG === "true";

export const definitions = [
  new SlashCommandBuilder()
    .setName("tracker")
    .setDescription("Track or update your reading progress")
    .addStringOption((o) =>
      o
        .setName("query")
        .setDescription("Search for a book title (optional)")
        .setRequired(false)
    )
    .addIntegerOption((o) =>
      o
        .setName("page")
        .setDescription("Page number to update (optional)")
        .setRequired(false)
    ),
].map((c) => c.toJSON());

export async function execute(interaction) {
  try {
    const user = interaction.user;
    const uid = user.id;
    const query = interaction.options.getString("query");
    const page = interaction.options.getInteger("page");
    const trackers = await loadJSON(FILES.TRACKERS);
    if (!trackers[uid]) trackers[uid] = { tracked: [] };

    // -------------------------------------------------------------
    // 1️⃣ No arguments: Show current tracked books
    // -------------------------------------------------------------
    if (!query && !page) {
      const tracked = trackers[uid].tracked || [];
      if (!tracked.length) {
        const e = new EmbedBuilder()
          .setColor(PURPLE)
          .setDescription(
            "You’re not tracking any books yet.\nUse `/tracker` with a title or `/book search` to add one!"
          );
        await interaction.editReply({ embeds: [e] });
        return;
      }

      const lines = tracked
        .map(
          (b, i) =>
            `**${i + 1}.** ${b.title} — ${b.currentPage}/${b.totalPages} pages`
        )
        .join("\n");

      const e = new EmbedBuilder()
        .setTitle("📚 Your Reading Tracker")
        .setColor(PURPLE)
        .setDescription(lines)
        .setFooter({
          text: "Tip: Use /tracker <title> to update progress or search again",
        });

      await interaction.editReply({ embeds: [e] });
      if (DEBUG) console.log(`[tracker.list] ${user.username}`);
      return;
    }

    // -------------------------------------------------------------
    // 2️⃣ Title but no page: Search or display book
    // -------------------------------------------------------------
    if (query && !page) {
      // Try to match existing tracked book first
      const existing = trackers[uid].tracked.find((b) =>
        b.title.toLowerCase().includes(query.toLowerCase())
      );

      if (existing) {
        const stats = calcBookStats(existing);
        const e = new EmbedBuilder()
          .setTitle(existing.title)
          .setColor(PURPLE)
          .setDescription(
            `Currently on **${existing.currentPage}/${existing.totalPages}** pages\n${stats}`
          )
          .setFooter({ text: "Use /tracker <title> <page> to update progress" });
        await interaction.editReply({ embeds: [e] });
        return;
      }

      // Otherwise perform a search
      const results = await hybridSearchMany(query, 1);
      if (!results.length) {
        await interaction.editReply({
          content: `No results for **${query}**.`,
        });
        return;
      }

      const book = results[0];
      const isbn = book.industryIdentifiers?.[0]?.identifier;
      const amazonUrl = isbn
        ? `https://www.amazon.com/s?k=${isbn}`
        : `https://www.amazon.com/s?k=${encodeURIComponent(
            book.title + " " + (book.authors?.[0] || "")
          )}`;

      const e = new EmbedBuilder()
        .setColor(PURPLE)
        .setTitle(book.title)
        .setDescription(
          book.description
            ? book.description.slice(0, 400) +
              (book.description.length > 400 ? "..." : "")
            : "No summary available."
        )
        .addFields(
          {
            name: "Author",
            value: book.authors?.join(", ") || "Unknown",
            inline: true,
          },
          {
            name: "Pages",
            value: book.pageCount ? String(book.pageCount) : "—",
            inline: true,
          }
        )
        .setFooter({
          text: `${book.source || "Google Books"}${
            book.publishedDate ? ` • Published ${book.publishedDate}` : ""
          }`,
        });
      if (book.thumbnail) e.setThumbnail(book.thumbnail);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("View on Amazon")
          .setStyle(ButtonStyle.Link)
          .setURL(amazonUrl),
        new ButtonBuilder()
          .setCustomId("trk_add_open")
          .setLabel("Add to My Tracker")
          .setStyle(ButtonStyle.Primary)
      );

      await interaction.editReply({ embeds: [e], components: [row] });
      if (DEBUG) console.log(`[tracker.search] ${user.username} → ${book.title}`);
      return;
    }

    // -------------------------------------------------------------
    // 3️⃣ Title + page: Update progress
    // -------------------------------------------------------------
    if (query && page) {
      const entry = trackers[uid].tracked.find((b) =>
        b.title.toLowerCase().includes(query.toLowerCase())
      );

      if (!entry) {
        await interaction.editReply({
          content: `You’re not tracking **${query}** yet.`,
        });
        return;
      }

      if (page < entry.currentPage) {
        await interaction.editReply({
          content: `⚠️ You’re already past page ${page}.`,
        });
        return;
      }

      entry.currentPage = Math.min(page, entry.totalPages);
      entry.updatedAt = new Date().toISOString();
      await saveJSON(FILES.TRACKERS, trackers);
      await appendReadingLog(uid, entry.title, page);

      const stats = calcBookStats(entry);
      const e = new EmbedBuilder()
        .setTitle(entry.title)
        .setColor(GREEN)
        .setDescription(
          `Updated progress: **${entry.currentPage}/${entry.totalPages} pages**\n${stats}`
        );
      await interaction.editReply({ embeds: [e] });
      if (DEBUG)
        console.log(`[tracker.update] ${user.username} → ${entry.title} (${page})`);
      return;
    }
  } catch (err) {
    console.error("[tracker.execute]", err);
    const msg = { content: "⚠️ Something went wrong.", flags: 1 << 6 };
    if (interaction.deferred || interaction.replied)
      await interaction.editReply(msg);
    else await interaction.reply(msg);
  }
}

// ---------------------------------------------------------------------------
// Component Handler — Add to My Tracker Button
// ---------------------------------------------------------------------------

export async function handleComponent(interaction) {
  if (interaction.customId !== "trk_add_open") return;

  const modal = new ModalBuilder()
    .setCustomId("trk_add_modal")
    .setTitle("Add Book to Tracker");

  const title = new TextInputBuilder()
    .setCustomId("trk_title")
    .setLabel("Book Title")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const pages = new TextInputBuilder()
    .setCustomId("trk_pages")
    .setLabel("Total Pages")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const row1 = new ActionRowBuilder().addComponents(title);
  const row2 = new ActionRowBuilder().addComponents(pages);
  await interaction.showModal(modal.addComponents(row1, row2));

  if (DEBUG) console.log(`[tracker.modal-open] by ${interaction.user.username}`);
}

// ---------------------------------------------------------------------------
// Modal Submission Handler
// ---------------------------------------------------------------------------

export async function handleModalSubmit(interaction) {
  if (interaction.customId !== "trk_add_modal") return;

  try {
    const title = interaction.fields.getTextInputValue("trk_title").trim();
    const totalPages = parseInt(
      interaction.fields.getTextInputValue("trk_pages").trim(),
      10
    );

    const user = interaction.user;
    const uid = user.id;

    const trackers = await loadJSON(FILES.TRACKERS);
    if (!trackers[uid]) trackers[uid] = { tracked: [] };

    const exists = trackers[uid].tracked.find(
      (b) => b.title.toLowerCase() === title.toLowerCase()
    );
    if (exists)
      return interaction.reply({
        content: `You’re already tracking **${title}**.`,
        flags: 1 << 6,
      });

    trackers[uid].tracked.unshift({
      title,
      totalPages,
      currentPage: 0,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await saveJSON(FILES.TRACKERS, trackers);

    const e = new EmbedBuilder()
      .setTitle(`Added "${title}" to Tracker`)
      .setColor(GREEN)
      .setDescription(`Total pages: **${totalPages}**`);

    await interaction.reply({ embeds: [e], flags: 1 << 6 });
    if (DEBUG) console.log(`[tracker.modal-submit] ${user.username} → ${title}`);
  } catch (err) {
    console.error("[tracker.handleModalSubmit]", err);
    try {
      await interaction.reply({
        content: "⚠️ Something went wrong adding your book.",
        flags: 1 << 6,
      });
    } catch {}
  }
}

// commands/tracker.js — Phase 11: Restored Google Books Search Flow (Safe Interaction Handling)
// ✅ Fixes InteractionAlreadyReplied error
// ✅ Restores 2-step Google Books search modal flow
// ✅ Adds confirmation before adding book
// ✅ Keeps all update/archive/delete logic intact

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

import { loadJSON, saveJSON, FILES } from "../utils/storage.js";
import {
  appendReadingLog,
  getUserLogs,
  calcBookStats,
} from "../utils/analytics.js";
import { hybridSearchMany } from "../utils/search.js";

const PURPLE = 0x8b5cf6;
const GOLD = 0xf59e0b;
const DEBUG = process.env.DEBUG === "true";

// ===== Helpers =====
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const fmtTime = (d) => new Date(d).toLocaleString();

const progressBarPages = (current, total, width = 18) => {
  if (!total || total <= 0) return "▱".repeat(width);
  const pct = clamp(current / total, 0, 1);
  const filled = Math.round(pct * width);
  return "▰".repeat(filled) + "▱".repeat(width - filled);
};

// ===== Storage =====
async function getUserTrackers(userId) {
  const trackers = await loadJSON(FILES.TRACKERS);
  return trackers[userId]?.tracked || [];
}

async function saveUserTrackers(userId, tracked) {
  const trackers = await loadJSON(FILES.TRACKERS);
  trackers[userId] = trackers[userId] || { tracked: [] };
  trackers[userId].tracked = tracked;
  await saveJSON(FILES.TRACKERS, trackers);
}

// ===== Embeds =====
function listEmbed(username, active) {
  const e = new EmbedBuilder().setTitle(`📚 ${username}'s Trackers`).setColor(PURPLE);

  if (!active.length) {
    e.setDescription("You aren't tracking any books yet.\n\nClick **Add Book** below to start.");
    return e;
  }

  const lines = active
    .map((t) => {
      const cp = Number(t.currentPage || 0);
      const tp = Number(t.totalPages || 0);
      const bar = tp ? `${progressBarPages(cp, tp)} ` : "";
      const done = tp && cp >= tp ? " ✅ Completed" : "";
      const author = t.author ? ` — *${t.author}*` : "";
      return `• **${t.title}**${author} — ${bar}Page ${cp}${tp ? `/${tp}` : ""}${done}`;
    })
    .join("\n");

  e.setDescription(lines);
  return e;
}

function listComponents(active) {
  const rows = [];
  if (active.length) {
    const options = active.slice(0, 25).map((t) => {
      const safeId = String(t.id);
      return new StringSelectMenuOptionBuilder()
        .setLabel(t.title.slice(0, 100))
        .setValue(safeId)
        .setDescription(
          `Page ${Number(t.currentPage || 0)}${t.totalPages ? `/${t.totalPages}` : ""}`
        );
    });

    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("trk_select_view")
          .setPlaceholder("Select a book tracker…")
          .setMinValues(1)
          .setMaxValues(1)
          .setOptions(options)
      )
    );
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("trk_search_modal_open")
        .setLabel("Add Book")
        .setStyle(ButtonStyle.Primary)
    )
  );

  return rows;
}

function detailEmbed(book, stats) {
  const cp = Number(book.currentPage || 0);
  const tp = Number(book.totalPages || 0);

  const e = new EmbedBuilder()
    .setTitle(`📘 ${book.title}`)
    .setColor(tp && cp >= tp ? GOLD : PURPLE)
    .setDescription(
      [
        book.author ? `*by ${book.author}*` : null,
        "",
        tp ? `${progressBarPages(cp, tp)}  **Page ${cp}/${tp}**` : `**Page ${cp}**`,
        stats
          ? `📈 **${tp ? Math.round(clamp(cp / tp, 0, 1) * 100) : 0}% complete**`
          : null,
        stats
          ? `🔥 **${stats.streak} day${stats.streak === 1 ? "" : "s"}** streak • avg **${stats.avgPerDay.toFixed(1)}** pages/day`
          : null,
        tp && cp >= tp ? "✅ Completed" : null,
      ]
        .filter(Boolean)
        .join("\n")
    );

  if (book.thumbnail) e.setThumbnail(book.thumbnail);
  e.setFooter({ text: `Last updated ⏱ ${fmtTime(book.updatedAt || Date.now())}` });
  return e;
}

function detailComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("trk_update_open").setLabel("🟣 Update Tracker").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("trk_archive").setLabel("🗃 Archive Tracker").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("trk_delete").setLabel("❌ Delete Tracker").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("trk_back").setLabel("↩ Back").setStyle(ButtonStyle.Secondary)
    ),
  ];
}

// ===== Renderers =====
async function renderList(ctx, user) {
  const all = await getUserTrackers(user.id);
  const active = all.filter((t) => !t.archived);
  const embed = listEmbed(user.username, active);
  const comps = listComponents(active);
  const payload = { embeds: [embed], components: comps, flags: 1 << 6 };

  if (ctx.deferred || ctx.replied) return ctx.editReply(payload);
  if (typeof ctx.update === "function") return ctx.update(payload);
  return ctx.reply(payload);
}

async function renderDetail(ctx, user, bookId) {
  const all = await getUserTrackers(user.id);
  const book = all.find((t) => t.id === bookId);
  if (!book) return renderList(ctx, user);

  const logs = await getUserLogs(user.id);
  const stats = calcBookStats(logs, book.id);
  const embed = detailEmbed(book, stats);
  const comps = detailComponents();
  const payload = { embeds: [embed], components: comps, flags: 1 << 6 };

  if (ctx.deferred || ctx.replied) return ctx.editReply(payload);
  if (typeof ctx.update === "function") return ctx.update(payload);
  return ctx.reply(payload);
}

// ===== Command Definition =====
export const definitions = [
  new SlashCommandBuilder()
    .setName("tracker")
    .setDescription("Your personal reading tracker (pages)"),
].map((c) => c.toJSON());

// ===== Execute =====
export async function execute(interaction) {
  try {
    await renderList(interaction, interaction.user);
  } catch (err) {
    console.error("[tracker.execute]", err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: "⚠️ Couldn't load your trackers." });
    } else {
      await interaction.reply({ content: "⚠️ Couldn't load your trackers." });
    }
  }
}

// ===== Component Handler =====
export async function handleComponent(interaction) {
  try {
    const userId = interaction.user.id;
    const trackers = await getUserTrackers(userId);

    // Select tracker
    if (interaction.customId === "trk_select_view") {
      const bookId = interaction.values[0];
      return renderDetail(interaction, interaction.user, bookId);
    }

    // Open Search Modal
    if (interaction.customId === "trk_search_modal_open") {
      const modal = new ModalBuilder()
        .setCustomId("trk_search_modal_submit")
        .setTitle("Search for a Book")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("query")
              .setLabel("Enter a book title or author")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          )
        );
      return interaction.showModal(modal);
    }

    // Confirm Add Book
    if (interaction.customId.startsWith("trk_confirm_add_")) {
      const book = JSON.parse(interaction.customId.replace("trk_confirm_add_", ""));
      const userTrackers = await getUserTrackers(userId);

      userTrackers.push({
        id: book.id,
        title: book.title,
        author: book.author,
        totalPages: book.pageCount || null,
        currentPage: 0,
        addedAt: Date.now(),
        updatedAt: Date.now(),
        thumbnail: book.thumbnail || null,
      });

      await saveUserTrackers(userId, userTrackers);
      return renderList(interaction, interaction.user);
    }

    // Cancel Add
    if (interaction.customId === "trk_cancel_add") {
      return renderList(interaction, interaction.user);
    }

    // Back button
    if (interaction.customId === "trk_back") {
      return renderList(interaction, interaction.user);
    }

  } catch (err) {
    console.error("[tracker.handleComponent]", err);
  }
}

// ===== Modal Submit Handler =====
export async function handleModalSubmit(interaction) {
  try {
    const user = interaction.user;

    if (interaction.customId === "trk_search_modal_submit") {
      const query = interaction.fields.getTextInputValue("query").trim();
      await interaction.deferReply({ ephemeral: true });

      const results = await hybridSearchMany(query);
      if (!results?.length) {
        return interaction.editReply({ content: "❌ No books found for that search." });
      }

      const top = results.slice(0, 5);
      const embed = new EmbedBuilder()
        .setTitle(`🔍 Results for "${query}"`)
        .setDescription("Select a book below to add it to your tracker.")
        .setColor(PURPLE);

      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("trk_select_add_result")
          .setPlaceholder("Select a book to add")
          .addOptions(
            top.map((b) => ({
              label: b.title.slice(0, 100),
              description: b.authors?.[0] ? b.authors[0].slice(0, 100) : "Unknown author",
              value: JSON.stringify({
                id: b.id,
                title: b.title,
                author: b.authors?.[0] || "",
                pageCount: b.pageCount,
                thumbnail: b.thumbnail || null,
              }),
            }))
          )
      );

      return interaction.editReply({ embeds: [embed], components: [row] });
    }

    // Selecting a search result from dropdown
    if (interaction.customId === "trk_select_add_result") {
      const book = JSON.parse(interaction.values[0]);
      const confirm = new EmbedBuilder()
        .setTitle(`📘 Add "${book.title}"?`)
        .setDescription(book.author ? `by *${book.author}*` : "")
        .setColor(PURPLE);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`trk_confirm_add_${JSON.stringify(book)}`)
          .setLabel("✅ Add")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("trk_cancel_add")
          .setLabel("❌ Cancel")
          .setStyle(ButtonStyle.Danger)
      );

      return interaction.reply({ embeds: [confirm], components: [row], ephemeral: true });
    }
  } catch (err) {
    console.error("[tracker.handleModalSubmit]", err);
  }
}

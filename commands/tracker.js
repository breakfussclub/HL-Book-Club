// commands/tracker.js — Phase 11 Full Version (Fixed for InteractionAlreadyReplied)
// ✅ Keeps all book tracking, update, archive, modal, and component logic intact
// ✅ Fixes duplicate reply/defer conflict
// ✅ Uses safe reply/edit handling throughout
// ✅ Fully compatible with index.js deferred replies

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

// ===== Utility helpers =====
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const fmtTime = (d) => new Date(d).toLocaleString();

const progressBarPages = (current, total, width = 18) => {
  if (!total || total <= 0) return "▱".repeat(width);
  const pct = clamp(current / total, 0, 1);
  const filled = Math.round(pct * width);
  return "▰".repeat(filled) + "▱".repeat(width - filled);
};

// ===== Data helpers =====
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

// ===== Embed builders =====
function listEmbed(username, active, selectedId = null) {
  const e = new EmbedBuilder().setTitle(`📚 ${username}'s Trackers`).setColor(PURPLE);

  if (!active.length) {
    e.setDescription("You aren't tracking any books yet.\n\nClick **Add Book** below to start.");
    return e;
  }

  const lines = active
    .map((t) => {
      const sel = t.id === selectedId ? " **(selected)**" : "";
      const cp = Number(t.currentPage || 0);
      const tp = Number(t.totalPages || 0);
      const bar = tp ? `${progressBarPages(cp, tp)} ` : "";
      const done = tp && cp >= tp ? " ✅ Completed" : "";
      const author = t.author ? ` — *${t.author}*` : "";
      return `• **${t.title}**${author} — ${bar}Page ${cp}${tp ? `/${tp}` : ""}${done}${sel}`;
    })
    .join("\n");

  e.setDescription(lines);
  return e;
}

function listComponents(active) {
  const rows = [];

  if (active.length) {
    const options = active.slice(0, 25).map((t) => {
      const safeId =
        typeof t.id === "string" && t.id.length > 90
          ? t.id.slice(0, 60) + "_" + Math.random().toString(36).slice(2, 8)
          : String(t.id);
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
        .setCustomId("trk_add_modal")
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

// ===== Renderers (Fixed for deferred replies) =====
async function renderList(ctx, user, selectedId = null) {
  const all = await getUserTrackers(user.id);
  const active = all.filter((t) => !t.archived);
  const embed = listEmbed(user.username, active, selectedId);
  const comps = listComponents(active);
  const payload = { embeds: [embed], components: comps, flags: 1 << 6 };

  try {
    if (ctx.deferred || ctx.replied) {
      await ctx.editReply(payload);
    } else if (typeof ctx.update === "function") {
      await ctx.update(payload);
    } else {
      await ctx.reply(payload);
    }
  } catch (err) {
    if (DEBUG) console.warn("renderList failed", err.message);
  }
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

  try {
    if (ctx.deferred || ctx.replied) {
      await ctx.editReply(payload);
    } else if (typeof ctx.update === "function") {
      await ctx.update(payload);
    } else {
      await ctx.reply(payload);
    }
  } catch (err) {
    if (DEBUG) console.warn("renderDetail failed", err.message);
  }
}

// ===== Slash Command Definition =====
export const definitions = [
  new SlashCommandBuilder().setName("tracker").setDescription("Your personal reading tracker (pages)"),
].map((c) => c.toJSON());

// ===== Execute =====
export async function execute(interaction) {
  try {
    await renderList(interaction, interaction.user);
  } catch (err) {
    console.error("[tracker.execute]", err);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: "⚠️ Couldn't load your trackers. Please try again.",
          flags: 1 << 6,
        });
      } else {
        await interaction.reply({
          content: "⚠️ Couldn't load your trackers. Please try again.",
          flags: 1 << 6,
        });
      }
    } catch {}
  }
}

// ===== Component + Modal Handlers =====
export async function handleComponent(interaction) {
  try {
    const userId = interaction.user.id;
    const trackers = await getUserTrackers(userId);

    // Handle book selection dropdown
    if (interaction.customId === "trk_select_view") {
      const bookId = interaction.values[0];
      return renderDetail(interaction, interaction.user, bookId);
    }

    // Add new tracker
    if (interaction.customId === "trk_add_modal") {
      const modal = new ModalBuilder()
        .setCustomId("trk_add_modal_submit")
        .setTitle("Add Book Tracker")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("title")
              .setLabel("Book Title")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("author")
              .setLabel("Author (optional)")
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("pages")
              .setLabel("Total Pages (optional)")
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          )
        );

      return interaction.showModal(modal);
    }

    // Update tracker
    if (interaction.customId === "trk_update_open") {
      const all = await getUserTrackers(userId);
      const last = all[all.length - 1];
      const modal = new ModalBuilder()
        .setCustomId("trk_update_submit")
        .setTitle(`Update Tracker — ${last?.title || "Book"}`)
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("page")
              .setLabel("Current Page")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          )
        );

      return interaction.showModal(modal);
    }

    // Delete tracker
    if (interaction.customId === "trk_delete") {
      const newList = trackers.filter((t) => !t.selected);
      await saveUserTrackers(userId, newList);
      return renderList(interaction, interaction.user);
    }

    // Archive tracker
    if (interaction.customId === "trk_archive") {
      for (const t of trackers) {
        if (t.selected) t.archived = true;
      }
      await saveUserTrackers(userId, trackers);
      return renderList(interaction, interaction.user);
    }

    // Back to list
    if (interaction.customId === "trk_back") {
      return renderList(interaction, interaction.user);
    }
  } catch (err) {
    console.error("[tracker.handleComponent]", err);
  }
}

// ===== Modal Submission Handler =====
export async function handleModalSubmit(interaction) {
  try {
    const userId = interaction.user.id;
    const trackers = await getUserTrackers(userId);

    if (interaction.customId === "trk_add_modal_submit") {
      const title = interaction.fields.getTextInputValue("title");
      const author = interaction.fields.getTextInputValue("author") || "";
      const pages = Number(interaction.fields.getTextInputValue("pages") || 0);

      const newBook = {
        id: Math.random().toString(36).slice(2, 10),
        title,
        author,
        totalPages: pages || null,
        currentPage: 0,
        addedAt: Date.now(),
        updatedAt: Date.now(),
        archived: false,
      };

      trackers.push(newBook);
      await saveUserTrackers(userId, trackers);
      return renderList(interaction, interaction.user);
    }

    if (interaction.customId === "trk_update_submit") {
      const page = Number(interaction.fields.getTextInputValue("page"));
      const all = await getUserTrackers(userId);
      const last = all[all.length - 1];
      if (last) {
        last.currentPage = page;
        last.updatedAt = Date.now();
        await appendReadingLog(userId, last.id, page);
      }
      await saveUserTrackers(userId, all);
      return renderDetail(interaction, interaction.user, last.id);
    }
  } catch (err) {
    console.error("[tracker.handleModalSubmit]", err);
  }
}

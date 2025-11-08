// commands/tracker.js — Phase 8 Classic + QoL Restored Build
// ✅ Restores full modal flow:  /tracker → Add Book → search → select → create → update
// ✅ Uses unique customId trk_add_modal  (no conflict with /book)
// ✅ Keeps JSON storage and analytics intact
// ✅ Includes 100-char safety slice for select values
// ✅ Uses flags (no deprecated ephemeral)

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
  const e = new EmbedBuilder()
    .setTitle(`📚 ${username}'s Trackers`)
    .setColor(PURPLE);

  if (!active.length) {
    e.setDescription(
      "You aren't tracking any books yet.\n\nClick **Add Book** below to start."
    );
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
      return `• **${t.title}**${author} — ${bar}Page ${cp}${
        tp ? `/${tp}` : ""
      }${done}${sel}`;
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
          `Page ${Number(t.currentPage || 0)}${
            t.totalPages ? `/${t.totalPages}` : ""
          }`
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
        .setCustomId("trk_add_modal") // ✅ unique ID for /tracker Add Book
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
        tp
          ? `${progressBarPages(cp, tp)}  **Page ${cp}/${tp}**`
          : `**Page ${cp}**`,
        stats
          ? `📈 **${tp ? Math.round(clamp(cp / tp, 0, 1) * 100) : 0}% complete**`
          : null,
        stats
          ? `🔥 **${stats.streak} day${
              stats.streak === 1 ? "" : "s"
            }** streak • avg **${stats.avgPerDay.toFixed(
              1
            )}** pages/day`
          : null,
        tp && cp >= tp ? "✅ Completed" : null,
      ]
        .filter(Boolean)
        .join("\n")
    );

  if (book.thumbnail) e.setThumbnail(book.thumbnail);

  e.setFooter({
    text: `Last updated ⏱ ${fmtTime(book.updatedAt || Date.now())}`,
  });

  return e;
}

function detailComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("trk_update_open")
        .setLabel("🟣 Update Tracker")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("trk_archive")
        .setLabel("🗃 Archive Tracker")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("trk_delete")
        .setLabel("❌ Delete Tracker")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("trk_back")
        .setLabel("↩ Back")
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

// ===== Renderers =====
async function renderList(ctx, user, selectedId = null) {
  const all = await getUserTrackers(user.id);
  const active = all.filter((t) => !t.archived);
  const embed = listEmbed(user.username, active, selectedId);
  const comps = listComponents(active);
  const payload = { embeds: [embed], components: comps, flags: 1 << 6 };
  return ctx.reply ? ctx.reply(payload) : ctx.update(payload);
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
  return ctx.reply ? ctx.reply(payload) : ctx.update(payload);
}

// ===== Slash Command Definition =====
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
    await interaction.reply({
      content: "⚠️ Couldn't load your trackers. Please try again.",
      flags: 1 << 6,
    });
  }
}

// ===== Component Handler =====
export async function handleComponent(i) {
  try {
    // --- Add book (open search modal)
    if (i.isButton() && i.customId === "trk_add_modal") {
      const modal = new ModalBuilder()
        .setCustomId("trk_search_modal")
        .setTitle("Search for a book");

      const input = new TextInputBuilder()
        .setCustomId("trk_search_query")
        .setLabel("Title / Author / ISBN")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder("e.g., Of Mice and Men");

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      if (!i.replied && !i.deferred) await i.showModal(modal);
      return;
    }

    // --- Search modal submit
    if (i.isModalSubmit() && i.customId === "trk_search_modal") {
      const q = i.fields.getTextInputValue("trk_search_query").trim();
      const results = await hybridSearchMany(q, 10);

      if (!results.length)
        return i.reply({ content: `No results for **${q}**.`, flags: 1 << 6 });

      const lines = results
        .map(
          (b, idx) =>
            `**${idx + 1}.** ${b.title}${
              b.authors?.length ? ` — ${b.authors.join(", ")}` : ""
            }`
        )
        .join("\n");

      const e = new EmbedBuilder()
        .setTitle("Book Search Results")
        .setColor(0x0ea5e9)
        .setDescription(
          lines + "\n\nSelect a book below to create a tracker."
        );

      const opts = results.slice(0, 25).map((b, idx) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`${b.title}`.slice(0, 100))
          .setValue(String(idx))
          .setDescription((b.authors?.join(", ") || b.source).slice(0, 100))
      );

      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("trk_search_select")
          .setPlaceholder("Select a book")
          .setMinValues(1)
          .setMaxValues(1)
          .setOptions(opts)
      );

      i.client.searchCache = i.client.searchCache || new Map();
      i.client.searchCache.set(i.user.id, results);

      await i.reply({ embeds: [e], components: [row], flags: 1 << 6 });
      return;
    }

    // --- Select a search result
    if (i.isStringSelectMenu() && i.customId === "trk_search_select") {
      const idx = Number(i.values?.[0] || -1);
      const list = i.client.searchCache?.get(i.user.id) || [];
      const book = list[idx];
      if (!book) return i.deferUpdate();

      const modal = new ModalBuilder()
        .setCustomId("trk_create_modal")
        .setTitle("Create a new tracker");

      const page = new TextInputBuilder()
        .setCustomId("trk_page")
        .setLabel("Your Current Page *")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder("e.g., 1");

      const total = new TextInputBuilder()
        .setCustomId("trk_total")
        .setLabel("Total Pages (optional)")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setPlaceholder(book.pageCount ? String(book.pageCount) : "e.g., 320");

      modal.addComponents(
        new ActionRowBuilder().addComponents(page),
        new ActionRowBuilder().addComponents(total)
      );

      if (!i.replied && !i.deferred) await i.showModal(modal);
      return;
    }

    // --- Create tracker modal
    if (i.isModalSubmit() && i.customId === "trk_create_modal") {
      const [book] = i.client.searchCache?.get(i.user.id) || [];
      if (!book)
        return i.reply({ content: "Search expired. Try again.", flags: 1 << 6 });

      const page = i.fields.getTextInputValue("trk_page").trim();
      const total = i.fields.getTextInputValue("trk_total").trim();

      const tracked = await getUserTrackers(i.user.id);

      if (tracked.some((t) => t.id === book.id && !t.archived)) {
        await i.reply({
          content: `You're already tracking **${book.title}**.`,
          flags: 1 << 6,
        });
        return;
      }

      const tracker = {
        id: book.id,
        title: book.title,
        author: (book.authors || []).join(", "),
        thumbnail: book.thumbnail || null,
        currentPage: clamp(Number(page || 0), 0, Number(total || Infinity)),
        totalPages: total ? Number(total) : book.pageCount || null,
        archived: false,
        status: "active",
        updatedAt: new Date().toISOString(),
      };

      tracked.unshift(tracker);
      await saveUserTrackers(i.user.id, tracked);

      await appendReadingLog(
        i.user.id,
        tracker.id,
        tracker.currentPage,
        tracker.updatedAt
      );

      await i.reply({
        content: `Added **${book.title}** — starting at Page ${page}${
          total ? `/${total}` : ""
        }.`,
        flags: 1 << 6,
      });

      setTimeout(() => renderList(i, i.user, book.id).catch(() => {}), 800);
      return;
    }

    // --- Select existing tracker
    if (i.isStringSelectMenu() && i.customId === "trk_select_view") {
      const selectedId = i.values?.[0];
      if (!selectedId) return i.deferUpdate();
      return renderDetail(i, i.user, selectedId);
    }

    // --- Tracker detail buttons
    if (
      i.isButton() &&
      ["trk_update_open", "trk_archive", "trk_delete", "trk_back"].includes(
        i.customId
      )
    ) {
      const all = await getUserTrackers(i.user.id);
      const book = all.find((t) => !t.archived);

      if (!book && i.customId !== "trk_back")
        return i.reply({ content: "Tracker not found.", flags: 1 << 6 });

      if (i.customId === "trk_back") return renderList(i, i.user);

      if (i.customId === "trk_update_open") {
        const modal = new ModalBuilder()
          .setCustomId("trk_update_modal")
          .setTitle("Update Tracker");

        const page = new TextInputBuilder()
          .setCustomId("upd_page")
          .setLabel("Current Page *")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(book.currentPage || 0));

        const total = new TextInputBuilder()
          .setCustomId("upd_total")
          .setLabel("Total Pages (optional)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(book.totalPages ? String(book.totalPages) : "");

        modal.addComponents(
          new ActionRowBuilder().addComponents(page),
          new ActionRowBuilder().addComponents(total)
        );

        if (!i.replied && !i.deferred) await i.showModal(modal);
        return;
      }

      if (i.customId === "trk_archive") {
        book.archived = true;
        book.status = "archived";
        book.updatedAt = new Date().toISOString();
        await saveUserTrackers(i.user.id, all);

        await i.reply({
          content: `📦 Archived **${book.title}**.`,
          flags: 1 << 6,
        });
        return;
      }

      if (i.customId === "trk_delete") {
        const idx = all.findIndex((t) => t.id === book.id);
        if (idx !== -1) all.splice(idx, 1);
        await saveUserTrackers(i.user.id, all);

        await i.reply({
          content: `🗑️ Deleted tracker for **${book.title}**.`,
          flags: 1 << 6,
        });
        return;
      }
    }

    // --- Update tracker modal
    if (i.isModalSubmit() && i.customId === "trk_update_modal") {
      const all = await getUserTrackers(i.user.id);
      const book = all.find((t) => !t.archived);
      if (!book)
        return i.reply({ content: "Tracker not found.", flags: 1 << 6 });

      const prevPage = Number(book.currentPage || 0);
      const page = i.fields.getTextInputValue("upd_page").trim();
      const total = i.fields.getTextInputValue("upd_total").trim();

      book.currentPage = clamp(
        Number(page || 0),
        0,
        Number(total || book.totalPages || Infinity)
      );
      if (total) book.totalPages = Number(total);
      book.updatedAt = new Date().toISOString();

      await saveUserTrackers(i.user.id, all);
      await appendReadingLog(
        i.user.id,
        book.id,
        book.currentPage,
        book.updatedAt
      );

      const delta = Number(book.currentPage) - prevPage;

      await i.reply({
        content: `✅ Updated **${book.title}** → Page ${book.currentPage}${
          book.totalPages ? `/${book.totalPages}` : ""
        }${delta > 0 ? ` (+${delta})` : ""}.`,
        flags: 1 << 6,
      });
      return;
    }

    if (DEBUG) console.log(`[tracker.component] ${i.customId}`);
  } catch (err) {
    console.error("[tracker.handleComponent]", err);
    try {
      await i.reply({
        content: "⚠️ Something went wrong handling that tracker action.",
        flags: 1 << 6,
      });
    } catch {}
  }
}

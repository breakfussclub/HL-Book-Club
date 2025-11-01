// commands/tracker.js — Restored Classic Modal Tracker
// ✅ Opens modal immediately when /tracker is run
// ✅ Shares same modal flow with /book search "Add to My Tracker"
// ✅ Uses flags instead of deprecated "ephemeral"
// ✅ Compatible with Phase 8 analytics & storage

import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { loadJSON, saveJSON, FILES } from "../utils/storage.js";
import { appendReadingLog, calcBookStats } from "../utils/analytics.js";

const PURPLE = 0x8b5cf6;
const GREEN = 0x22c55e;
const DEBUG = process.env.DEBUG === "true";

export const definitions = [
  new SlashCommandBuilder()
    .setName("tracker")
    .setDescription("Add or update a book in your reading tracker"),
].map((c) => c.toJSON());

// ---------------------------------------------------------------------------
// /tracker command — immediately opens modal
// ---------------------------------------------------------------------------
export async function execute(interaction) {
  const modal = new ModalBuilder()
    .setCustomId("trk_add_modal")
    .setTitle("📖 Add Book to Tracker");

  const titleInput = new TextInputBuilder()
    .setCustomId("trk_title")
    .setLabel("Book Title")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const totalPagesInput = new TextInputBuilder()
    .setCustomId("trk_total")
    .setLabel("Total Pages")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const currentPageInput = new TextInputBuilder()
    .setCustomId("trk_current")
    .setLabel("Current Page (optional)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const row1 = new ActionRowBuilder().addComponents(titleInput);
  const row2 = new ActionRowBuilder().addComponents(totalPagesInput);
  const row3 = new ActionRowBuilder().addComponents(currentPageInput);

  await interaction.showModal(modal.addComponents(row1, row2, row3));

  if (DEBUG) console.log(`[tracker] Modal opened by ${interaction.user.username}`);
}

// ---------------------------------------------------------------------------
// Handle "Add to My Tracker" button from /book search
// ---------------------------------------------------------------------------
export async function handleComponent(interaction) {
  if (interaction.customId !== "trk_add_open") return;

  const modal = new ModalBuilder()
    .setCustomId("trk_add_modal")
    .setTitle("📖 Add Book to Tracker");

  const titleInput = new TextInputBuilder()
    .setCustomId("trk_title")
    .setLabel("Book Title")
    .setStyle(TextInputStyle.Short)
    .setValue(interaction.message.embeds[0]?.title || "")
    .setRequired(true);

  const totalPagesInput = new TextInputBuilder()
    .setCustomId("trk_total")
    .setLabel("Total Pages")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const currentPageInput = new TextInputBuilder()
    .setCustomId("trk_current")
    .setLabel("Current Page (optional)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const row1 = new ActionRowBuilder().addComponents(titleInput);
  const row2 = new ActionRowBuilder().addComponents(totalPagesInput);
  const row3 = new ActionRowBuilder().addComponents(currentPageInput);

  await interaction.showModal(modal.addComponents(row1, row2, row3));
  if (DEBUG) console.log(`[tracker] Modal opened from button by ${interaction.user.username}`);
}

// ---------------------------------------------------------------------------
// Modal submission — adds or updates book progress
// ---------------------------------------------------------------------------
export async function handleModalSubmit(interaction) {
  if (interaction.customId !== "trk_add_modal") return;

  try {
    const title = interaction.fields.getTextInputValue("trk_title").trim();
    const totalPages = parseInt(
      interaction.fields.getTextInputValue("trk_total").trim(),
      10
    );
    const currentPageRaw = interaction.fields.getTextInputValue("trk_current").trim();
    const currentPage = currentPageRaw ? parseInt(currentPageRaw, 10) : 0;

    if (!title || !totalPages || isNaN(totalPages)) {
      return interaction.reply({
        content: "⚠️ Please provide a valid title and total page count.",
        flags: 1 << 6,
      });
    }

    const user = interaction.user;
    const uid = user.id;
    const trackers = await loadJSON(FILES.TRACKERS);
    if (!trackers[uid]) trackers[uid] = { tracked: [] };

    const existing = trackers[uid].tracked.find(
      (b) => b.title.toLowerCase() === title.toLowerCase()
    );

    if (existing) {
      existing.totalPages = totalPages;
      existing.currentPage = Math.max(existing.currentPage, currentPage);
      existing.updatedAt = new Date().toISOString();
    } else {
      trackers[uid].tracked.unshift({
        title,
        totalPages,
        currentPage,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    await saveJSON(FILES.TRACKERS, trackers);
    await appendReadingLog(uid, title, currentPage);

    const stats = calcBookStats(trackers[uid].tracked.find((b) => b.title === title));
    const e = new EmbedBuilder()
      .setTitle(existing ? `Updated "${title}"` : `Added "${title}"`)
      .setColor(existing ? GREEN : PURPLE)
      .setDescription(
        `Progress: **${currentPage}/${totalPages} pages**\n${stats}`
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("View Tracker")
        .setStyle(ButtonStyle.Secondary)
        .setCustomId("trk_view_my")
    );

    await interaction.reply({ embeds: [e], components: [row], flags: 1 << 6 });
    if (DEBUG)
      console.log(`[tracker.modal-submit] ${user.username} → ${title} (${currentPage}/${totalPages})`);
  } catch (err) {
    console.error("[tracker.modal-submit] Error:", err);
    try {
      await interaction.reply({
        content: "⚠️ Something went wrong adding your book.",
        flags: 1 << 6,
      });
    } catch {}
  }
}

// commands/tracker.js — Bookcord Phase 8
// Handles /tracker commands and all modal / button interactions

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
import { logProgress } from "../utils/analytics.js";

const PURPLE = 0x8b5cf6;

// ===== Slash Command Definitions =====
export const definitions = [
  new SlashCommandBuilder()
    .setName("tracker")
    .setDescription("Manage your reading trackers")
    .addSubcommand(sc =>
      sc.setName("view").setDescription("Show all of your active trackers")
    )
].map(c => c.toJSON());

// ===== Execute Slash Commands =====
export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const user = interaction.user;
  const trackers = await loadJSON(FILES.TRACKERS);
  trackers[user.id] = trackers[user.id] || { tracked: [] };
  const mine = trackers[user.id].tracked;

  // --- /tracker view ---
  if (sub === "view") {
    if (!mine.length)
      return interaction.reply({
        content: "You don’t have any active trackers yet.",
        ephemeral: true,
      });

    const embeds = mine.map((t, i) => {
      const percent =
        t.totalPages && t.totalPages > 0
          ? Math.round((t.currentPage / t.totalPages) * 100)
          : null;
      const e = new EmbedBuilder()
        .setColor(PURPLE)
        .setTitle(`${t.title}`)
        .setDescription(
          percent
            ? `Page **${t.currentPage} / ${t.totalPages}** (${percent} %)`
            : `Page **${t.currentPage}**`
        )
        .setFooter({
          text: `Started ${new Date(t.startedAt).toLocaleDateString()}`,
        });
      if (t.thumbnail) e.setThumbnail(t.thumbnail);
      return e;
    });

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("trk_update_open")
        .setLabel("✏️ Update Tracker")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("trk_archive")
        .setLabel("📦 Archive")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("trk_delete")
        .setLabel("🗑️ Delete")
        .setStyle(ButtonStyle.Danger)
    );

    return interaction.reply({ embeds, components: [buttons], ephemeral: true });
  }
}

// ===== Component Handling =====
export async function handleComponent(i) {
  // --- Handle Add to Tracker from /book search ---
  if (i.isButton() && i.customId.startsWith("book_add_tracker_")) {
    const uid = i.customId.split("_").pop();
    if (uid !== i.user.id)
      return i.reply({ content: "This button isn’t for you.", ephemeral: true });

    const list = i.client.searchCache?.get(i.user.id) || [];
    const book = list[0];
    if (!book)
      return i.reply({
        content: "Search expired. Please run `/book search` again.",
        ephemeral: true,
      });

    const modal = new ModalBuilder()
      .setCustomId("trk_create_modal")
      .setTitle("Create a New Tracker");

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
      .setPlaceholder(book.pageCount ? String(book.pageCount) : "e.g., 220");

    modal.addComponents(
      new ActionRowBuilder().addComponents(page),
      new ActionRowBuilder().addComponents(total)
    );

    await i.showModal(modal);
    return;
  }

  // --- Open Update Tracker Modal ---
  if (i.isButton() && i.customId === "trk_update_open") {
    const modal = new ModalBuilder()
      .setCustomId("trk_update_modal")
      .setTitle("Update Tracker");
    const page = new TextInputBuilder()
      .setCustomId("trk_page")
      .setLabel("New Current Page *")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder("e.g., 45");
    modal.addComponents(new ActionRowBuilder().addComponents(page));
    await i.showModal(modal);
    return;
  }

  // --- Archive Tracker ---
  if (i.isButton() && i.customId === "trk_archive") {
    const trackers = await loadJSON(FILES.TRACKERS);
    const mine = trackers[i.user.id]?.tracked || [];
    if (!mine.length)
      return i.reply({ content: "No trackers to archive.", ephemeral: true });
    const last = mine[mine.length - 1];
    last.archived = true;
    await saveJSON(FILES.TRACKERS, trackers);
    return i.reply({
      content: `📦 Archived **${last.title}**.`,
      ephemeral: true,
    });
  }

  // --- Delete Tracker ---
  if (i.isButton() && i.customId === "trk_delete") {
    const trackers = await loadJSON(FILES.TRACKERS);
    const mine = trackers[i.user.id]?.tracked || [];
    if (!mine.length)
      return i.reply({ content: "No trackers to delete.", ephemeral: true });
    const removed = mine.pop();
    await saveJSON(FILES.TRACKERS, trackers);
    return i.reply({
      content: `🗑️ Deleted **${removed.title}**.`,
      ephemeral: true,
    });
  }

  // --- Create New Tracker Modal Submit ---
  if (i.isModalSubmit() && i.customId === "trk_create_modal") {
    const page = Number(i.fields.getTextInputValue("trk_page"));
    const total = Number(i.fields.getTextInputValue("trk_total")) || null;
    const cache = i.client.searchCache?.get(i.user.id);
    const book = cache ? cache[0] : null;
    if (!book)
      return i.reply({
        content: "Search expired. Please run `/book search` again.",
        ephemeral: true,
      });

    const trackers = await loadJSON(FILES.TRACKERS);
    trackers[i.user.id] = trackers[i.user.id] || { tracked: [] };
    trackers[i.user.id].tracked.push({
      id: book.id,
      title: book.title,
      thumbnail: book.thumbnail,
      totalPages: total,
      currentPage: page,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await saveJSON(FILES.TRACKERS, trackers);

    await logProgress(i.user.id, book.id, page);

    const e = new EmbedBuilder()
      .setColor(PURPLE)
      .setTitle(`📖 Started Tracking: ${book.title}`)
      .setDescription(
        total
          ? `Page **${page} / ${total}**`
          : `Page **${page}**`
      );
    if (book.thumbnail) e.setThumbnail(book.thumbnail);
    return i.reply({ embeds: [e], ephemeral: true });
  }

  // --- Update Tracker Modal Submit ---
  if (i.isModalSubmit() && i.customId === "trk_update_modal") {
    const page = Number(i.fields.getTextInputValue("trk_page"));
    const trackers = await loadJSON(FILES.TRACKERS);
    const mine = trackers[i.user.id]?.tracked || [];
    if (!mine.length)
      return i.reply({ content: "No trackers found.", ephemeral: true });
    const last = mine[mine.length - 1];
    last.currentPage = page;
    last.updatedAt = new Date().toISOString();
    await saveJSON(FILES.TRACKERS, trackers);
    await logProgress(i.user.id, last.id, page);

    const e = new EmbedBuilder()
      .setColor(PURPLE)
      .setTitle(`✅ Progress Updated: ${last.title}`)
      .setDescription(
        last.totalPages
          ? `Page **${last.currentPage} / ${last.totalPages}**`
          : `Page **${last.currentPage}**`
      );
    if (last.thumbnail) e.setThumbnail(last.thumbnail);
    return i.reply({ embeds: [e], ephemeral: true });
  }
}

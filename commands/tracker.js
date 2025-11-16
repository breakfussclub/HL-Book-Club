// commands/tracker.js — With Pagination & Duplicate ID Fix
// ✅ Handles 100+ books without Discord character limit issues
// ✅ Previous/Next page navigation
// ✅ Shows 10 books per page
// ✅ Prevents duplicate select menu values

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
  if (!total || total <= 0) return "";
  const pct = Math.min(1, Math.max(0, current / total));
  const filled = Math.round(pct * width);
  return "▰".repeat(filled) + "▱".repeat(width - filled);
};

// ===== Embed & Components =====

const BOOKS_PER_PAGE = 10;

function listEmbed(username, active, selectedId = null, page = 0) {
  const totalPages = Math.ceil(active.length / BOOKS_PER_PAGE);
  const start = page * BOOKS_PER_PAGE;
  const end = start + BOOKS_PER_PAGE;
  const pageBooks = active.slice(start, end);

  const e = new EmbedBuilder()
    .setTitle(`📚 ${username}'s Trackers`)
    .setColor(PURPLE);

  if (!active.length) {
    e.setDescription(
      "You aren't tracking any books yet.\n\nClick **Add Book** below to start."
    );
    return e;
  }

  const lines = pageBooks
    .map((t, idx) => {
      const globalIdx = start + idx + 1;
      const sel = t.id === selectedId ? " **(selected)**" : "";
      const cp = Number(t.currentPage || 0);
      const tp = Number(t.totalPages || 0);
      const bar = tp ? `${progressBarPages(cp, tp)} ` : "";
      const done = tp && cp >= tp ? " ✅ Completed" : "";
      const author = t.author ? ` — *${t.author}*` : "";
      return `**${globalIdx}.** ${t.title}${author}\n   ${bar}Page ${cp}${
        tp ? `/${tp}` : ""
      }${done}${sel}`;
    })
    .join("\n\n");

  e.setDescription(lines);
  e.setFooter({
    text: `Page ${page + 1}/${totalPages} • ${active.length} total books`,
  });

  return e;
}

function listComponents(active, page = 0) {
  const totalPages = Math.ceil(active.length / BOOKS_PER_PAGE);
  const start = page * BOOKS_PER_PAGE;
  const end = start + BOOKS_PER_PAGE;
  const pageBooks = active.slice(start, end);

  const rows = [];

  // Book selector dropdown
  if (pageBooks.length) {
    const usedValues = new Set(); // Track used values to prevent duplicates
    
    const options = pageBooks.map((t, idx) => {
      // Create unique ID by combining tracker ID with index
      let safeId = String(t.id);
      
      // If ID is too long or already used, create a unique one
      if (safeId.length > 90 || usedValues.has(safeId)) {
        safeId = `idx_${start + idx}_${Date.now().toString(36).slice(-6)}`;
      }
      
      usedValues.add(safeId);

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

  // Pagination buttons
  if (totalPages > 1) {
    const navRow = new ActionRowBuilder();

    if (page > 0) {
      navRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`trk_page_${page - 1}`)
          .setLabel("◀ Previous")
          .setStyle(ButtonStyle.Secondary)
      );
    }

    if (page < totalPages - 1) {
      navRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`trk_page_${page + 1}`)
          .setLabel("Next ▶")
          .setStyle(ButtonStyle.Secondary)
      );
    }

    if (navRow.components.length > 0) {
      rows.push(navRow);
    }
  }

  // Add Book button
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

function detailEmbed(t, logs, stats) {
  const e = new EmbedBuilder()
    .setTitle(`📖 ${t.title}`)
    .setColor(GOLD);

  if (t.author) e.addFields({ name: "Author", value: t.author, inline: true });
  if (t.status)
    e.addFields({ name: "Status", value: t.status, inline: true });
  if (t.totalPages)
    e.addFields({
      name: "Total Pages",
      value: String(t.totalPages),
      inline: true,
    });

  const cp = Number(t.currentPage || 0);
  const tp = Number(t.totalPages || 0);
  if (tp) {
    const pct = Math.round((cp / tp) * 100);
    const bar = progressBarPages(cp, tp);
    e.addFields({
      name: "Progress",
      value: `${bar} ${pct}%\nPage ${cp}/${tp}`,
      inline: false,
    });
  }

  if (stats?.avgPages) {
    e.addFields({
      name: "📊 Stats",
      value:
        `Avg: ${stats.avgPages.toFixed(1)} pages/session\n` +
        `Last update: ${fmtTime(t.updatedAt || t.startedAt)}`,
      inline: false,
    });
  }

  const recentLogs = (logs || []).slice(-3).reverse();
  if (recentLogs.length) {
    e.addFields({
      name: "Recent Logs",
      value: recentLogs
        .map((l) => `• +${l.pagesRead} pages on ${fmtTime(l.timestamp)}`)
        .join("\n"),
      inline: false,
    });
  }

  return e;
}

function detailComponents(trackerId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`trk_update_${trackerId}`)
        .setLabel("Update Progress")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`trk_complete_${trackerId}`)
        .setLabel("Mark Complete")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`trk_delete_${trackerId}`)
        .setLabel("Remove")
        .setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("trk_back_to_list")
        .setLabel("← Back to List")
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

// ===== COMMAND ENTRY =====

export const definitions = [
  new SlashCommandBuilder()
    .setName("tracker")
    .setDescription("Manage your reading tracker"),
].map((c) => c.toJSON());

export async function execute(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: 1 << 6 });
  }

  const data = await loadJSON(FILES.TRACKERS, {});
  const userId = interaction.user.id;
  if (!data[userId]) data[userId] = { tracked: [] };

  const active = data[userId].tracked.filter((t) => t.status !== "completed");
  const embed = listEmbed(interaction.user.username, active, null, 0);
  const components = listComponents(active, 0);

  if (interaction.deferred) {
    await interaction.editReply({ embeds: [embed], components });
  } else if (!interaction.replied) {
    await interaction.reply({ embeds: [embed], components, flags: 1 << 6 });
  }
}

// ===== COMPONENT ROUTER =====

export async function handleComponent(interaction) {
  const cid = interaction.customId;

  // Pagination
  if (cid.startsWith("trk_page_")) {
    const page = parseInt(cid.split("_")[2]);
    return handlePageChange(interaction, page);
  }

  if (cid === "trk_select_view") return handleSelectView(interaction);
  if (cid === "trk_add_modal") return handleAddModal(interaction);
  if (cid.startsWith("trk_update_")) return handleUpdateModal(interaction);
  if (cid.startsWith("trk_complete_")) return handleComplete(interaction);
  if (cid.startsWith("trk_delete_")) return handleDelete(interaction);
  if (cid === "trk_back_to_list") return handleBackToList(interaction);

  return false;
}

// ===== HANDLER: Page Change =====

async function handlePageChange(interaction, page) {
  await interaction.deferUpdate();

  const data = await loadJSON(FILES.TRACKERS, {});
  const userId = interaction.user.id;
  if (!data[userId]) data[userId] = { tracked: [] };

  const active = data[userId].tracked.filter((t) => t.status !== "completed");
  const embed = listEmbed(interaction.user.username, active, null, page);
  const components = listComponents(active, page);

  await interaction.editReply({ embeds: [embed], components });
  return true;
}

// ===== HANDLER: Select View =====

async function handleSelectView(interaction) {
  await interaction.deferUpdate();

  const selectedValue = interaction.values[0];
  const data = await loadJSON(FILES.TRACKERS, {});
  const userId = interaction.user.id;
  
  // Handle both indexed values and direct ID match
  let tracker;
  
  if (selectedValue.startsWith("idx_")) {
    // It's an indexed value like "idx_5_abc123"
    const parts = selectedValue.split("_");
    const pageIndex = parseInt(parts[1]);
    const active = data[userId]?.tracked.filter((t) => t.status !== "completed");
    tracker = active[pageIndex];
  } else {
    // It's a direct tracker ID
    tracker = data[userId]?.tracked.find(
      (t) => String(t.id) === selectedValue || String(t.id).startsWith(selectedValue)
    );
  }

  if (!tracker) {
    return interaction.followUp({
      content: "❌ Tracker not found.",
      flags: 1 << 6,
    });
  }

  const logs = await getUserLogs(userId, tracker.id);
  const stats = calcBookStats(logs);
  const embed = detailEmbed(tracker, logs, stats);
  const components = detailComponents(tracker.id);

  await interaction.editReply({ embeds: [embed], components });
  return true;
}

// ===== HANDLER: Add Modal =====

async function handleAddModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId("trk_add_submit")
    .setTitle("Add New Book");

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("book_title")
        .setLabel("Book Title")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("book_author")
        .setLabel("Author (optional)")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("book_pages")
        .setLabel("Total Pages (optional)")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
    )
  );

  await interaction.showModal(modal);
  return true;
}

// ===== HANDLER: Add Submit =====

export async function handleModalSubmit(interaction) {
  if (interaction.customId === "trk_add_submit") {
    await interaction.deferReply({ flags: 1 << 6 });

    const title = interaction.fields.getTextInputValue("book_title");
    const author = interaction.fields.getTextInputValue("book_author") || null;
    const pagesStr = interaction.fields.getTextInputValue("book_pages") || "0";
    const totalPages = parseInt(pagesStr) || 0;

    const data = await loadJSON(FILES.TRACKERS, {});
    const userId = interaction.user.id;
    if (!data[userId]) data[userId] = { tracked: [] };

    const newId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const newTracker = {
      id: newId,
      title,
      author,
      totalPages,
      currentPage: 0,
      status: "reading",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    data[userId].tracked.push(newTracker);
    await saveJSON(FILES.TRACKERS, data);

    await interaction.editReply({
      content: `✅ Added **${title}** to your tracker!`,
    });

    return true;
  }

  if (interaction.customId.startsWith("trk_update_submit_")) {
    return handleUpdateSubmit(interaction);
  }

  return false;
}

// ===== HANDLER: Update Modal =====

async function handleUpdateModal(interaction) {
  const trackerId = interaction.customId.split("_")[2];
  const modal = new ModalBuilder()
    .setCustomId(`trk_update_submit_${trackerId}`)
    .setTitle("Update Progress");

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("new_page")
        .setLabel("Current Page")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    )
  );

  await interaction.showModal(modal);
  return true;
}

// ===== HANDLER: Update Submit =====

async function handleUpdateSubmit(interaction) {
  await interaction.deferReply({ flags: 1 << 6 });

  const trackerId = interaction.customId.split("_")[3];
  const newPageStr = interaction.fields.getTextInputValue("new_page");
  const newPage = parseInt(newPageStr);

  if (isNaN(newPage) || newPage < 0) {
    return interaction.editReply({
      content: "❌ Invalid page number.",
    });
  }

  const data = await loadJSON(FILES.TRACKERS, {});
  const userId = interaction.user.id;
  const tracker = data[userId]?.tracked.find((t) => String(t.id) === trackerId);

  if (!tracker) {
    return interaction.editReply({
      content: "❌ Tracker not found.",
    });
  }

  const oldPage = tracker.currentPage || 0;
  const pagesRead = Math.max(0, newPage - oldPage);

  tracker.currentPage = newPage;
  tracker.updatedAt = new Date().toISOString();

  if (tracker.totalPages && newPage >= tracker.totalPages) {
    tracker.status = "completed";
    tracker.completedAt = new Date().toISOString();
  }

  await saveJSON(FILES.TRACKERS, data);

  if (pagesRead > 0) {
    await appendReadingLog(userId, tracker.id, pagesRead);
  }

  await interaction.editReply({
    content: `✅ Updated **${tracker.title}** to page ${newPage}${
      tracker.status === "completed" ? " 🎉 **Completed!**" : ""
    }`,
  });

  return true;
}

// ===== HANDLER: Complete =====

async function handleComplete(interaction) {
  await interaction.deferReply({ flags: 1 << 6 });

  const trackerId = interaction.customId.split("_")[2];
  const data = await loadJSON(FILES.TRACKERS, {});
  const userId = interaction.user.id;
  const tracker = data[userId]?.tracked.find((t) => String(t.id) === trackerId);

  if (!tracker) {
    return interaction.editReply({
      content: "❌ Tracker not found.",
    });
  }

  tracker.status = "completed";
  tracker.completedAt = new Date().toISOString();
  if (tracker.totalPages && tracker.currentPage < tracker.totalPages) {
    tracker.currentPage = tracker.totalPages;
  }

  await saveJSON(FILES.TRACKERS, data);

  await interaction.editReply({
    content: `🎉 Marked **${tracker.title}** as completed!`,
  });

  return true;
}

// ===== HANDLER: Delete =====

async function handleDelete(interaction) {
  await interaction.deferReply({ flags: 1 << 6 });

  const trackerId = interaction.customId.split("_")[2];
  const data = await loadJSON(FILES.TRACKERS, {});
  const userId = interaction.user.id;

  const idx = data[userId]?.tracked.findIndex(
    (t) => String(t.id) === trackerId
  );

  if (idx === -1) {
    return interaction.editReply({
      content: "❌ Tracker not found.",
    });
  }

  const title = data[userId].tracked[idx].title;
  data[userId].tracked.splice(idx, 1);
  await saveJSON(FILES.TRACKERS, data);

  await interaction.editReply({
    content: `✅ Removed **${title}** from your tracker.`,
  });

  return true;
}

// ===== HANDLER: Back to List =====

async function handleBackToList(interaction) {
  await interaction.deferUpdate();

  const data = await loadJSON(FILES.TRACKERS, {});
  const userId = interaction.user.id;
  if (!data[userId]) data[userId] = { tracked: [] };

  const active = data[userId].tracked.filter((t) => t.status !== "completed");
  const embed = listEmbed(interaction.user.username, active, null, 0);
  const components = listComponents(active, 0);

  await interaction.editReply({ embeds: [embed], components });
  return true;
}

export const commandName = "tracker";

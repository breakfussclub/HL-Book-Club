// commands/tracker.js — With Status Filters & Sorting
// ✅ Filter by: Reading, Completed, Planned, All
// ✅ Sort by: Recent, Title, Progress, Date Added
// ✅ Pagination for large lists
// ✅ No duplicate dropdown values

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

const PURPLE = 0x8b5cf6;
const GOLD = 0xf59e0b;
const GREEN = 0x10b981;
const BLUE = 0x3b82f6;

// ===== Utility helpers =====
const progressBarPages = (current, total, width = 18) => {
  if (!total || total <= 0) return "";
  const pct = Math.min(1, Math.max(0, current / total));
  const filled = Math.round(pct * width);
  return "▰".repeat(filled) + "▱".repeat(width - filled);
};

const fmtTime = (d) => new Date(d).toLocaleString();

// ===== Filtering & Sorting =====

const BOOKS_PER_PAGE = 10;

function filterBooks(books, filterType) {
  switch (filterType) {
    case "reading":
      return books.filter((b) => b.status === "reading");
    case "completed":
      return books.filter((b) => b.status === "completed");
    case "planned":
      return books.filter((b) => b.status === "planned");
    case "all":
    default:
      return books;
  }
}

function sortBooks(books, sortType) {
  const sorted = [...books];
  
  switch (sortType) {
    case "title":
      return sorted.sort((a, b) => a.title.localeCompare(b.title));
    
    case "progress":
      return sorted.sort((a, b) => {
        const aPct = a.totalPages ? (a.currentPage / a.totalPages) : 0;
        const bPct = b.totalPages ? (b.currentPage / b.totalPages) : 0;
        return bPct - aPct; // Highest progress first
      });
    
    case "added":
      return sorted.sort((a, b) => 
        new Date(b.startedAt || 0) - new Date(a.startedAt || 0)
      );
    
    case "recent":
    default:
      return sorted.sort((a, b) => 
        new Date(b.updatedAt || b.startedAt || 0) - new Date(a.updatedAt || a.startedAt || 0)
      );
  }
}

// ===== Embed & Components =====

function listEmbed(username, books, filterType = "reading", sortType = "recent", page = 0) {
  const filtered = filterBooks(books, filterType);
  const sorted = sortBooks(filtered, sortType);
  
  const totalPages = Math.ceil(sorted.length / BOOKS_PER_PAGE);
  const start = page * BOOKS_PER_PAGE;
  const end = start + BOOKS_PER_PAGE;
  const pageBooks = sorted.slice(start, end);

  const filterEmoji = {
    reading: "📖",
    completed: "✅",
    planned: "📚",
    all: "🌟",
  };

  const e = new EmbedBuilder()
    .setTitle(`${filterEmoji[filterType]} ${username}'s Trackers`)
    .setColor(PURPLE);

  if (!sorted.length) {
    const emptyMsg = {
      reading: "You're not currently reading any books.\n\nAdd a book or sync from Goodreads!",
      completed: "You haven't completed any books yet.\n\nKeep reading! 📖",
      planned: "You don't have any planned books.\n\nAdd some to your reading list!",
      all: "You aren't tracking any books yet.\n\nClick **Add Book** below to start.",
    };
    e.setDescription(emptyMsg[filterType] || emptyMsg.all);
    return e;
  }

  const lines = pageBooks
    .map((t, idx) => {
      const globalIdx = start + idx + 1;
      const cp = Number(t.currentPage || 0);
      const tp = Number(t.totalPages || 0);
      const bar = tp ? `${progressBarPages(cp, tp)} ` : "";
      const pct = tp ? ` (${Math.round((cp / tp) * 100)}%)` : "";
      const author = t.author ? ` — *${t.author}*` : "";
      const statusEmoji = {
        reading: "📖",
        completed: "✅",
        planned: "📚",
      }[t.status] || "";
      
      return `**${globalIdx}.** ${t.title}${author}\n   ${bar}Page ${cp}${
        tp ? `/${tp}${pct}` : ""
      } ${statusEmoji}`;
    })
    .join("\n\n");

  e.setDescription(lines);
  
  const sortLabel = {
    recent: "Recently Updated",
    title: "Title (A-Z)",
    progress: "Progress %",
    added: "Date Added",
  }[sortType] || "Recently Updated";
  
  e.setFooter({
    text: `Page ${page + 1}/${totalPages} • ${sorted.length} books • Sorted by: ${sortLabel}`,
  });

  return e;
}

function listComponents(books, filterType = "reading", sortType = "recent", page = 0) {
  const filtered = filterBooks(books, filterType);
  const sorted = sortBooks(filtered, sortType);
  
  const totalPages = Math.ceil(sorted.length / BOOKS_PER_PAGE);
  const start = page * BOOKS_PER_PAGE;
  const end = start + BOOKS_PER_PAGE;
  const pageBooks = sorted.slice(start, end);

  const rows = [];

  // Filter buttons
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`trk_filter_reading_${sortType}_0`)
        .setLabel("📖 Reading")
        .setStyle(filterType === "reading" ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`trk_filter_completed_${sortType}_0`)
        .setLabel("✅ Completed")
        .setStyle(filterType === "completed" ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`trk_filter_planned_${sortType}_0`)
        .setLabel("📚 Planned")
        .setStyle(filterType === "planned" ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`trk_filter_all_${sortType}_0`)
        .setLabel("🌟 All")
        .setStyle(filterType === "all" ? ButtonStyle.Secondary : ButtonStyle.Secondary)
    )
  );

  // Sort dropdown
  rows.push(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`trk_sort_${filterType}`)
        .setPlaceholder(`Sort: ${sortType === "recent" ? "Recently Updated" : sortType === "title" ? "Title" : sortType === "progress" ? "Progress" : "Date Added"}`)
        .setOptions([
          new StringSelectMenuOptionBuilder()
            .setLabel("Recently Updated")
            .setValue("recent")
            .setEmoji("🕐")
            .setDefault(sortType === "recent"),
          new StringSelectMenuOptionBuilder()
            .setLabel("Title (A-Z)")
            .setValue("title")
            .setEmoji("🔤")
            .setDefault(sortType === "title"),
          new StringSelectMenuOptionBuilder()
            .setLabel("Progress %")
            .setValue("progress")
            .setEmoji("📊")
            .setDefault(sortType === "progress"),
          new StringSelectMenuOptionBuilder()
            .setLabel("Date Added")
            .setValue("added")
            .setEmoji("📅")
            .setDefault(sortType === "added"),
        ])
    )
  );

  // Book selector dropdown
  if (pageBooks.length) {
    const usedValues = new Set();
    
    const options = pageBooks.map((t, idx) => {
      let safeId = String(t.id);
      
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
          .setCustomId(`trk_select_${filterType}_${sortType}`)
          .setPlaceholder("Select a book to view details…")
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
          .setCustomId(`trk_filter_${filterType}_${sortType}_${page - 1}`)
          .setLabel("◀ Previous")
          .setStyle(ButtonStyle.Secondary)
      );
    }

    if (page < totalPages - 1) {
      navRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`trk_filter_${filterType}_${sortType}_${page + 1}`)
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
        .setStyle(ButtonStyle.Success)
    )
  );

  return rows;
}

function detailEmbed(t, logs, stats) {
  const e = new EmbedBuilder()
    .setTitle(`📖 ${t.title}`)
    .setColor(GOLD);

  if (t.author) e.addFields({ name: "Author", value: t.author, inline: true });
  if (t.status) {
    const statusLabel = {
      reading: "📖 Reading",
      completed: "✅ Completed",
      planned: "📚 Planned",
    }[t.status] || t.status;
    e.addFields({ name: "Status", value: statusLabel, inline: true });
  }
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

  const embed = listEmbed(interaction.user.username, data[userId].tracked, "reading", "recent", 0);
  const components = listComponents(data[userId].tracked, "reading", "recent", 0);

  if (interaction.deferred) {
    await interaction.editReply({ embeds: [embed], components });
  } else if (!interaction.replied) {
    await interaction.reply({ embeds: [embed], components, flags: 1 << 6 });
  }
}

// ===== COMPONENT ROUTER =====

export async function handleComponent(interaction) {
  const cid = interaction.customId;

  // Filter buttons
  if (cid.startsWith("trk_filter_")) {
    const parts = cid.split("_");
    const filterType = parts[2];
    const sortType = parts[3];
    const page = parseInt(parts[4]);
    return handleFilterChange(interaction, filterType, sortType, page);
  }

  // Sort dropdown
  if (cid.startsWith("trk_sort_")) {
    const filterType = cid.split("_")[2];
    return handleSortChange(interaction, filterType);
  }

  // Book select
  if (cid.startsWith("trk_select_")) {
    return handleSelectView(interaction);
  }

  if (cid === "trk_add_modal") return handleAddModal(interaction);
  if (cid.startsWith("trk_update_")) return handleUpdateModal(interaction);
  if (cid.startsWith("trk_complete_")) return handleComplete(interaction);
  if (cid.startsWith("trk_delete_")) return handleDelete(interaction);
  if (cid === "trk_back_to_list") return handleBackToList(interaction);

  return false;
}

// ===== HANDLER: Filter Change =====

async function handleFilterChange(interaction, filterType, sortType, page) {
  await interaction.deferUpdate();

  const data = await loadJSON(FILES.TRACKERS, {});
  const userId = interaction.user.id;
  if (!data[userId]) data[userId] = { tracked: [] };

  const embed = listEmbed(interaction.user.username, data[userId].tracked, filterType, sortType, page);
  const components = listComponents(data[userId].tracked, filterType, sortType, page);

  await interaction.editReply({ embeds: [embed], components });
  return true;
}

// ===== HANDLER: Sort Change =====

async function handleSortChange(interaction, filterType) {
  await interaction.deferUpdate();

  const sortType = interaction.values[0];
  const data = await loadJSON(FILES.TRACKERS, {});
  const userId = interaction.user.id;
  if (!data[userId]) data[userId] = { tracked: [] };

  const embed = listEmbed(interaction.user.username, data[userId].tracked, filterType, sortType, 0);
  const components = listComponents(data[userId].tracked, filterType, sortType, 0);

  await interaction.editReply({ embeds: [embed], components });
  return true;
}

// ===== HANDLER: Select View =====

async function handleSelectView(interaction) {
  await interaction.deferUpdate();

  const selectedValue = interaction.values[0];
  const data = await loadJSON(FILES.TRACKERS, {});
  const userId = interaction.user.id;
  
  let tracker;
  
  if (selectedValue.startsWith("idx_")) {
    const parts = selectedValue.split("_");
    const pageIndex = parseInt(parts[1]);
    tracker = data[userId]?.tracked[pageIndex];
  } else {
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

  const embed = listEmbed(interaction.user.username, data[userId].tracked, "reading", "recent", 0);
  const components = listComponents(data[userId].tracked, "reading", "recent", 0);

  await interaction.editReply({ embeds: [embed], components });
  return true;
}

export const commandName = "tracker";

// commands/shelf.js — Complete Overhaul with Filters, Sorting & Book Club Features
// ✅ Filter by: My Books, All Members, Status (Reading/Completed/Planned)
// ✅ Sort by: Recent, Popular, Title, Date Added
// ✅ Group view: By Book (who's reading what) or By User
// ✅ Shows shared books & multiple readers
// ✅ Modern filtering UI with buttons

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";
import { loadJSON, FILES } from "../utils/storage.js";
import { EMBED_THEME } from "../utils/embedThemes.js";

const PURPLE = 0x9b59b6;
const BLUE = 0x3b82f6;
const GREEN = 0x10b981;
const BOOKS_PER_PAGE = 8;

function formatDate(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return "Unknown date";
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const y = String(d.getFullYear()).slice(-2);
  return `${m}/${day}/${y}`;
}

// ===== Data Processing =====

function getAllBooks(trackers, favorites) {
  const trackerEntries = Object.entries(trackers || {}).flatMap(
    ([userId, data]) =>
      (data.tracked || []).map((b) => ({
        userId,
        title: b.title || "Untitled",
        author: b.author || "Unknown Author",
        status: b.status || "reading",
        currentPage: b.currentPage || 0,
        totalPages: b.totalPages || 0,
        previewLink:
          b.previewLink ||
          b.url ||
          `https://www.google.com/search?q=${encodeURIComponent(b.title || "")}`,
        addedAt: b.startedAt || b.addedAt || b.updatedAt || new Date().toISOString(),
        updatedAt: b.updatedAt || b.startedAt || new Date().toISOString(),
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
        status: "planned",
        currentPage: 0,
        totalPages: 0,
        previewLink:
          b.previewLink ||
          b.url ||
          `https://www.google.com/search?q=${encodeURIComponent(b.title || "")}`,
        addedAt: b.addedAt || new Date().toISOString(),
        updatedAt: b.addedAt || new Date().toISOString(),
      }))
  );

  return [...trackerEntries, ...favoriteEntries];
}

function filterBooks(books, userFilter, statusFilter, currentUserId) {
  let filtered = books;

  // User filter
  if (userFilter === "mine") {
    filtered = filtered.filter((b) => b.userId === currentUserId);
  } else if (userFilter && userFilter !== "all") {
    filtered = filtered.filter((b) => b.userId === userFilter);
  }

  // Status filter
  if (statusFilter !== "all") {
    filtered = filtered.filter((b) => b.status === statusFilter);
  }

  return filtered;
}

function sortBooks(books, sortType) {
  const sorted = [...books];

  switch (sortType) {
    case "title":
      return sorted.sort((a, b) => a.title.localeCompare(b.title));

    case "popular":
      // Group by title and count readers
      const bookCounts = {};
      sorted.forEach((b) => {
        const key = `${b.title}|${b.author}`;
        bookCounts[key] = (bookCounts[key] || 0) + 1;
      });
      return sorted.sort((a, b) => {
        const keyA = `${a.title}|${a.author}`;
        const keyB = `${b.title}|${b.author}`;
        return (bookCounts[keyB] || 0) - (bookCounts[keyA] || 0);
      });

    case "added":
      return sorted.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));

    case "recent":
    default:
      return sorted.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }
}

function groupBooksByTitle(books) {
  const grouped = {};
  books.forEach((b) => {
    const key = `${b.title}|${b.author}`;
    if (!grouped[key]) {
      grouped[key] = {
        title: b.title,
        author: b.author,
        previewLink: b.previewLink,
        readers: [],
      };
    }
    grouped[key].readers.push({
      userId: b.userId,
      status: b.status,
      currentPage: b.currentPage,
      totalPages: b.totalPages,
      addedAt: b.addedAt,
    });
  });
  return Object.values(grouped);
}

// ===== Embed Building =====

function buildShelfEmbed(
  books,
  userFilter,
  statusFilter,
  sortType,
  viewMode,
  page,
  interaction
) {
  const filtered = filterBooks(books, userFilter, statusFilter, interaction.user.id);
  const sorted = sortBooks(filtered, sortType);

  const theme = EMBED_THEME?.HL_BOOK_CLUB || { color: PURPLE };

  if (!sorted.length) {
    const filterLabel = {
      mine: "your",
      all: "the community",
    }[userFilter] || "this user's";

    const statusLabel = {
      reading: "reading",
      completed: "completed",
      planned: "planned",
      all: "",
    }[statusFilter];

    return new EmbedBuilder()
      .setColor(theme.color)
      .setTitle("📚 Bookshelf")
      .setDescription(
        `No ${statusLabel} books found in ${filterLabel} shelf.\n\n` +
        "Try a different filter or add some books!"
      )
      .setFooter({ text: "HL Book Club • Higher-er Learning" });
  }

  // Group view (show books with multiple readers)
  if (viewMode === "grouped") {
    const grouped = groupBooksByTitle(sorted);
    const totalPages = Math.ceil(grouped.length / BOOKS_PER_PAGE);
    const start = page * BOOKS_PER_PAGE;
    const pageBooks = grouped.slice(start, start + BOOKS_PER_PAGE);

    const lines = pageBooks.map((book) => {
      const readerCount = book.readers.length;
      const readerList =
        readerCount <= 3
          ? book.readers.map((r) => `<@${r.userId}>`).join(", ")
          : `<@${book.readers[0].userId}> +${readerCount - 1} more`;

      const statusBreakdown = {
        reading: book.readers.filter((r) => r.status === "reading").length,
        completed: book.readers.filter((r) => r.status === "completed").length,
        planned: book.readers.filter((r) => r.status === "planned").length,
      };

      const statusLine =
        readerCount > 1
          ? `\n   📊 ${statusBreakdown.reading} reading, ${statusBreakdown.completed} completed, ${statusBreakdown.planned} planned`
          : "";

      return `[**${book.title}**](${book.previewLink})\n> **By ${book.author}**\n   👥 ${readerCount} reader${readerCount > 1 ? "s" : ""}: ${readerList}${statusLine}`;
    });

    return new EmbedBuilder()
      .setColor(theme.color)
      .setTitle("📚 HL Book Club — Bookshelf (Grouped)")
      .setDescription(lines.join("\n\n"))
      .setFooter({
        text: `Page ${page + 1}/${totalPages} • ${grouped.length} unique books • HL Book Club`,
      });
  }

  // List view (individual entries)
  const totalPages = Math.ceil(sorted.length / BOOKS_PER_PAGE);
  const start = page * BOOKS_PER_PAGE;
  const pageBooks = sorted.slice(start, start + BOOKS_PER_PAGE);

  const lines = pageBooks.map((b) => {
    const userTag = b.userId ? `<@${b.userId}>` : "Unknown";
    const date = formatDate(b.addedAt);
    const title = b.title.length > 60 ? b.title.slice(0, 57) + "..." : b.title;

    const statusEmoji = {
      reading: "📖",
      completed: "✅",
      planned: "📚",
    }[b.status] || "📖";

    const progress =
      b.totalPages > 0
        ? ` • ${Math.round((b.currentPage / b.totalPages) * 100)}%`
        : "";

    return `${statusEmoji} [**${title}**](${b.previewLink})\n> **By ${b.author}** • ${userTag} • ${date}${progress}`;
  });

  const filterLabel = userFilter === "mine" ? "Your" : "Community";
  const statusLabel = {
    reading: " (Reading)",
    completed: " (Completed)",
    planned: " (Planned)",
    all: "",
  }[statusFilter];

  return new EmbedBuilder()
    .setColor(theme.color)
    .setTitle(`📚 ${filterLabel} Bookshelf${statusLabel}`)
    .setDescription(lines.join("\n\n"))
    .setFooter({
      text: `Page ${page + 1}/${totalPages} • ${sorted.length} books • HL Book Club`,
    });
}

function buildComponents(userFilter, statusFilter, sortType, viewMode, page, totalPages) {
  const rows = [];

  // Row 1: User filter buttons
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`shelf_user_mine_${statusFilter}_${sortType}_${viewMode}_0`)
        .setLabel("👤 My Books")
        .setStyle(userFilter === "mine" ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`shelf_user_all_${statusFilter}_${sortType}_${viewMode}_0`)
        .setLabel("👥 All Members")
        .setStyle(userFilter === "all" ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`shelf_view_${userFilter}_${statusFilter}_${sortType}`)
        .setLabel(viewMode === "grouped" ? "📋 List View" : "📚 Group View")
        .setStyle(ButtonStyle.Secondary)
    )
  );

  // Row 2: Status filter buttons
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`shelf_status_reading_${userFilter}_${sortType}_${viewMode}_0`)
        .setLabel("📖 Reading")
        .setStyle(statusFilter === "reading" ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`shelf_status_completed_${userFilter}_${sortType}_${viewMode}_0`)
        .setLabel("✅ Completed")
        .setStyle(statusFilter === "completed" ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`shelf_status_planned_${userFilter}_${sortType}_${viewMode}_0`)
        .setLabel("📚 Planned")
        .setStyle(statusFilter === "planned" ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`shelf_status_all_${userFilter}_${sortType}_${viewMode}_0`)
        .setLabel("🌟 All")
        .setStyle(statusFilter === "all" ? ButtonStyle.Secondary : ButtonStyle.Secondary)
    )
  );

  // Row 3: Sort dropdown
  rows.push(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`shelf_sort_${userFilter}_${statusFilter}_${viewMode}`)
        .setPlaceholder("Sort by...")
        .setOptions([
          new StringSelectMenuOptionBuilder()
            .setLabel("Recently Updated")
            .setValue("recent")
            .setEmoji("🕐")
            .setDefault(sortType === "recent"),
          new StringSelectMenuOptionBuilder()
            .setLabel("Most Popular")
            .setValue("popular")
            .setEmoji("⭐")
            .setDefault(sortType === "popular"),
          new StringSelectMenuOptionBuilder()
            .setLabel("Title (A-Z)")
            .setValue("title")
            .setEmoji("🔤")
            .setDefault(sortType === "title"),
          new StringSelectMenuOptionBuilder()
            .setLabel("Date Added")
            .setValue("added")
            .setEmoji("📅")
            .setDefault(sortType === "added"),
        ])
    )
  );

  // Row 4: Pagination
  if (totalPages > 1) {
    const navRow = new ActionRowBuilder();

    if (page > 0) {
      navRow.addComponents(
        new ButtonBuilder()
          .setCustomId(
            `shelf_page_${userFilter}_${statusFilter}_${sortType}_${viewMode}_${page - 1}`
          )
          .setLabel("◀ Previous")
          .setStyle(ButtonStyle.Secondary)
      );
    }

    if (page < totalPages - 1) {
      navRow.addComponents(
        new ButtonBuilder()
          .setCustomId(
            `shelf_page_${userFilter}_${statusFilter}_${sortType}_${viewMode}_${page + 1}`
          )
          .setLabel("Next ▶")
          .setStyle(ButtonStyle.Secondary)
      );
    }

    if (navRow.components.length > 0) {
      rows.push(navRow);
    }
  }

  return rows;
}

// ===== Command =====

export const definitions = [
  new SlashCommandBuilder()
    .setName("shelf")
    .setDescription("View the HL Book Club community bookshelf"),
].map((c) => c.toJSON());

export async function execute(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: 1 << 6 });
  }

  const trackers = await loadJSON(FILES.TRACKERS, {});
  const favorites = await loadJSON(FILES.FAVORITES, {});
  const allBooks = getAllBooks(trackers, favorites);

  const embed = buildShelfEmbed(
    allBooks,
    "mine",
    "reading",
    "recent",
    "list",
    0,
    interaction
  );

  const filtered = filterBooks(allBooks, "mine", "reading", interaction.user.id);
  const totalPages = Math.ceil(filtered.length / BOOKS_PER_PAGE);

  const components = buildComponents("mine", "reading", "recent", "list", 0, totalPages);

  if (interaction.deferred) {
    await interaction.editReply({ embeds: [embed], components });
  } else if (!interaction.replied) {
    await interaction.reply({ embeds: [embed], components, flags: 1 << 6 });
  }
}

// ===== Component Handler =====

export async function handleComponent(interaction) {
  const cid = interaction.customId;

  if (!cid.startsWith("shelf_")) return false;

  await interaction.deferUpdate();

  const parts = cid.split("_");
  let userFilter, statusFilter, sortType, viewMode, page;

  if (cid.startsWith("shelf_user_")) {
    // shelf_user_mine_reading_recent_list_0
    [, , userFilter, statusFilter, sortType, viewMode, page] = parts;
  } else if (cid.startsWith("shelf_status_")) {
    // shelf_status_reading_mine_recent_list_0
    [, , statusFilter, userFilter, sortType, viewMode, page] = parts;
  } else if (cid.startsWith("shelf_sort_")) {
    // shelf_sort_mine_reading_list -> dropdown
    [, , userFilter, statusFilter, viewMode] = parts;
    sortType = interaction.values[0];
    page = 0;
  } else if (cid.startsWith("shelf_view_")) {
    // shelf_view_mine_reading_recent
    [, , userFilter, statusFilter, sortType] = parts;
    viewMode = interaction.message.embeds[0]?.title?.includes("Grouped")
      ? "list"
      : "grouped";
    page = 0;
  } else if (cid.startsWith("shelf_page_")) {
    // shelf_page_mine_reading_recent_list_1
    [, , userFilter, statusFilter, sortType, viewMode, page] = parts;
  }

  page = parseInt(page) || 0;

  const trackers = await loadJSON(FILES.TRACKERS, {});
  const favorites = await loadJSON(FILES.FAVORITES, {});
  const allBooks = getAllBooks(trackers, favorites);

  const embed = buildShelfEmbed(
    allBooks,
    userFilter,
    statusFilter,
    sortType,
    viewMode,
    page,
    interaction
  );

  const filtered = filterBooks(allBooks, userFilter, statusFilter, interaction.user.id);
  const sorted = sortBooks(filtered, sortType);
  const totalPages =
    viewMode === "grouped"
      ? Math.ceil(groupBooksByTitle(sorted).length / BOOKS_PER_PAGE)
      : Math.ceil(sorted.length / BOOKS_PER_PAGE);

  const components = buildComponents(
    userFilter,
    statusFilter,
    sortType,
    viewMode,
    page,
    totalPages
  );

  await interaction.editReply({ embeds: [embed], components });
  return true;
}

export const commandName = "shelf";

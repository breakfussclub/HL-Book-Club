// commands/tracker.js — Optimized with Direct SQL & View Separation
// ✅ Direct DB queries for speed
// ✅ Separated UI logic into views/tracker.js
// ✅ Efficient pagination and filtering

import { SlashCommandBuilder } from "discord.js";
import { query } from "../utils/db.js";
import {
  listEmbed,
  listComponents,
  detailEmbed,
  detailComponents,
  addBookModal,
  updateProgressModal,
} from "../views/tracker.js";
import { appendReadingLog, getUserLogs, calcBookStats } from "../utils/analytics.js";

const BOOKS_PER_PAGE = 10;

// ===== DB Helpers =====

async function getBooks(userId, filterType, sortType, page) {
  const offset = page * BOOKS_PER_PAGE;

  let whereClause = "WHERE rl.user_id = $1";
  const params = [userId];

  if (filterType !== "all") {
    whereClause += ` AND rl.status = $${params.length + 1}`;
    params.push(filterType);
  }

  let orderBy = "ORDER BY rl.updated_at DESC"; // Default recent
  if (sortType === "title") orderBy = "ORDER BY b.title ASC";
  if (sortType === "progress") orderBy = "ORDER BY (CAST(rl.current_page AS FLOAT) / NULLIF(rl.total_pages, 0)) DESC NULLS LAST";
  if (sortType === "added") orderBy = "ORDER BY rl.started_at DESC";

  // Get total count for pagination
  const countRes = await query(
    `SELECT COUNT(*) FROM bc_reading_logs rl ${whereClause}`,
    params
  );
  const totalCount = parseInt(countRes.rows[0].count);

  // Get page data
  const sql = `
    SELECT rl.*, b.title, b.author, b.description, b.thumbnail, b.page_count
    FROM bc_reading_logs rl
    JOIN bc_books b ON rl.book_id = b.book_id
    ${whereClause}
    ${orderBy}
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;

  params.push(BOOKS_PER_PAGE, offset);

  const res = await query(sql, params);
  return { books: res.rows, totalCount };
}

async function getBookDetails(userId, bookId) {
  const res = await query(`
    SELECT rl.*, b.title, b.author, b.description, b.thumbnail, b.page_count
    FROM bc_reading_logs rl
    JOIN bc_books b ON rl.book_id = b.book_id
    WHERE rl.user_id = $1 AND rl.book_id = $2
  `, [userId, bookId]);

  return res.rows[0];
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

  const userId = interaction.user.id;
  // Ensure user exists
  await query(`INSERT INTO bc_users (user_id, username) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`, [userId, interaction.user.username]);

  const { books, totalCount } = await getBooks(userId, "reading", "recent", 0);

  const embed = listEmbed(interaction.user.username, books, "reading", "recent", 0, totalCount);
  const components = listComponents(books, "reading", "recent", 0, totalCount);

  await interaction.editReply({ embeds: [embed], components });
}

// ===== COMPONENT ROUTER =====

export async function handleComponent(interaction) {
  const cid = interaction.customId;

  if (cid.startsWith("trk_filter_")) {
    const parts = cid.split("_");
    return handleFilterChange(interaction, parts[2], parts[3], parseInt(parts[4]));
  }
  if (cid.startsWith("trk_sort_")) {
    return handleSortChange(interaction, cid.split("_")[2]);
  }
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

// ===== HANDLERS =====

async function handleFilterChange(interaction, filterType, sortType, page) {
  await interaction.deferUpdate();
  const userId = interaction.user.id;
  const { books, totalCount } = await getBooks(userId, filterType, sortType, page);

  const embed = listEmbed(interaction.user.username, books, filterType, sortType, page, totalCount);
  const components = listComponents(books, filterType, sortType, page, totalCount);

  await interaction.editReply({ embeds: [embed], components });
  return true;
}

async function handleSortChange(interaction, filterType) {
  await interaction.deferUpdate();
  const sortType = interaction.values[0];
  const userId = interaction.user.id;
  const { books, totalCount } = await getBooks(userId, filterType, sortType, 0);

  const embed = listEmbed(interaction.user.username, books, filterType, sortType, 0, totalCount);
  const components = listComponents(books, filterType, sortType, 0, totalCount);

  await interaction.editReply({ embeds: [embed], components });
  return true;
}

async function handleSelectView(interaction) {
  await interaction.deferUpdate();
  const bookId = interaction.values[0];
  const userId = interaction.user.id;

  const book = await getBookDetails(userId, bookId);
  if (!book) {
    return interaction.followUp({ content: "❌ Book not found.", flags: 1 << 6 });
  }

  // TODO: Optimize getUserLogs to use DB
  const logs = await getUserLogs(userId, bookId);
  const stats = calcBookStats(logs);

  const embed = detailEmbed(book, logs, stats);
  const components = detailComponents(bookId);

  await interaction.editReply({ embeds: [embed], components });
  return true;
}

async function handleAddModal(interaction) {
  await interaction.showModal(addBookModal());
  return true;
}

export async function handleModalSubmit(interaction) {
  if (interaction.customId === "trk_add_submit") {
    await interaction.deferReply({ flags: 1 << 6 });
    const title = interaction.fields.getTextInputValue("book_title");
    const author = interaction.fields.getTextInputValue("book_author") || null;
    const pagesStr = interaction.fields.getTextInputValue("book_pages") || "0";
    const totalPages = parseInt(pagesStr) || 0;
    const userId = interaction.user.id;

    // Generate ID
    const bookId = `manual_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // Insert Book
    await query(`
      INSERT INTO bc_books (book_id, title, author, page_count)
      VALUES ($1, $2, $3, $4)
    `, [bookId, title, author, totalPages]);

    // Insert Log
    await query(`
      INSERT INTO bc_reading_logs (user_id, book_id, status, total_pages, started_at, updated_at)
      VALUES ($1, $2, 'reading', $3, NOW(), NOW())
    `, [userId, bookId, totalPages]);

    await interaction.editReply({ content: `✅ Added **${title}** to your tracker!` });
    return true;
  }

  if (interaction.customId.startsWith("trk_update_submit_")) {
    return handleUpdateSubmit(interaction);
  }
  return false;
}

async function handleUpdateModal(interaction) {
  const bookId = interaction.customId.split("_")[2];
  await interaction.showModal(updateProgressModal(bookId));
  return true;
}

async function handleUpdateSubmit(interaction) {
  await interaction.deferReply({ flags: 1 << 6 });
  const bookId = interaction.customId.split("_")[3];
  const newPage = parseInt(interaction.fields.getTextInputValue("new_page"));
  const userId = interaction.user.id;

  if (isNaN(newPage) || newPage < 0) {
    return interaction.editReply({ content: "❌ Invalid page number." });
  }

  const book = await getBookDetails(userId, bookId);
  if (!book) return interaction.editReply({ content: "❌ Book not found." });

  const oldPage = book.current_page || 0;
  const pagesRead = Math.max(0, newPage - oldPage);

  let status = book.status;
  let completedAt = book.completed_at;

  if (book.total_pages && newPage >= book.total_pages) {
    status = "completed";
    completedAt = new Date();
  }

  await query(`
    UPDATE bc_reading_logs
    SET current_page = $1, status = $2, completed_at = $3, updated_at = NOW()
    WHERE user_id = $4 AND book_id = $5
  `, [newPage, status, completedAt, userId, bookId]);

  if (pagesRead > 0) {
    // TODO: Optimize appendReadingLog to use DB
    await appendReadingLog(userId, bookId, pagesRead);
  }

  await interaction.editReply({
    content: `✅ Updated **${book.title}** to page ${newPage}${status === "completed" ? " 🎉 **Completed!**" : ""}`,
  });
  return true;
}

async function handleComplete(interaction) {
  await interaction.deferReply({ flags: 1 << 6 });
  const bookId = interaction.customId.split("_")[2];
  const userId = interaction.user.id;

  await query(`
    UPDATE bc_reading_logs
    SET status = 'completed', completed_at = NOW(), current_page = GREATEST(current_page, total_pages), updated_at = NOW()
    WHERE user_id = $1 AND book_id = $2
  `, [userId, bookId]);

  // Fetch title for reply
  const res = await query(`SELECT title FROM bc_books WHERE book_id = $1`, [bookId]);
  const title = res.rows[0]?.title || "Book";

  await interaction.editReply({ content: `🎉 Marked **${title}** as completed!` });
  return true;
}

async function handleDelete(interaction) {
  await interaction.deferReply({ flags: 1 << 6 });
  const bookId = interaction.customId.split("_")[2];
  const userId = interaction.user.id;

  // Get title first
  const res = await query(`SELECT title FROM bc_books WHERE book_id = $1`, [bookId]);
  const title = res.rows[0]?.title || "Book";

  await query(`DELETE FROM bc_reading_logs WHERE user_id = $1 AND book_id = $2`, [userId, bookId]);

  await interaction.editReply({ content: `✅ Removed **${title}** from your tracker.` });
  return true;
}

async function handleBackToList(interaction) {
  await interaction.deferUpdate();
  const userId = interaction.user.id;
  const { books, totalCount } = await getBooks(userId, "reading", "recent", 0);

  const embed = listEmbed(interaction.user.username, books, "reading", "recent", 0, totalCount);
  const components = listComponents(books, "reading", "recent", 0, totalCount);

  await interaction.editReply({ embeds: [embed], components });
  return true;
}

export const commandName = "tracker";

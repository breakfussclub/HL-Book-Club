// commands/shelf.js — Optimized with SQL
// ✅ Filter by: My Books, All Members, Status
// ✅ Sort by: Recent, Popular, Title, Date Added
// ✅ Group view: By Book (who's reading what)
// ✅ Efficient SQL queries

import { SlashCommandBuilder } from "discord.js";
import { query } from "../utils/db.js";
import { buildShelfEmbed, buildComponents } from "../views/shelf.js";
import { logger } from "../utils/logger.js";

const BOOKS_PER_PAGE = 8;

export const definitions = [
  new SlashCommandBuilder()
    .setName("shelf")
    .setDescription("View the HL Book Club community bookshelf"),
].map((c) => c.toJSON());

async function getShelfData(userFilter, statusFilter, sortType, viewMode, page, currentUserId) {
  const offset = page * BOOKS_PER_PAGE;
  const params = [];
  let whereClauses = [];

  // 1. Build WHERE clause
  if (userFilter === "mine") {
    whereClauses.push(`rl.user_id = $${params.length + 1}`);
    params.push(currentUserId);
  } else if (userFilter && userFilter !== "all") {
    // If we supported filtering by specific user ID in the future
  }

  if (statusFilter !== "all") {
    whereClauses.push(`rl.status = $${params.length + 1}`);
    params.push(statusFilter);
  }

  const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";

  // 2. Handle "Grouped" View (Aggregated by Book)
  if (viewMode === "grouped") {
    // Count total unique books for pagination
    const countSql = `
      SELECT COUNT(DISTINCT rl.book_id)
      FROM bc_reading_logs rl
      ${whereSql}
    `;
    const countRes = await query(countSql, params);
    const totalCount = parseInt(countRes.rows[0].count);

    // Fetch grouped data
    // We need to aggregate readers.
    // PostgreSQL's array_agg is useful here.
    let orderBy = "ORDER BY MAX(rl.updated_at) DESC";
    if (sortType === "title") orderBy = "ORDER BY b.title ASC";
    if (sortType === "popular") orderBy = "ORDER BY COUNT(rl.user_id) DESC";
    if (sortType === "added") orderBy = "ORDER BY MIN(rl.started_at) DESC";

    const sql = `
      SELECT 
        b.book_id, b.title, b.author, b.thumbnail, b.preview_link,
        COUNT(rl.user_id) as reader_count,
        array_agg(rl.user_id) as readers
      FROM bc_reading_logs rl
      JOIN bc_books b ON rl.book_id = b.book_id
      ${whereSql}
      GROUP BY b.book_id, b.title, b.author, b.thumbnail, b.preview_link
      ${orderBy}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const p = [...params, BOOKS_PER_PAGE, offset];
    const res = await query(sql, p);

    return { books: res.rows, totalCount };
  }

  // 3. Handle "List" View (Individual Entries)
  else {
    // Count total entries
    const countSql = `
      SELECT COUNT(*)
      FROM bc_reading_logs rl
      ${whereSql}
    `;
    const countRes = await query(countSql, params);
    const totalCount = parseInt(countRes.rows[0].count);

    // Fetch list data
    let orderBy = "ORDER BY rl.updated_at DESC";
    if (sortType === "title") orderBy = "ORDER BY b.title ASC";
    // Popular sort doesn't make much sense for list view (which is individual entries), 
    // but we could sort by book popularity if needed. For now, fallback to recent.
    if (sortType === "popular") orderBy = "ORDER BY rl.updated_at DESC";
    if (sortType === "added") orderBy = "ORDER BY rl.started_at DESC";

    const sql = `
      SELECT rl.*, b.title, b.author, b.thumbnail, b.preview_link, b.page_count as total_pages
      FROM bc_reading_logs rl
      JOIN bc_books b ON rl.book_id = b.book_id
      ${whereSql}
      ${orderBy}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const p = [...params, BOOKS_PER_PAGE, offset];
    const res = await query(sql, p);

    return { books: res.rows, totalCount };
  }
}

export async function execute(interaction) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: 1 << 6 });
    }

    const currentUserId = interaction.user.id;
    // Default view: Mine, Reading, Recent, List
    const { books, totalCount } = await getShelfData("mine", "reading", "recent", "list", 0, currentUserId);

    const embed = buildShelfEmbed(
      books,
      "mine",
      "reading",
      "recent",
      "list",
      0,
      interaction,
      totalCount
    );

    const components = buildComponents("mine", "reading", "recent", "list", 0, totalCount);

    await interaction.editReply({ embeds: [embed], components });
  } catch (err) {
    logger.error("[shelf.execute]", err);
    await interaction.editReply({ content: "⚠️ Something went wrong." });
  }
}

export async function handleComponent(interaction) {
  const cid = interaction.customId;
  if (!cid.startsWith("shelf_")) return false;

  await interaction.deferUpdate();

  const parts = cid.split("_");
  let userFilter, statusFilter, sortType, viewMode, page;

  // Parse ID
  if (cid.startsWith("shelf_user_")) {
    [, , userFilter, statusFilter, sortType, viewMode, page] = parts;
  } else if (cid.startsWith("shelf_status_")) {
    [, , statusFilter, userFilter, sortType, viewMode, page] = parts;
  } else if (cid.startsWith("shelf_sort_")) {
    [, , userFilter, statusFilter, viewMode] = parts;
    sortType = interaction.values[0];
    page = 0;
  } else if (cid.startsWith("shelf_view_")) {
    [, , userFilter, statusFilter, sortType] = parts;
    // Toggle view mode
    viewMode = parts[parts.length - 1] === "grouped" ? "list" : "grouped"; // Logic in previous file was checking embed title, here we can just toggle or infer.
    // Actually, let's look at the previous view mode in the ID if possible, or default.
    // The ID structure for shelf_view is `shelf_view_${userFilter}_${statusFilter}_${sortType}`.
    // It doesn't contain the *current* viewMode.
    // But we can infer it from the button label if we had access, or we can just toggle based on what we think it is.
    // Better approach: The button ID *should* probably contain the current viewMode so we can toggle it.
    // Let's assume the previous code's logic of checking embed title is hard to replicate here without fetching the message.
    // Let's change the ID structure in views/shelf.js to include viewMode, or just default to 'grouped' if not specified.
    // Wait, the previous code checked `interaction.message.embeds[0]?.title`. We can still do that.
    viewMode = interaction.message.embeds[0]?.title?.includes("Grouped") ? "list" : "grouped";
    page = 0;
  } else if (cid.startsWith("shelf_page_")) {
    [, , userFilter, statusFilter, sortType, viewMode, page] = parts;
  }

  page = parseInt(page) || 0;
  const currentUserId = interaction.user.id;

  const { books, totalCount } = await getShelfData(userFilter, statusFilter, sortType, viewMode, page, currentUserId);

  const embed = buildShelfEmbed(
    books,
    userFilter,
    statusFilter,
    sortType,
    viewMode,
    page,
    interaction,
    totalCount
  );

  const components = buildComponents(
    userFilter,
    statusFilter,
    sortType,
    viewMode,
    page,
    totalCount
  );

  await interaction.editReply({ embeds: [embed], components });
  return true;
}

export const commandName = "shelf";

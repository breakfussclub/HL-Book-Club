// utils/goodreadsSync.js — Simple Working Version (Single Shelf)
import Parser from "rss-parser";
import { loadJSON, saveJSON, FILES } from "./storage.js";
import { logger } from "./logger.js";

const parser = new Parser();

export async function validateGoodreadsUser(usernameOrId) {
  try {
    const rssUrl = `https://www.goodreads.com/review/list_rss/${usernameOrId}?shelf=read`;
    const feed = await parser.parseURL(rssUrl);

    if (!feed || !feed.title) {
      return { valid: false, error: "Invalid user or private profile" };
    }

    return {
      valid: true,
      userId: usernameOrId,
      username: feed.title.replace("'s read shelf: read", "").trim(),
      rssUrl,
    };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

export async function syncUserGoodreads(discordUserId) {
  try {
    const links = await loadJSON(FILES.GOODREADS_LINKS, {});
    const link = links[discordUserId];

    if (!link) {
      return { success: false, error: "Not linked" };
    }

    // Fetch read shelf only
    const rssUrl = `https://www.goodreads.com/review/list_rss/${link.goodreadsUserId}?shelf=read`;
    const feed = await parser.parseURL(rssUrl);
    const books = feed.items || [];

    // Detect new books
    const previousBooks = link.lastSyncBooks || [];
    const previousIds = new Set(previousBooks.map(b => b.guid));
    const newBooks = books.filter(b => !previousIds.has(b.guid));

    // Update link
    link.lastSync = new Date().toISOString();
    link.lastSyncBooks = books;
    await saveJSON(FILES.GOODREADS_LINKS, links);

    return {
      success: true,
      newBooks: newBooks.length,
      totalBooks: books.length,
    };
  } catch (error) {
    logger.error("Sync failed", { discordUserId, error: error.message });
    return { success: false, error: error.message };
  }
}

export async function syncAllUsers(client) {
  return { success: true, total: 0, successCount: 0, failedCount: 0 };
}

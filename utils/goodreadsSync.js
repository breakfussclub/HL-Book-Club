// utils/goodreadsSync.js — Goodreads RSS Sync Logic
// ✅ Validates Goodreads usernames and fetches RSS feeds
// ✅ Parses RSS feeds for book data
// ✅ Detects new books since last sync
// ✅ Integrates with Discord tracker (FIXED: compatible data structure)
// ✅ Multi-shelf support (read, currently-reading, to-read)
// ✅ FIXED: Error handling to prevent notification failures from breaking sync

import Parser from "rss-parser";
import { loadJSON, saveJSON, FILES } from "./storage.js";
import { logger } from "./logger.js";
import { getConfig } from "../config.js";

const config = getConfig();

const parser = new Parser({
  customFields: {
    item: [
      ["book_id", "bookId"],
      ["book_large_image_url", "bookImageUrl"],
      ["book_medium_image_url", "bookImageUrlMedium"],
      ["book_small_image_url", "bookImageUrlSmall"],
      ["author_name", "authorName"],
      ["user_rating", "userRating"],
      ["user_read_at", "userReadAt"],
      ["user_date_added", "userDateAdded"],
      ["user_date_created", "userDateCreated"],
      ["average_rating", "averageRating"],
      ["book_published", "bookPublished"],
      ["num_pages", "numPages"],
    ],
  },
});

// ─────────────────────────────────────────────────────────────
//   VALIDATE GOODREADS USER
// ─────────────────────────────────────────────────────────────

export async function validateGoodreadsUser(usernameOrId) {
  try {
    const rssUrl = `https://www.goodreads.com/review/list_rss/${usernameOrId}?shelf=read`;
    const feed = await parser.parseURL(rssUrl);

    if (!feed || !feed.title) {
      return {
        valid: false,
        error: "Invalid Goodreads user or profile is private",
      };
    }

    // Extract username from feed title
    const username = feed.title.replace("'s read shelf: read", "").trim();

    return {
      valid: true,
      userId: usernameOrId,
      username: username || usernameOrId,
      rssUrl,
    };
  } catch (error) {
    logger.error("Goodreads validation failed", {
      usernameOrId,
      error: error.message,
    });

    if (error.message.includes("404")) {
      return {
        valid: false,
        error: "User not found - check username/ID",
      };
    }

    return {
      valid: false,
      error: error.message,
    };
  }
}

// ─────────────────────────────────────────────────────────────
//   FETCH SHELF BOOKS
// ─────────────────────────────────────────────────────────────

async function fetchShelfBooks(userId, shelf) {
  try {
    const rssUrl = `https://www.goodreads.com/review/list_rss/${userId}?shelf=${shelf}`;
    const feed = await parser.parseURL(rssUrl);

    if (!feed || !feed.items) {
      logger.warn("Empty shelf or parse error", { userId, shelf });
      return [];
    }

    const books = feed.items.map((item) => ({
      bookId: item.bookId || item.guid,
      title: item.title || "Untitled",
      author: item.authorName || "Unknown Author",
      description: item.contentSnippet || item.content || "",
      thumbnail:
        item.bookImageUrl ||
        item.bookImageUrlMedium ||
        item.bookImageUrlSmall ||
        null,
      userRating: item.userRating || null,
      averageRating: item.averageRating || null,
      publishedDate: item.bookPublished || null,
      pageCount: item.numPages ? parseInt(item.numPages) : null,
      readAt: item.userReadAt || null,
      addedAt: item.userDateAdded || item.pubDate || null,
      shelf: shelf, // Track which shelf this came from
    }));

    logger.info("Fetched shelf books", {
      userId,
      shelf,
      count: books.length,
    });

    return books;
  } catch (error) {
    logger.error("Failed to fetch shelf", {
      userId,
      shelf,
      error: error.message,
    });
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
//   MAP SHELF TO STATUS
// ─────────────────────────────────────────────────────────────

function mapShelfToStatus(shelf) {
  const mapping = {
    read: "completed",
    "currently-reading": "reading",
    "to-read": "planned",
  };
  return mapping[shelf] || "planned";
}

// ─────────────────────────────────────────────────────────────
//   SYNC USER GOODREADS (MULTI-SHELF)
// ─────────────────────────────────────────────────────────────

export async function syncUserGoodreads(discordUserId, client) {
  try {
    const links = await loadJSON(FILES.GOODREADS_LINKS, {});
    const link = links[discordUserId];

    if (!link) {
      return {
        success: false,
        error: "User not linked to Goodreads",
      };
    }

    const goodreadsUserId = link.goodreadsUserId;

    // Fetch all 3 shelves
    const shelves = ["read", "currently-reading", "to-read"];
    const allBooks = [];
    const shelfResults = {};

    for (const shelf of shelves) {
      const books = await fetchShelfBooks(goodreadsUserId, shelf);
      shelfResults[shelf] = {
        success: books.length >= 0,
        count: books.length,
      };
      allBooks.push(...books);
    }

    logger.info("Multi-shelf sync completed", {
      discordUserId,
      totalBooks: allBooks.length,
      shelves: shelfResults,
    });

    // Detect new books
    const previousBooks = link.lastSyncBooks || [];
    const previousBookIds = new Set(previousBooks.map((b) => b.bookId));
    const newBooks = allBooks.filter((b) => !previousBookIds.has(b.bookId));

    // Update link data
    link.lastSync = new Date().toISOString();
    link.lastSyncBooks = allBooks;
    link.syncResults = shelfResults;
    await saveJSON(FILES.GOODREADS_LINKS, links);

    // Add to tracker if configured
    if (newBooks.length > 0 && config.goodreads.autoAddToTracker) {
      try {
        await addBooksToTracker(discordUserId, newBooks, client);
      } catch (trackerError) {
        logger.error("Failed to add books to tracker", {
          discordUserId,
          error: trackerError.message,
        });
        // Don't fail the whole sync if tracker update fails
      }
    }

    // Send notification to channel if configured
    if (config.goodreads.notificationChannelId && client) {
      try {
        await sendSyncNotification(discordUserId, newBooks, client);
      } catch (notificationError) {
        // FIXED: Don't let notification failures break the sync
        logger.warn("Notification send failed but sync succeeded", {
          discordUserId,
          error: notificationError.message,
        });
      }
    }

    return {
      success: true,
      newBooks: newBooks.length,
      totalBooks: allBooks.length,
      shelves: shelfResults,
    };
  } catch (error) {
    logger.error("Goodreads sync failed", {
      discordUserId,
      error: error.message,
    });

    return {
      success: false,
      error: error.message,
    };
  }
}

// ─────────────────────────────────────────────────────────────
//   ADD BOOKS TO TRACKER (FIXED DATA STRUCTURE)
// ─────────────────────────────────────────────────────────────

async function addBooksToTracker(discordUserId, books, client) {
  const trackers = await loadJSON(FILES.TRACKERS, {});

  if (!trackers[discordUserId]) {
    trackers[discordUserId] = { tracked: [] };
  }

  const existingTitles = new Set(
    trackers[discordUserId].tracked.map((b) => b.title.toLowerCase())
  );

  for (const book of books) {
    if (existingTitles.has(book.title.toLowerCase())) {
      continue;
    }

    const status = mapShelfToStatus(book.shelf);

    // FIXED: Use correct data structure matching tracker expectations
    const trackerBook = {
      title: book.title,
      author: book.author,
      totalPages: book.pageCount || 0,
      currentPage: status === "completed" ? book.pageCount || 0 : 0,
      status: status,
      startedAt: book.addedAt || new Date().toISOString(),
      completedAt: status === "completed" ? book.readAt || new Date().toISOString() : null,
      source: "goodreads",
      goodreadsId: book.bookId,
      thumbnail: book.thumbnail,
      description: book.description,
      rating: book.userRating || null,
    };

    trackers[discordUserId].tracked.push(trackerBook);
    existingTitles.add(book.title.toLowerCase());
  }

  await saveJSON(FILES.TRACKERS, trackers);

  logger.info("Added Goodreads books to tracker", {
    discordUserId,
    booksAdded: books.length,
  });
}

// ─────────────────────────────────────────────────────────────
//   SEND SYNC NOTIFICATION
// ─────────────────────────────────────────────────────────────

async function sendSyncNotification(discordUserId, books, client) {
  if (books.length === 0) return;

  try {
    const channelId = config.goodreads.notificationChannelId;
    const channel = await client.channels.fetch(channelId);

    if (!channel) {
      logger.warn("Notification channel not found", { channelId });
      return;
    }

    // Group books by shelf
    const booksByShelves = {
      read: books.filter((b) => b.shelf === "read"),
      "currently-reading": books.filter((b) => b.shelf === "currently-reading"),
      "to-read": books.filter((b) => b.shelf === "to-read"),
    };

    let message = `📚 <@${discordUserId}> synced ${books.length} new book${
      books.length === 1 ? "" : "s"
    } from Goodreads!\n\n`;

    // Show books by shelf
    for (const [shelf, shelfBooks] of Object.entries(booksByShelves)) {
      if (shelfBooks.length === 0) continue;

      const emoji = shelf === "read" ? "✅" : shelf === "currently-reading" ? "📖" : "📚";
      const shelfName = shelf.replace("-", " ");
      message += `${emoji} **${shelfName}**:\n`;

      for (const book of shelfBooks.slice(0, 5)) {
        message += `• ${book.title}${book.author ? ` by ${book.author}` : ""}\n`;
      }

      if (shelfBooks.length > 5) {
        message += `...and ${shelfBooks.length - 5} more\n`;
      }

      message += "\n";
    }

    await channel.send(message);

    logger.info("Sent sync notification", {
      discordUserId,
      bookCount: books.length,
    });
  } catch (error) {
    // FIXED: Just log the error, don't throw
    logger.error("Notification send error", {
      discordUserId,
      error: error.message,
    });
  }
}

// ─────────────────────────────────────────────────────────────
//   SCHEDULED SYNC FOR ALL USERS
// ─────────────────────────────────────────────────────────────

export async function syncAllUsers(client) {
  const links = await loadJSON(FILES.GOODREADS_LINKS, {});
  const userIds = Object.keys(links);

  if (userIds.length === 0) {
    logger.debug("No linked Goodreads users to sync");
    return;
  }

  logger.info("Starting scheduled Goodreads sync", {
    userCount: userIds.length,
  });

  let successCount = 0;
  let failCount = 0;

  for (const userId of userIds) {
    try {
      const result = await syncUserGoodreads(userId, client);
      if (result.success) {
        successCount++;
      } else {
        failCount++;
      }
    } catch (error) {
      logger.error("Scheduled sync error", {
        userId,
        error: error.message,
      });
      failCount++;
    }

    // Rate limiting
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  logger.info("Scheduled sync completed", {
    total: userIds.length,
    success: successCount,
    failed: failCount,
  });
}

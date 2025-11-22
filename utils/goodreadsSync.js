// utils/goodreadsSync.js — Goodreads RSS Sync Logic (SQL Version)
// ✅ Validates Goodreads usernames and fetches RSS feeds
// ✅ Parses RSS feeds for book data
// ✅ Detects new books since last sync
// ✅ Integrates with bc_reading_logs and bc_books
// ✅ Multi-shelf support (read, currently-reading, to-read)

import Parser from "rss-parser";
import { query } from "./db.js";
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
      shelf: shelf,
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
    // Get link from DB
    const linkRes = await query(
      `SELECT * FROM bc_goodreads_links WHERE user_id = $1`,
      [discordUserId]
    );
    const link = linkRes.rows[0];

    if (!link) {
      return {
        success: false,
        error: "User not linked to Goodreads",
        newBooks: 0,
        totalBooks: 0,
      };
    }

    const goodreadsUserId = link.goodreads_user_id;

    // Fetch all 3 shelves
    const shelves = ["read", "currently-reading", "to-read"];
    const allBooks = [];
    const shelfResults = {};

    for (const shelf of shelves) {
      try {
        const books = await fetchShelfBooks(goodreadsUserId, shelf);
        shelfResults[shelf] = {
          success: true,
          count: books.length,
        };
        allBooks.push(...books);
      } catch (shelfError) {
        logger.error("Shelf fetch failed", {
          shelf,
          error: shelfError.message,
        });
        shelfResults[shelf] = {
          success: false,
          count: 0,
          error: shelfError.message,
        };
      }
    }

    logger.info("Multi-shelf sync completed", {
      discordUserId,
      totalBooks: allBooks.length,
      shelves: shelfResults,
    });

    // Detect new books
    // We compare against what's already in bc_reading_logs for this user + goodreads source
    // Or we can just rely on "ON CONFLICT DO NOTHING" logic in addBooksToTracker
    // But to report "new books count", we need to know.
    // Let's fetch existing goodreads_ids for this user.

    const existingRes = await query(
      `SELECT goodreads_id FROM bc_reading_logs 
       WHERE user_id = $1 AND goodreads_id IS NOT NULL`,
      [discordUserId]
    );
    const existingIds = new Set(existingRes.rows.map(r => r.goodreads_id));

    const newBooks = allBooks.filter((b) => !existingIds.has(b.bookId));

    // Update link data (last_sync timestamp)
    try {
      await query(
        `UPDATE bc_goodreads_links 
         SET last_sync = NOW(), last_sync_status = $1 
         WHERE user_id = $2`,
        [JSON.stringify(shelfResults), discordUserId]
      );
    } catch (saveError) {
      logger.error("Failed to save link data", {
        discordUserId,
        error: saveError.message,
      });
    }

    // Add to tracker
    if (newBooks.length > 0) {
      try {
        await addBooksToTracker(discordUserId, newBooks, client);
      } catch (trackerError) {
        logger.error("Failed to add books to tracker", {
          discordUserId,
          error: trackerError.message,
        });
      }
    }

    // Send notification (optional)
    if (newBooks.length > 0 && config.goodreads?.notificationChannelId && client) {
      try {
        await sendSyncNotification(discordUserId, newBooks, client);
      } catch (notificationError) {
        logger.warn("Notification send failed", {
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
      stack: error.stack,
    });

    return {
      success: false,
      error: error.message || "Unknown error occurred",
      newBooks: 0,
      totalBooks: 0,
    };
  }
}

// ─────────────────────────────────────────────────────────────
//   ADD BOOKS TO TRACKER
// ─────────────────────────────────────────────────────────────

async function addBooksToTracker(discordUserId, books, client) {
  try {
    let addedCount = 0;

    for (const book of books) {
      const status = mapShelfToStatus(book.shelf);
      const bookId = `gr_${book.bookId}`; // Use consistent ID generation

      // 1. Insert into bc_books (if not exists)
      await query(
        `INSERT INTO bc_books (book_id, title, author, thumbnail, page_count)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (book_id) DO UPDATE 
         SET title = EXCLUDED.title, author = EXCLUDED.author, thumbnail = EXCLUDED.thumbnail, page_count = EXCLUDED.page_count`,
        [bookId, book.title, book.author, book.thumbnail, book.pageCount || 0]
      );

      // 2. Insert into bc_reading_logs
      // We use ON CONFLICT to update status if it changed (e.g. reading -> completed)
      await query(
        `INSERT INTO bc_reading_logs (user_id, book_id, status, current_page, total_pages, started_at, completed_at, source, goodreads_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'goodreads', $8)
         ON CONFLICT (user_id, book_id) DO UPDATE
         SET status = EXCLUDED.status, 
             current_page = CASE WHEN EXCLUDED.status = 'completed' THEN EXCLUDED.total_pages ELSE bc_reading_logs.current_page END,
             completed_at = EXCLUDED.completed_at,
             updated_at = NOW()`,
        [
          discordUserId,
          bookId,
          status,
          status === "completed" ? book.pageCount || 0 : 0,
          book.pageCount || 0,
          book.addedAt || new Date(),
          status === "completed" ? book.readAt || new Date() : null,
          book.bookId
        ]
      );

      addedCount++;
    }

    logger.info("Added Goodreads books to tracker", {
      discordUserId,
      booksAdded: addedCount,
    });

    return { success: true, addedCount };
  } catch (error) {
    logger.error("Tracker update failed", {
      discordUserId,
      error: error.message,
    });
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────
//   SEND SYNC NOTIFICATION
// ─────────────────────────────────────────────────────────────

async function sendSyncNotification(discordUserId, books, client) {
  if (!books || books.length === 0) return;

  try {
    const channelId = config.goodreads?.notificationChannelId;
    if (!channelId) return;

    const channel = await client.channels.fetch(channelId);

    if (!channel) {
      logger.warn("Notification channel not found", { channelId });
      return;
    }

    const booksByShelves = {
      read: books.filter((b) => b.shelf === "read"),
      "currently-reading": books.filter((b) => b.shelf === "currently-reading"),
      "to-read": books.filter((b) => b.shelf === "to-read"),
    };

    let message = `📚 <@${discordUserId}> synced ${books.length} new book${books.length === 1 ? "" : "s"
      } from Goodreads!\n\n`;

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
  try {
    const res = await query(`SELECT user_id FROM bc_goodreads_links`);
    const userIds = res.rows.map(r => r.user_id);

    if (userIds.length === 0) {
      logger.debug("No linked Goodreads users to sync");
      return { success: true, total: 0, successCount: 0, failedCount: 0 };
    }

    logger.info("Starting scheduled Goodreads sync", {
      userCount: userIds.length,
    });

    let successCount = 0;
    let failCount = 0;

    for (const userId of userIds) {
      try {
        const result = await syncUserGoodreads(userId, client);
        if (result && result.success) {
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

    return {
      success: true,
      total: userIds.length,
      successCount,
      failedCount: failCount,
    };
  } catch (error) {
    logger.error("Scheduled sync failed", {
      error: error.message,
    });
    return {
      success: false,
      error: error.message,
      total: 0,
      successCount: 0,
      failedCount: 0,
    };
  }
}

// utils/goodreadsSync.js — Goodreads RSS Sync Logic
// ✅ Validates Goodreads usernames and fetches RSS feeds
// ✅ Parses RSS feeds for book data
// ✅ Detects new books since last sync
// ✅ Integrates with Discord tracker (FIXED: compatible data structure)

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
    // Try to construct RSS URL and fetch it
    const userId = extractUserId(usernameOrId);
    const rssUrl = `https://www.goodreads.com/review/list_rss/${userId}?shelf=read`;

    logger.debug("Validating Goodreads user", { userId, rssUrl });

    const feed = await parser.parseURL(rssUrl);

    if (!feed || !feed.title) {
      return {
        valid: false,
        error: "Could not access Goodreads profile. Make sure your profile is public.",
      };
    }

    // Extract username from feed title (usually "Username's bookshelf: read")
    const username = feed.title.split("'s bookshelf")[0] || userId;

    return {
      valid: true,
      userId,
      username,
      rssUrl,
    };
  } catch (error) {
    logger.error("Goodreads validation failed", { error: error.message });

    if (error.message.includes("404")) {
      return {
        valid: false,
        error: "Goodreads user not found. Check the username/ID and try again.",
      };
    }

    return {
      valid: false,
      error: "Failed to connect to Goodreads. Please try again later.",
    };
  }
}

// ─────────────────────────────────────────────────────────────
//   EXTRACT USER ID FROM INPUT
// ─────────────────────────────────────────────────────────────

function extractUserId(input) {
  // If it's a URL, extract the ID
  if (input.includes("goodreads.com")) {
    const match = input.match(/\/user\/show\/(\d+)/);
    if (match) return match[1];

    const slugMatch = input.match(/\/([^\/]+)$/);
    if (slugMatch) return slugMatch[1];
  }

  // Otherwise assume it's already a username or ID
  return input;
}

// ─────────────────────────────────────────────────────────────
//   FETCH AND PARSE RSS FEED
// ─────────────────────────────────────────────────────────────

export async function fetchGoodreadsShelf(rssUrl) {
  try {
    const feed = await parser.parseURL(rssUrl);

    if (!feed || !feed.items) {
      return { success: false, error: "Invalid RSS feed" };
    }

    const books = feed.items.map((item) => ({
      title: item.title || "Unknown Title",
      author: item.authorName || item.author || "Unknown Author",
      bookId: item.bookId || null,
      isbn: item.isbn || null,
      link: item.link || null,
      imageUrl: item.bookImageUrl || item.bookImageUrlMedium || null,
      rating: item.userRating || null,
      readAt: item.userReadAt || item.userDateCreated || item.pubDate || null,
      dateAdded: item.userDateAdded || item.pubDate || null,
      averageRating: item.averageRating || null,
      published: item.bookPublished || null,
      pages: item.numPages || null,
      guid: item.guid || item.link,
    }));

    return {
      success: true,
      books,
      feedTitle: feed.title,
    };
  } catch (error) {
    logger.error("Failed to fetch Goodreads RSS", { error: error.message, rssUrl });
    return {
      success: false,
      error: error.message,
    };
  }
}

// ─────────────────────────────────────────────────────────────
//   SYNC SINGLE USER
// ─────────────────────────────────────────────────────────────

export async function syncUserGoodreads(discordUserId, client) {
  try {
    const links = await loadJSON(FILES.GOODREADS_LINKS, {});
    const userLink = links[discordUserId];

    if (!userLink) {
      return { success: false, error: "User not linked" };
    }

    logger.info("Syncing Goodreads for user", {
      discordUserId,
      goodreadsUser: userLink.username,
    });

    // Fetch current shelf
    const feedResult = await fetchGoodreadsShelf(userLink.rssUrl);

    if (!feedResult.success) {
      return { success: false, error: feedResult.error };
    }

    const currentBooks = feedResult.books;
    const previousBooks = userLink.lastSyncBooks || [];

    // Detect new books (by comparing GUIDs)
    const previousGuids = new Set(previousBooks.map((b) => b.guid));
    const newBooks = currentBooks.filter((b) => !previousGuids.has(b.guid));

    logger.debug("Goodreads sync results", {
      discordUserId,
      totalBooks: currentBooks.length,
      newBooks: newBooks.length,
    });

    // Update link data
    userLink.lastSync = new Date().toISOString();
    userLink.lastSyncBooks = currentBooks;
    links[discordUserId] = userLink;
    await saveJSON(FILES.GOODREADS_LINKS, links);

    // If new books found, add them to tracker and notify
    if (newBooks.length > 0 && config.goodreads.autoAddToTracker) {
      await addBooksToTracker(discordUserId, newBooks, client);
    }

    return {
      success: true,
      newBooks: newBooks.length,
      totalBooks: currentBooks.length,
      books: newBooks,
    };
  } catch (error) {
    logger.error("Goodreads sync failed", {
      discordUserId,
      error: error.message,
    });
    return { success: false, error: error.message };
  }
}

// ─────────────────────────────────────────────────────────────
//   ADD BOOKS TO TRACKER (FIXED)
// ─────────────────────────────────────────────────────────────

async function addBooksToTracker(discordUserId, books, client) {
  try {
    const trackers = await loadJSON(FILES.TRACKERS, {});

    // Initialize with correct structure: { tracked: [] }
    if (!trackers[discordUserId]) {
      trackers[discordUserId] = { tracked: [] };
    }

    // Get the tracked array
    const tracked = trackers[discordUserId].tracked || [];

    for (const book of books) {
      // Check if book already exists in tracker
      const exists = tracked.some(
        (t) =>
          t.title.toLowerCase() === book.title.toLowerCase() &&
          t.author.toLowerCase() === book.author.toLowerCase()
      );

      if (!exists) {
        // Create tracker entry with all required fields
        tracked.push({
          id: book.bookId || book.guid, // Required: unique identifier
          title: book.title,
          author: book.author,
          thumbnail: book.imageUrl || null, // Required: book cover
          totalPages: book.pages || null,
          currentPage: book.pages || 0, // Mark as completed if pages available
          status: book.pages ? "completed" : "reading",
          archived: false, // Required: tracker filter flag
          startedAt: book.dateAdded || new Date().toISOString(),
          completedAt: book.readAt || (book.pages ? new Date().toISOString() : null),
          updatedAt: new Date().toISOString(), // Required: last update timestamp
          goodreadsId: book.bookId,
          goodreadsLink: book.link,
          addedVia: "goodreads",
        });

        logger.info("Added book from Goodreads", {
          discordUserId,
          title: book.title,
        });
      }
    }

    // Save back to tracked array
    trackers[discordUserId].tracked = tracked;
    await saveJSON(FILES.TRACKERS, trackers);

    // Send notification to channel if configured
    if (config.goodreads.notificationChannelId && client) {
      await sendSyncNotification(discordUserId, books, client);
    }

    return { success: true };
  } catch (error) {
    logger.error("Failed to add books to tracker", {
      discordUserId,
      error: error.message,
    });
    return { success: false, error: error.message };
  }
}

// ─────────────────────────────────────────────────────────────
//   SEND NOTIFICATION TO CHANNEL
// ─────────────────────────────────────────────────────────────

async function sendSyncNotification(discordUserId, books, client) {
  try {
    const channel = await client.channels.fetch(
      config.goodreads.notificationChannelId
    );

    if (!channel) return;

    const user = await client.users.fetch(discordUserId);
    const bookList = books
      .slice(0, 3)
      .map((b) => `• **${b.title}** by ${b.author}`)
      .join("\n");

    const moreText = books.length > 3 ? `\n_...and ${books.length - 3} more_` : "";

    await channel.send(
      `📚 <@${discordUserId}> just synced ${books.length} book${books.length === 1 ? "" : "s"} from Goodreads!\n\n${bookList}${moreText}`
    );
  } catch (error) {
    logger.warn("Failed to send sync notification", {
      error: error.message,
    });
  }
}

// ─────────────────────────────────────────────────────────────
//   SYNC ALL LINKED USERS
// ─────────────────────────────────────────────────────────────

export async function syncAllUsers(client) {
  try {
    const links = await loadJSON(FILES.GOODREADS_LINKS, {});
    const userIds = Object.keys(links);

    if (userIds.length === 0) {
      logger.debug("No linked Goodreads users to sync");
      return { success: true, synced: 0 };
    }

    logger.info("Starting Goodreads sync for all users", {
      userCount: userIds.length,
    });

    let successCount = 0;
    let newBooksTotal = 0;

    for (const userId of userIds) {
      const result = await syncUserGoodreads(userId, client);
      if (result.success) {
        successCount++;
        newBooksTotal += result.newBooks || 0;
      }

      // Rate limiting: wait between requests
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    logger.info("Goodreads sync completed", {
      total: userIds.length,
      successful: successCount,
      newBooks: newBooksTotal,
    });

    return {
      success: true,
      synced: successCount,
      newBooks: newBooksTotal,
    };
  } catch (error) {
    logger.error("Batch Goodreads sync failed", { error: error.message });
    return { success: false, error: error.message };
  }
}

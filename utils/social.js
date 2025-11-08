// utils/social.js
// 🧠 Shared logic for Bookcord social layer
// ✅ Aggregates user stats from books/quotes JSON
// ✅ Prepares data for /profile and /shelf
// ✅ Non-breaking, works with Phase 9 structure

import { loadJSON, FILES } from "./storage.js";

const DEBUG = process.env.DEBUG === "true";

/**
 * Get all user stats for their profile.
 * Returns { booksRead, pagesRead, quotesSaved, currentBook, favoriteQuote }
 */
export async function getUserProfile(userId) {
  const books = await loadJSON(FILES.BOOKS);
  const quotes = await loadJSON(FILES.QUOTES);

  const userBooks = Object.values(books).filter((b) => b.userId === userId);
  const userQuotes = quotes[userId] || [];

  const pagesRead = userBooks.reduce(
    (sum, b) => sum + (b.currentPage || 0),
    0
  );

  const booksRead = userBooks.length;
  const quotesSaved = userQuotes.length;

  // Find current read (most recently updated)
  const currentBook = userBooks.sort(
    (a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0)
  )[0];

  // Find favorite quote (longest or most recent)
  const favoriteQuote =
    userQuotes.length > 0
      ? userQuotes.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0]
      : null;

  return {
    booksRead,
    pagesRead,
    quotesSaved,
    currentBook,
    favoriteQuote,
  };
}

/**
 * Returns a community shelf: everyone’s current book and progress.
 */
export async function getCommunityShelf() {
  const books = await loadJSON(FILES.BOOKS);
  const shelf = Object.values(books)
    .sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0))
    .map((b) => ({
      userId: b.userId,
      title: b.title,
      author: b.author || "Unknown",
      currentPage: b.currentPage || 0,
      totalPages: b.totalPages || 0,
    }));

  if (DEBUG) console.log("📚 Shelf loaded:", shelf.length, "entries");

  return shelf;
}

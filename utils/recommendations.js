// utils/recommendations.js — Book Recommendation Engine
// ✅ Analyzes user reading patterns
// ✅ Fetches related books from Google Books
// ✅ Scores and ranks recommendations
// ✅ Filters duplicates and already-read books

import fetch from "node-fetch";
import { loadJSON, FILES } from "./storage.js";
import { logger } from "./logger.js";
import { config } from "../config.js";

const GOOGLE_API = "https://www.googleapis.com/books/v1/volumes";
const API_KEY = config.apis.googleBooks;

// ─────────────────────────────────────────────────────────────
//   MAIN RECOMMENDATION FUNCTION
// ─────────────────────────────────────────────────────────────

export async function getRecommendations(userId, options = {}) {
  const { genre = null, limit = 5 } = options;

  try {
    // Load user's reading history
    const trackers = await loadJSON(FILES.TRACKERS, {});
    const userBooks = trackers[userId]?.tracked || [];

    if (userBooks.length === 0) {
      return [];
    }

    // Analyze reading patterns
    const patterns = analyzeReadingPatterns(userBooks);

    logger.debug("Reading patterns analyzed", {
      userId,
      completedBooks: patterns.completedCount,
      topGenres: patterns.topGenres.slice(0, 3),
      topAuthors: patterns.topAuthors.slice(0, 3),
    });

    // Generate recommendations
    const recommendations = await generateRecommendations(
      patterns,
      userBooks,
      { genre, limit: limit * 3 } // Get more to filter down
    );

    // Score and rank
    const scored = scoreRecommendations(recommendations, patterns);

    // Filter and deduplicate
    const filtered = filterRecommendations(scored, userBooks, limit);

    return filtered;
  } catch (error) {
    logger.error("Recommendation generation failed", {
      userId,
      error: error.message,
    });
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
//   ANALYZE READING PATTERNS
// ─────────────────────────────────────────────────────────────

function analyzeReadingPatterns(books) {
  const completed = books.filter((b) => b.status === "completed");
  const authors = {};
  const genres = {};
  const languages = {};
  let totalPages = 0;
  let pageCount = 0;

  for (const book of completed) {
    // Count authors
    if (book.author) {
      authors[book.author] = (authors[book.author] || 0) + 1;
    }

    // Estimate genres from title/metadata (would be better with actual genre data)
    // For now, we'll use this in conjunction with Google Books categories

    // Track language preferences
    if (book.language) {
      languages[book.language] = (languages[book.language] || 0) + 1;
    }

    // Average page count
    if (book.totalPages) {
      totalPages += book.totalPages;
      pageCount++;
    }
  }

  // Sort by frequency
  const topAuthors = Object.entries(authors)
    .sort((a, b) => b[1] - a[1])
    .map(([author]) => author);

  const topGenres = Object.entries(genres)
    .sort((a, b) => b[1] - a[1])
    .map(([genre]) => genre);

  const preferredLanguage = Object.keys(languages).length > 0
    ? Object.entries(languages).sort((a, b) => b[1] - a[1])[0][0]
    : "en";

  const avgPages = pageCount > 0 ? Math.round(totalPages / pageCount) : null;

  return {
    completedCount: completed.length,
    topAuthors,
    topGenres,
    preferredLanguage,
    avgPages,
    allTitles: completed.map((b) => b.title.toLowerCase()),
  };
}

// ─────────────────────────────────────────────────────────────
//   GENERATE RECOMMENDATIONS
// ─────────────────────────────────────────────────────────────

async function generateRecommendations(patterns, userBooks, options = {}) {
  const { genre = null, limit = 15 } = options;
  const recommendations = [];
  const seenIds = new Set();

  // Strategy 1: Find books by favorite authors
  for (const author of patterns.topAuthors.slice(0, 3)) {
    const books = await searchBooksByAuthor(author, 3);
    for (const book of books) {
      if (!seenIds.has(book.id)) {
        seenIds.add(book.id);
        recommendations.push({
          ...book,
          reason: `You enjoyed books by ${author}`,
        });
      }
    }
  }

  // Strategy 2: Find similar books to completed ones
  const recentCompleted = userBooks
    .filter((b) => b.status === "completed")
    .slice(-5);

  for (const book of recentCompleted) {
    const similar = await findSimilarBooks(book.title, 2);
    for (const rec of similar) {
      if (!seenIds.has(rec.id)) {
        seenIds.add(rec.id);
        recommendations.push({
          ...rec,
          reason: `Similar to "${book.title}"`,
        });
      }
    }
  }

  // Strategy 3: Search by genre if specified
  if (genre) {
    const genreBooks = await searchBooksByGenre(genre, 5);
    for (const book of genreBooks) {
      if (!seenIds.has(book.id)) {
        seenIds.add(book.id);
        recommendations.push({
          ...book,
          reason: `${genre} book`,
        });
      }
    }
  }

  // Strategy 4: Popular/trending books in preferred genres
  if (!genre && recommendations.length < limit) {
    const trending = await getTrendingBooks(patterns.preferredLanguage, 5);
    for (const book of trending) {
      if (!seenIds.has(book.id)) {
        seenIds.add(book.id);
        recommendations.push({
          ...book,
          reason: "Popular choice",
        });
      }
    }
  }

  return recommendations;
}

// ─────────────────────────────────────────────────────────────
//   GOOGLE BOOKS API HELPERS
// ─────────────────────────────────────────────────────────────

async function searchBooksByAuthor(author, maxResults = 5) {
  try {
    const query = encodeURIComponent(`inauthor:"${author}"`);
    const url = `${GOOGLE_API}?q=${query}&maxResults=${maxResults}&langRestrict=en${
      API_KEY ? `&key=${API_KEY}` : ""
    }`;

    const response = await fetch(url);
    const data = await response.json();

    return parseGoogleBooksResponse(data);
  } catch (error) {
    logger.error("Author search failed", { author, error: error.message });
    return [];
  }
}

async function findSimilarBooks(title, maxResults = 5) {
  try {
    const query = encodeURIComponent(title);
    const url = `${GOOGLE_API}?q=${query}&maxResults=${maxResults}&langRestrict=en${
      API_KEY ? `&key=${API_KEY}` : ""
    }`;

    const response = await fetch(url);
    const data = await response.json();

    return parseGoogleBooksResponse(data);
  } catch (error) {
    logger.error("Similar books search failed", { title, error: error.message });
    return [];
  }
}

async function searchBooksByGenre(genre, maxResults = 5) {
  try {
    const query = encodeURIComponent(`subject:${genre}`);
    const url = `${GOOGLE_API}?q=${query}&maxResults=${maxResults}&orderBy=relevance&langRestrict=en${
      API_KEY ? `&key=${API_KEY}` : ""
    }`;

    const response = await fetch(url);
    const data = await response.json();

    return parseGoogleBooksResponse(data);
  } catch (error) {
    logger.error("Genre search failed", { genre, error: error.message });
    return [];
  }
}

async function getTrendingBooks(language = "en", maxResults = 5) {
  try {
    const url = `${GOOGLE_API}?q=fiction&orderBy=newest&maxResults=${maxResults}&langRestrict=${language}${
      API_KEY ? `&key=${API_KEY}` : ""
    }`;

    const response = await fetch(url);
    const data = await response.json();

    return parseGoogleBooksResponse(data);
  } catch (error) {
    logger.error("Trending books fetch failed", { error: error.message });
    return [];
  }
}

function parseGoogleBooksResponse(data) {
  if (!data.items) return [];

  return data.items.map((item) => {
    const info = item.volumeInfo || {};
    return {
      id: item.id,
      title: info.title || "Untitled",
      authors: info.authors || [],
      description: info.description || "",
      pageCount: info.pageCount || null,
      averageRating: info.averageRating || null,
      thumbnail: info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || null,
      previewLink: info.previewLink || null,
      categories: info.categories || [],
      publishedDate: info.publishedDate || "",
    };
  });
}

// ─────────────────────────────────────────────────────────────
//   SCORE AND RANK RECOMMENDATIONS
// ─────────────────────────────────────────────────────────────

function scoreRecommendations(recommendations, patterns) {
  return recommendations.map((book) => {
    let score = 0;

    // Higher score for books by favorite authors
    if (book.authors.some((a) => patterns.topAuthors.includes(a))) {
      score += 10;
    }

    // Higher score for books with good ratings
    if (book.averageRating) {
      score += book.averageRating * 2;
    }

    // Bonus for books with similar page count to user's average
    if (book.pageCount && patterns.avgPages) {
      const pageDiff = Math.abs(book.pageCount - patterns.avgPages);
      if (pageDiff < 100) score += 5;
      else if (pageDiff < 200) score += 3;
    }

    // Bonus for books with thumbnails (better UX)
    if (book.thumbnail) score += 2;

    return { ...book, score };
  }).sort((a, b) => b.score - a.score);
}

// ─────────────────────────────────────────────────────────────
//   FILTER AND DEDUPLICATE
// ─────────────────────────────────────────────────────────────

function filterRecommendations(recommendations, userBooks, limit) {
  const readTitles = new Set(
    userBooks.map((b) => b.title.toLowerCase())
  );

  return recommendations
    .filter((book) => !readTitles.has(book.title.toLowerCase()))
    .slice(0, limit);
}

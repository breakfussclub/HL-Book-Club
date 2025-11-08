// utils/search.js — Enhanced Google Books integration
// ✅ Adds description, language, ISBN, publishedDate fields
// ✅ Clean hybrid fallback with improved metadata consistency

import fetch from "node-fetch";

const GOOGLE_API = "https://www.googleapis.com/books/v1/volumes";
const DEBUG = process.env.DEBUG === "true";

function mapGoogleBook(item) {
  const info = item.volumeInfo || {};
  const id =
    item.id ||
    info.industryIdentifiers?.[0]?.identifier ||
    Math.random().toString(36).slice(2);
  return {
    id,
    title: info.title || "Untitled",
    authors: info.authors || [],
    description: info.description || "",
    language: info.language || "",
    pageCount: info.pageCount || null,
    publishedDate: info.publishedDate || "",
    industryIdentifiers: info.industryIdentifiers || [],
    thumbnail:
      info.imageLinks?.thumbnail ||
      info.imageLinks?.smallThumbnail ||
      null,
    previewLink: info.previewLink || null,
    source: "Google Books",
  };
}

async function fallbackSearch(query) {
  if (DEBUG)
    console.warn(`[search] fallback for "${query}" (no API key or error)`);
  return [
    {
      id: "local-" + query.toLowerCase().replace(/\s+/g, "-"),
      title: query,
      authors: ["Unknown"],
      description: "No data available (fallback).",
      language: "",
      pageCount: null,
      publishedDate: "",
      industryIdentifiers: [],
      thumbnail: null,
      previewLink: null,
      source: "Fallback",
    },
  ];
}

export async function hybridSearchMany(query, limit = 5) {
  try {
    if (!query?.trim()) return [];

    const apiKey = process.env.GOOGLE_BOOKS_KEY;
    const url = new URL(GOOGLE_API);
    url.searchParams.set("q", query);
    url.searchParams.set("maxResults", limit);
    if (apiKey) url.searchParams.set("key", apiKey);
    // We don't filter by langRestrict to keep results broad

    const res = await fetch(url.toString(), { timeout: 8000 });
    if (!res.ok) throw new Error(`Google Books API ${res.status}`);

    const data = await res.json();
    const mapped =
      (data.items || []).map(mapGoogleBook).slice(0, limit) || [];

    if (DEBUG)
      console.log(
        `[search] GoogleBooks → ${mapped.length} results for "${query}"`
      );

    return mapped.length ? mapped : await fallbackSearch(query);
  } catch (err) {
    console.error("[search.hybridSearchMany]", err);
    return await fallbackSearch(query);
  }
}

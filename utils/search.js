// utils/search.js — Bookcord Phase 8
// Handles Google Books + OpenLibrary hybrid search

import fetch from 'node-fetch';

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

// === GOOGLE BOOKS SEARCH ===
export async function googleSearchMany(query, max = 10, apiKey = process.env.GOOGLE_BOOKS_API_KEY) {
  const url = new URL('https://www.googleapis.com/books/v1/volumes');
  url.searchParams.set('q', query);
  url.searchParams.set('maxResults', String(clamp(max, 1, 10)));
  if (apiKey) url.searchParams.set('key', apiKey);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google Books HTTP ${res.status}`);
  const data = await res.json();

  const items = data.items || [];
  return items.slice(0, max).map(item => {
    const v = item.volumeInfo || {};
    return {
      id: `google:${item.id}`,
      title: v.title || 'Untitled',
      authors: v.authors || [],
      pageCount: v.pageCount || null,
      thumbnail: v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || null,
      previewLink: v.previewLink || null,
      source: 'google',
    };
  });
}

// === OPEN LIBRARY SEARCH ===
export async function openLibrarySearchMany(query, max = 10) {
  const url = new URL('https://openlibrary.org/search.json');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(clamp(max, 1, 10)));

  const res = await fetch(url);
  if (!res.ok) throw new Error(`OpenLibrary HTTP ${res.status}`);
  const data = await res.json();

  const docs = data.docs || [];
  return docs.slice(0, max).map(doc => {
    const coverId = doc.cover_i;
    return {
      id: doc.key ? `openlibrary:${doc.key}` : `openlibrary:${encodeURIComponent(query)}`,
      title: doc.title || 'Untitled',
      authors: doc.author_name || [],
      pageCount: doc.number_of_pages_median || null,
      thumbnail: coverId
        ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
        : null,
      previewLink: doc.key ? `https://openlibrary.org${doc.key}` : null,
      source: 'openlibrary',
    };
  });
}

// === HYBRID SEARCH (try Google first, fallback to OpenLibrary) ===
export async function hybridSearchMany(query, max = 10) {
  try {
    const g = await googleSearchMany(query, max);
    if (g.length) return g;
  } catch (e) {
    console.warn('[google] search failed, fallback:', e.message);
  }

  try {
    const o = await openLibrarySearchMany(query, max);
    if (o.length) return o;
  } catch (e) {
    console.warn('[openlibrary] search failed:', e.message);
  }

  return [];
}

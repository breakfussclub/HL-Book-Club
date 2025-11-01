// commands/book.js — HL Book Club (Phase 8.2)
// Handles all Book Club flow: search, current, leaderboard, quotes, schedules

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { loadJSON, saveJSON, FILES } from '../utils/storage.js';
import { hybridSearchMany } from '../utils/search.js';
import { getUserLogs } from '../utils/analytics.js';

const PURPLE = 0x8b5cf6;
const isMod = inter =>
  inter.memberPermissions?.has('ManageGuild') ||
  inter.member?.roles?.cache?.some(r => r.name.toLowerCase().includes('mod'));

function sortSchedules(arr = []) {
  return [...arr].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// ===== Slash Command Definitions =====
export const definitions = [
  new SlashCommandBuilder()
    .setName('book')
    .setDescription('Book club commands')
    .addSubcommand(sc =>
      sc
        .setName('search')
        .setDescription('Search for a book')
        .addStringOption(o =>
          o.setName('query').setDescription('Title/author/ISBN').setRequired(true)
        )
    )
    .addSubcommand(sc => sc.setName('list').setDescription('Show recently added club books'))
    .addSubcommand(sc => sc.setName('current').setDescription('Show the current club read'))
    .addSubcommand(sc =>
      sc
        .setName('set-club-current')
        .setDescription('Set the club current book (mods only)')
        .addStringOption(o =>
          o.setName('query').setDescription('Title/author/ISBN').setRequired(true)
        )
    )
    .addSubcommand(sc =>
      sc
        .setName('leaderboard')
        .setDescription('Show top readers')
        .addStringOption(o =>
          o
            .setName('range')
            .setDescription('Time range')
            .setChoices(
              { name: 'All time', value: 'all' },
              { name: 'This month', value: 'month' },
              { name: 'This week', value: 'week' }
            )
        )
    )
    .addSubcommand(sc =>
      sc
        .setName('quote')
        .setDescription('Save a quote under your first tracked book')
        .addStringOption(o =>
          o.setName('text').setDescription('The quote text').setRequired(true)
        )
    )
    .addSubcommand(sc => sc.setName('my-quotes').setDescription('Show your saved quotes'))
    .addSubcommand(sc =>
      sc
        .setName('schedule-add')
        .setDescription('Add a schedule item (mods only)')
        .addStringOption(o => o.setName('date').setDescription('YYYY-MM-DD').setRequired(true))
        .addStringOption(o => o.setName('description').setDescription('What’s happening?').setRequired(true))
    )
    .addSubcommand(sc => sc.setName('schedule-list').setDescription('List upcoming schedule items'))
    .addSubcommand(sc =>
      sc
        .setName('schedule-remove')
        .setDescription('Remove a schedule item (mods only)')
        .addIntegerOption(o =>
          o.setName('index').setDescription('Number from list').setRequired(true).setMinValue(1)
        )
    )
].map(c => c.toJSON());

// ===== Command Execution =====
export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const user = interaction.user;

  // --- search ---
  if (sub === 'search') {
    const query = interaction.options.getString('query', true);
    await interaction.deferReply();

    const results = await hybridSearchMany(query, 1);
    if (!results.length)
      return interaction.editReply({ content: `No results found for **${query}**.` });

    const book = results[0];
    const e = new EmbedBuilder()
      .setColor(PURPLE)
      .setAuthor({
        name: 'HL Book Club',
        iconURL: interaction.client.user.displayAvatarURL()
      })
      .setTitle(book.title)
      .setURL(book.previewLink || null)
      .setThumbnail(book.thumbnail || null);

    try {
      const googleData = await fetch(
        `https://www.googleapis.com/books/v1/volumes/${book.id.replace('google:', '')}`
      ).then(r => (r.ok ? r.json() : null));
      const v = googleData?.volumeInfo || {};
      const desc = v.description
        ? v.description.length > 500
          ? v.description.slice(0, 500) + '…'
          : v.description
        : 'No summary available.';
      const authors = (v.authors || book.authors || []).join(', ') || 'Unknown';
      const lang = v.language ? v.language.toUpperCase() : '—';
      const pages = v.pageCount || book.pageCount || '—';
      const pub = v.publishedDate || '—';
      const publisher = v.publisher ? ` • ${v.publisher}` : '';

      e.setDescription(`> ${desc}`)
        .addFields(
          { name: 'Authors', value: authors, inline: true },
          { name: 'Language', value: lang, inline: true },
          { name: 'Page count', value: String(pages), inline: true }
        )
        .setFooter({ text: `📚 Google Books • Published on ${pub}${publisher}` });
    } catch {
      e.setDescription('No summary available.');
    }

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('View on Google Books')
        .setStyle(ButtonStyle.Link)
        .setURL(book.previewLink || `https://www.google.com/search?q=${encodeURIComponent(book.title)}+book`),
      new ButtonBuilder()
        .setLabel('Find on Z-Library')
        .setStyle(ButtonStyle.Link)
        .setURL(`https://z-lib.io/s/${encodeURIComponent(book.title)}`),
      new ButtonBuilder()
        .setLabel('Find on Anna’s Archive')
        .setStyle(ButtonStyle.Link)
        .setURL(`https://annas-archive.org/search?q=${encodeURIComponent(book.title)}`),
      new ButtonBuilder()
        .setCustomId(`book_add_tracker_${interaction.user.id}`)
        .setLabel('❤️ Add to My Tracker')
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.editReply({ embeds: [e], components: [buttons] });

    interaction.client.searchCache = interaction.client.searchCache || new Map();
    interaction.client.searchCache.set(interaction.user.id, [book]);
    return;
  }

  // --- list ---
  if (sub === 'list') {
    const club = await loadJSON(FILES.CLUB);
    if (!club.books.length)
      return interaction.reply({ content: 'No club books yet. Mods can set the current read using `/book set-club-current`.' });
    const lines = club.books
      .slice(0, 10)
      .map((b, i) => `**${i + 1}.** ${b.title}${b.authors?.length ? ` — ${b.authors.join(', ')}` : ''}`);
    const e = new EmbedBuilder()
      .setTitle('📚 HL Book Club List (Latest 10)')
      .setColor(PURPLE)
      .setDescription(lines.join('\n'))
      .setFooter({ text: `Total: ${club.books.length}` });
    return interaction.reply({ embeds: [e] });
  }

  // --- current ---
  if (sub === 'current') {
    const club = await loadJSON(FILES.CLUB);
    const e = new EmbedBuilder().setTitle('📌 Club Current Read').setColor(0xf59e0b);
    if (club.clubCurrent) {
      e.setDescription(`**${club.clubCurrent.title}** — ${club.clubCurrent.authors?.join(', ') || 'Unknown'}`);
      if (club.clubCurrent.thumbnail) e.setThumbnail(club.clubCurrent.thumbnail);
      const setBy = club.clubCurrent.setBy ? `<@${club.clubCurrent.setBy}>` : 'Unknown';
      const setAt = club.clubCurrent.setAt ? new Date(club.clubCurrent.setAt).toLocaleDateString() : '';
      e.setFooter({ text: `Set by ${setBy} • ${setAt}` });
    } else e.setDescription('No club current set.');
    return interaction.reply({ embeds: [e] });
  }

  // --- set current ---
  if (sub === 'set-club-current') {
    if (!isMod(interaction))
      return interaction.reply({ content: 'No permission.', ephemeral: true });
    const q = interaction.options.getString('query', true);
    await interaction.deferReply();
    const results = await hybridSearchMany(q, 1);
    if (!results.length)
      return interaction.editReply({ content: `No results for **${q}**.` });
    const book = results[0];
    const club = await loadJSON(FILES.CLUB);
    club.clubCurrent = {
      id: book.id,
      title: book.title,
      authors: book.authors,
      thumbnail: book.thumbnail,
      source: book.source,
      setAt: new Date().toISOString(),
      setBy: user.id
    };
    await saveJSON(FILES.CLUB, club);
    const e = new EmbedBuilder()
      .setTitle(`Club Current Read: ${book.title}`)
      .setColor(0xf59e0b);
    if (book.thumbnail) e.setThumbnail(book.thumbnail);
    if (book.previewLink) e.setURL(book.previewLink);
    if (book.authors?.length) e.setDescription(`by ${book.authors.join(', ')}`);
    return interaction.editReply({ embeds: [e] });
  }

  // --- leaderboard ---
  if (sub === 'leaderboard') {
    await interaction.deferReply();
    const range = interaction.options.getString('range') || 'all';
    const trackers = await loadJSON(FILES.TRACKERS);
    const logsAll = await loadJSON(FILES.READING_LOGS);
    const now = new Date();
    let since = null;
    if (range === 'week') since = new Date(now.getTime() - 7 * 86400000);
    else if (range === 'month') {
      const tmp = new Date(now);
      tmp.setDate(1);
      since = tmp;
    }

    const pagesInRange = userLogs => {
      const logs = (userLogs || [])
        .filter(l => !since || new Date(l.at) >= since)
        .sort((a, b) => new Date(a.at) - new Date(b.at));
      let pages = 0;
      for (let i = 1; i < logs.length; i++) {
        const d = logs[i].page - logs[i - 1].page;
        if (logs[i].bookId === logs[i - 1].bookId && d > 0) pages += d;
      }
      return pages;
    };

    const completedBooks = userId => {
      const user = trackers[userId];
      if (!user) return 0;
      const arr = user.tracked || [];
      if (range === 'all')
        return arr.filter(t => t.totalPages && t.currentPage >= t.totalPages).length;
      return arr.filter(
        t =>
          t.totalPages &&
          t.currentPage >= t.totalPages &&
          (!since || new Date(t.updatedAt) >= since)
      ).length;
    };

    const scores = [];
    for (const uid of Object.keys(trackers)) {
      const p = pagesInRange(logsAll[uid]);
      const c = completedBooks(uid);
      if (p > 0 || c > 0) scores.push({ uid, pages: p, completed: c });
    }

    if (!scores.length)
      return interaction.editReply({ content: 'No progress to rank yet.' });
    scores.sort((a, b) => b.pages - a.pages || b.completed - a.completed);
    const medals = ['🥇', '🥈', '🥉'];
    const label = range === 'week' ? 'This Week' : range === 'month' ? 'This Month' : 'All Time';
    const top = scores
      .slice(0, 10)
      .map((s, i) => {
        const medal = medals[i] || `#${i + 1}`;
        return `${medal} <@${s.uid}> — **${s.pages} pages**${s.completed ? ` • ${s.completed} completed` : ''}`;
      })
      .join('\n');

    const e = new EmbedBuilder()
      .setTitle(`🏆 HL Book Club Leaderboard — ${label}`)
      .setColor(0xf43f5e)
      .setDescription(top);
    return interaction.editReply({ embeds: [e] });
  }

  // --- quotes + schedules (unchanged) ---
  // ... (the rest of your quote/schedule commands stay identical)
}

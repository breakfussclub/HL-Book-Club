// commands/book.js — Bookcord Phase 8
// Handles /book group: search, add, list, current, leaderboard, quotes, schedules

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

// Helper: sort club schedules chronologically
function sortSchedules(arr = []) {
  return [...arr].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// ===== Slash Command Definitions =====
export const definitions = [
  new SlashCommandBuilder()
    .setName('book')
    .setDescription('Book club commands')
    .addSubcommand(sc =>
      sc.setName('search')
        .setDescription('Search for a book')
        .addStringOption(o =>
          o.setName('query').setDescription('Title/author/ISBN').setRequired(true)
        )
    )
    .addSubcommand(sc =>
      sc.setName('add')
        .setDescription('Add a book to the club list')
        .addStringOption(o =>
          o.setName('query').setDescription('Title/author/ISBN').setRequired(true)
        )
    )
    .addSubcommand(sc => sc.setName('list').setDescription('Show recently added club books'))
    .addSubcommand(sc => sc.setName('current').setDescription('Show the current club read'))
    .addSubcommand(sc =>
      sc.setName('set-club-current')
        .setDescription('Set the club current book (mods only)')
        .addStringOption(o =>
          o.setName('query').setDescription('Title/author/ISBN').setRequired(true)
        )
    )
    .addSubcommand(sc =>
      sc.setName('leaderboard')
        .setDescription('Show top readers')
        .addStringOption(o =>
          o.setName('range')
            .setDescription('Time range')
            .setChoices(
              { name: 'All time', value: 'all' },
              { name: 'This month', value: 'month' },
              { name: 'This week', value: 'week' }
            )
        )
    )
    .addSubcommand(sc =>
      sc.setName('quote')
        .setDescription('Save a quote under your first tracked book')
        .addStringOption(o =>
          o.setName('text').setDescription('The quote text').setRequired(true)
        )
    )
    .addSubcommand(sc => sc.setName('my-quotes').setDescription('Show your saved quotes'))
    .addSubcommand(sc =>
      sc.setName('schedule-add')
        .setDescription('Add a schedule item (mods only)')
        .addStringOption(o => o.setName('date').setDescription('YYYY-MM-DD').setRequired(true))
        .addStringOption(o => o.setName('description').setDescription('What’s happening?').setRequired(true))
    )
    .addSubcommand(sc => sc.setName('schedule-list').setDescription('List upcoming schedule items'))
    .addSubcommand(sc =>
      sc.setName('schedule-remove')
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
      .setColor(0x5865f2)
      .setAuthor({ name: 'Bookcord', iconURL: interaction.client.user.displayAvatarURL() })
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
    } catch (err) {
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

  // --- add ---
  if (sub === 'add') {
    const query = interaction.options.getString('query', true);
    await interaction.deferReply();
    const results = await hybridSearchMany(query, 1);
    if (!results.length)
      return interaction.editReply({ content: `No results for **${query}**.` });
    const book = results[0];
    const club = await loadJSON(FILES.CLUB);
    if (!club.books.find(b => b.id === book.id)) {
      club.books.unshift({
        id: book.id,
        title: book.title,
        authors: book.authors,
        thumbnail: book.thumbnail,
        source: book.source,
        addedBy: user.id,
        addedAt: new Date().toISOString()
      });
      if (club.books.length > 1000) club.books.pop();
      await saveJSON(FILES.CLUB, club);
    }
    const e = new EmbedBuilder().setTitle(`Added to Book Club: ${book.title}`).setColor(0x16a34a);
    if (book.thumbnail) e.setThumbnail(book.thumbnail);
    if (book.previewLink) e.setURL(book.previewLink);
    if (book.authors?.length) e.setDescription(`by ${book.authors.join(', ')}`);
    return interaction.editReply({ embeds: [e] });
  }

  // --- list ---
  if (sub === 'list') {
    const club = await loadJSON(FILES.CLUB);
    if (!club.books.length)
      return interaction.reply({ content: 'No club books yet. Use `/book add`.' });
    const lines = club.books
      .slice(0, 10)
      .map((b, i) => `**${i + 1}.** ${b.title}${b.authors?.length ? ` — ${b.authors.join(', ')}` : ''}`);
    const e = new EmbedBuilder()
      .setTitle('📚 Book Club List (Latest 10)')
      .setColor(0x16a34a)
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
      const setBy = club.clubCurrent.setBy
        ? `<@${club.clubCurrent.setBy}>`
        : 'Unknown';
      const setAt = club.clubCurrent.setAt
        ? new Date(club.clubCurrent.setAt).toLocaleDateString()
        : '';
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
    const label =
      range === 'week' ? 'This Week' : range === 'month' ? 'This Month' : 'All Time';
    const top = scores
      .slice(0, 10)
      .map((s, i) => {
        const medal = medals[i] || `#${i + 1}`;
        return `${medal} <@${s.uid}> — **${s.pages} pages**${
          s.completed ? ` • ${s.completed} completed` : ''
        }`;
      })
      .join('\n');

    const e = new EmbedBuilder()
      .setTitle(`🏆 Leaderboard — ${label}`)
      .setColor(0xf43f5e)
      .setDescription(top);
    return interaction.editReply({ embeds: [e] });
  }

  // --- quote add ---
  if (sub === 'quote') {
    const text = interaction.options.getString('text', true).trim();
    const quotes = await loadJSON(FILES.QUOTES);
    quotes['misc'] = quotes['misc'] || [];
    quotes['misc'].unshift({ text, by: user.id, at: new Date().toISOString() });
    await saveJSON(FILES.QUOTES, quotes);
    return interaction.reply({ content: '🪶 Quote saved.', ephemeral: true });
  }

  // --- my-quotes ---
  if (sub === 'my-quotes') {
    const quotes = await loadJSON(FILES.QUOTES);
    const mine = [];
    for (const arr of Object.values(quotes))
      for (const q of arr) if (q.by === user.id) mine.push(q);
    if (!mine.length)
      return interaction.reply({ content: 'No quotes yet.', ephemeral: true });
    mine.sort((a, b) => (a.at > b.at ? -1 : 1));
    const top = mine
      .slice(0, 5)
      .map(
        (q, i) =>
          `**${i + 1}.** “${q.text}” — *${new Date(q.at).toLocaleString()}*`
      )
      .join('\n\n');
    const e = new EmbedBuilder().setTitle('🪶 My Quotes').setColor(PURPLE).setDescription(top);
    return interaction.reply({ embeds: [e], ephemeral: true });
  }

  // --- schedule add/list/remove ---
  if (sub === 'schedule-add') {
    if (!isMod(interaction))
      return interaction.reply({ content: 'No permission.', ephemeral: true });
    const dateStr = interaction.options.getString('date', true).trim();
    const desc = interaction.options.getString('description', true).trim();
    const club = await loadJSON(FILES.CLUB);
    club.schedules.push({
      date: dateStr,
      description: desc,
      setBy: user.id,
      createdAt: new Date().toISOString()
    });
    club.schedules = sortSchedules(club.schedules);
    await saveJSON(FILES.CLUB, club);
    const e = new EmbedBuilder()
      .setTitle('🗓️ Schedule Added')
      .setColor(0x22c55e)
      .setDescription(`**${dateStr}** — ${desc}`);
    return interaction.reply({ embeds: [e] });
  }

  if (sub === 'schedule-list') {
    const club = await loadJSON(FILES.CLUB);
    const items = sortSchedules(club.schedules || []);
    if (!items.length) return interaction.reply({ content: 'No schedule items yet.' });
    const lines = items
      .slice(0, 10)
      .map((s, i) => `**${i + 1}.** **${s.date}** — ${s.description}`);
    const e = new EmbedBuilder()
      .setTitle('🗓️ Upcoming Schedule')
      .setColor(0x06b6d4)
      .setDescription(lines.join('\n'))
      .setFooter({ text: `Total items: ${items.length}` });
    return interaction.reply({ embeds: [e] });
  }

  if (sub === 'schedule-remove') {
    if (!isMod(interaction))
      return interaction.reply({ content: 'No permission.', ephemeral: true });
    const index = interaction.options.getInteger('index', true);
    const club = await loadJSON(FILES.CLUB);
    club.schedules = sortSchedules(club.schedules || []);
    if (index < 1 || index > club.schedules.length)
      return interaction.reply({ content: `Invalid index.`, ephemeral: true });
    const removed = club.schedules.splice(index - 1, 1)[0];
    await saveJSON(FILES.CLUB, club);
    const e = new EmbedBuilder()
      .setTitle('🗓️ Schedule Removed')
      .setColor(0xef4444)
      .setDescription(`**${removed.date}** — ${removed.description}`);
    return interaction.reply({ embeds: [e] });
  }
}

// ===== Component Handling =====
export async function handleComponent(i) {
  if (i.isButton() && i.customId.startsWith('book_add_tracker_')) {
    const uid = i.customId.split('_').pop();
    if (uid !== i.user.id)
      return i.reply({ content: 'This button isn’t for you.', ephemeral: true });

    const list = i.client.searchCache?.get(i.user.id) || [];
    const book = list[0];
    if (!book)
      return i.reply({
        content: 'Search expired. Please run `/book search` again.',
        ephemeral: true
      });

    const modal = new ModalBuilder()
      .setCustomId('trk_create_modal')
      .setTitle('Create a new tracker');
    const page = new TextInputBuilder()
      .setCustomId('trk_page')
      .setLabel('Your Current Page *')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder('e.g., 1');
    const total = new TextInputBuilder()
      .setCustomId('trk_total')
      .setLabel('Total Pages (optional)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder(book.pageCount ? String(book.pageCount) : 'e.g., 220');
    modal.addComponents(
      new ActionRowBuilder().addComponents(page),
      new ActionRowBuilder().addComponents(total)
    );
    await i.showModal(modal);
    return;
  }
}

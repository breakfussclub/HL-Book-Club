// commands/tracker.js — Bookcord Phase 8
// Handles /tracker dashboard, modals, updates, and components

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { loadJSON, saveJSON, FILES } from '../utils/storage.js';
import { appendReadingLog, getUserLogs, calcBookStats } from '../utils/analytics.js';
import { hybridSearchMany } from '../utils/search.js';

const PURPLE = 0x8b5cf6;

// ====== UTILITIES ======
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const fmtTime = d => new Date(d).toLocaleString();
const progressBarPages = (current, total, width = 18) => {
  if (!total || total <= 0) return '▱'.repeat(width);
  const pct = clamp(current / total, 0, 1);
  const filled = Math.round(pct * width);
  return '▰'.repeat(filled) + '▱'.repeat(Math.max(0, width - filled));
};

// ====== TRACKER STORAGE HELPERS ======
async function getUserTrackers(userId) {
  const trackers = await loadJSON(FILES.TRACKERS);
  return trackers[userId]?.tracked || [];
}
async function saveUserTrackers(userId, trackedArray) {
  const trackers = await loadJSON(FILES.TRACKERS);
  trackers[userId] = trackers[userId] || { tracked: [] };
  trackers[userId].tracked = trackedArray;
  await saveJSON(FILES.TRACKERS, trackers);
}

// ====== EMBED BUILDERS ======
function listEmbed(username, trackedActive, selectedId = null) {
  const e = new EmbedBuilder()
    .setTitle(`📚 ${username}'s Trackers`)
    .setColor(PURPLE);

  if (!trackedActive.length) {
    e.setDescription('You are not tracking any books yet.\n\nClick **Add Book** to search and create a tracker.');
    return e;
  }

  const lines = trackedActive.map(t => {
    const sel = t.id === selectedId ? ' **(selected)**' : '';
    const cp = Number(t.currentPage || 0);
    const tp = Number(t.totalPages || 0);
    const bar = tp ? `${progressBarPages(cp, tp)} ` : '';
    const done = tp && cp >= tp ? ' ✅ Completed' : '';
    const author = t.author ? ` — *${t.author}*` : '';
    return `• **${t.title}**${author} — ${bar}Page ${cp}${tp ? `/${tp}` : ''}${done}${sel}`;
  }).join('\n');

  e.setDescription(lines);
  return e;
}

function listComponents(trackedActive) {
  const rows = [];
  if (trackedActive.length) {
    const options = trackedActive.slice(0, 25).map(t =>
      new StringSelectMenuOptionBuilder()
        .setLabel(t.title.slice(0, 100))
        .setValue(t.id)
        .setDescription(`Page ${Number(t.currentPage || 0)}${t.totalPages ? `/${t.totalPages}` : ''}`)
    );
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('trk_select_view')
          .setPlaceholder('Select a book to open its tracker…')
          .setMinValues(1)
          .setMaxValues(1)
          .setOptions(options)
      )
    );
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('trk_add_open')
        .setLabel('Add Book')
        .setStyle(ButtonStyle.Primary)
    )
  );
  return rows;
}

function detailEmbed(book, stats) {
  const cp = Number(book.currentPage || 0);
  const tp = Number(book.totalPages || 0);
  const e = new EmbedBuilder()
    .setTitle(`📘 ${book.title}`)
    .setColor(tp && cp >= tp ? 0xf59e0b : PURPLE)
    .setDescription(
      [
        book.author ? `*by ${book.author}*` : null,
        '',
        tp ? `${progressBarPages(cp, tp)}  **Page ${cp}/${tp}**` : `**Page ${cp}**`,
        stats ? `\n📈 **${tp ? Math.round(clamp(cp / tp, 0, 1) * 100) : 0}% complete**` : null,
        stats ? `🔥 **${stats.streak} day${stats.streak === 1 ? '' : 's'}** streak • avg **${stats.avgPerDay.toFixed(1)}** pages/day` : null,
        tp && cp >= tp ? '✅ Completed' : null
      ]
        .filter(Boolean)
        .join('\n')
    );

  if (book.thumbnail) e.setThumbnail(book.thumbnail);
  e.setFooter({ text: `Last updated ⏱ ${fmtTime(book.updatedAt || Date.now())}` });
  return e;
}

function detailComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('trk_update_open').setLabel('🟣 Update Tracker').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('trk_archive').setLabel('🗃 Archive Tracker').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('trk_delete').setLabel('❌ Delete Tracker').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('trk_back').setLabel('↩ Back to All Trackers').setStyle(ButtonStyle.Secondary)
    )
  ];
}

// ====== INTERACTION RENDERERS ======
async function renderList(ctx, user, forceSelectedId = null) {
  const all = await getUserTrackers(user.id);
  const active = all.filter(t => !t.archived);
  const selectedId = forceSelectedId || (active.length ? active[0].id : null);
  const embed = listEmbed(user.username, active, selectedId);
  const comps = listComponents(active);
  return ctx.reply ? ctx.reply({ embeds: [embed], components: comps, ephemeral: true }) : ctx.update({ embeds: [embed], components: comps });
}

async function renderDetail(ctx, user, bookId) {
  const all = await getUserTrackers(user.id);
  const book = all.find(t => t.id === bookId);
  if (!book) return renderList(ctx, user);

  const logs = await getUserLogs(user.id);
  const stats = calcBookStats(logs, book.id);
  const embed = detailEmbed(book, stats);
  const comps = detailComponents();
  return ctx.reply ? ctx.reply({ embeds: [embed], components: comps, ephemeral: true }) : ctx.update({ embeds: [embed], components: comps });
}

// ====== TRACKER LOGIC ======
function buildTrackerFromSearch(bookObj, page, totalPages) {
  const author = Array.isArray(bookObj.authors) ? bookObj.authors.join(', ') : bookObj.authors || '';
  return {
    id: bookObj.id,
    title: bookObj.title,
    author: author || null,
    thumbnail: bookObj.thumbnail || null,
    currentPage: clamp(Number(page || 0), 0, Number(totalPages || Infinity)),
    totalPages: Number(totalPages || 0) || null,
    archived: false,
    status: 'active',
    updatedAt: new Date().toISOString(),
  };
}

function updateTrackerFields(t, page, totalPages) {
  const tp = totalPages !== '' && totalPages != null ? Number(totalPages) : t.totalPages;
  t.currentPage = clamp(Number(page || 0), 0, Number(tp || Infinity));
  t.totalPages = tp ? Number(tp) : null;
  t.updatedAt = new Date().toISOString();
  if (t.totalPages && t.currentPage >= t.totalPages) t.status = 'completed';
  else if (t.archived) t.status = 'archived';
  else t.status = 'active';
  return t;
}

// ====== SLASH COMMAND DEFINITION ======
export const definitions = [
  new SlashCommandBuilder().setName('tracker').setDescription('Your personal reading tracker (pages)')
].map(c => c.toJSON());

// ====== SLASH COMMAND EXECUTION ======
export async function execute(interaction) {
  return renderList(interaction, interaction.user);
}

// ====== COMPONENT HANDLER ======
export async function handleComponent(i) {
  // add new tracker
  if (i.isButton() && i.customId === 'trk_add_open') {
    const modal = new ModalBuilder().setCustomId('trk_search_modal').setTitle('Search for a book');
    const input = new TextInputBuilder()
      .setCustomId('trk_search_query')
      .setLabel('Title / author / ISBN')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder('e.g., Of Mice and Men');
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await i.showModal(modal);
    return;
  }

  // search modal submit
  if (i.isModalSubmit() && i.customId === 'trk_search_modal') {
    const q = i.fields.getTextInputValue('trk_search_query').trim();
    const results = await hybridSearchMany(q, 10);
    if (!results.length) return i.reply({ content: `No results for **${q}**.`, ephemeral: true });

    const lines = results.map((b, idx) => `**${idx + 1}.** ${b.title}${b.authors?.length ? ` — ${b.authors.join(', ')}` : ''}`).join('\n');
    const e = new EmbedBuilder().setTitle('Book search results').setColor(0x0ea5e9).setDescription(lines + '\n\nSelect a book below to create a tracker.');

    const opts = results.slice(0, 25).map((b, idx) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(`${b.title}`.slice(0, 100))
        .setValue(String(idx))
        .setDescription((b.authors?.join(', ') || b.source).slice(0, 100))
    );

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('trk_search_select')
        .setPlaceholder('Select a book')
        .setMinValues(1)
        .setMaxValues(1)
        .setOptions(opts)
    );

    // cache results in memory (attached to user session)
    i.client.searchCache = i.client.searchCache || new Map();
    i.client.searchCache.set(i.user.id, results);

    await i.reply({ embeds: [e], components: [row], ephemeral: true });
    return;
  }

  // select search result
  if (i.isStringSelectMenu() && i.customId === 'trk_search_select') {
    const idx = Number(i.values?.[0] || -1);
    const list = i.client.searchCache?.get(i.user.id) || [];
    const book = list[idx];
    if (!book) return i.deferUpdate();

    const modal = new ModalBuilder().setCustomId('trk_create_modal').setTitle('Create a new tracker');
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
      .setPlaceholder(book.pageCount ? String(book.pageCount) : 'e.g., 320');
    modal.addComponents(new ActionRowBuilder().addComponents(page), new ActionRowBuilder().addComponents(total));
    await i.showModal(modal);
    return;
  }

  // create tracker
  if (i.isModalSubmit() && i.customId === 'trk_create_modal') {
    const [book] = i.client.searchCache?.get(i.user.id) || [];
    if (!book) return i.reply({ content: 'Search expired. Try again.', ephemeral: true });

    const page = i.fields.getTextInputValue('trk_page').trim();
    const total = i.fields.getTextInputValue('trk_total').trim();

    const tracked = await getUserTrackers(i.user.id);
    if (tracked.some(t => t.id === book.id && !t.archived)) {
      await i.reply({ content: `You're already tracking **${book.title}**.`, ephemeral: true });
      return;
    }

    const tracker = buildTrackerFromSearch(book, page, total || book.pageCount);
    tracked.unshift(tracker);
    await saveUserTrackers(i.user.id, tracked);
    await appendReadingLog(i.user.id, tracker.id, tracker.currentPage, tracker.updatedAt);

    await i.reply({ content: `Added **${book.title}** — starting at Page ${page}${(total || book.pageCount) ? `/${total || book.pageCount}` : ''}.`, ephemeral: true });
    setTimeout(() => renderList(i, i.user, book.id).catch(() => {}), 800);
    return;
  }

  // open tracker detail
  if (i.isStringSelectMenu() && i.customId === 'trk_select_view') {
    const selectedId = i.values?.[0];
    if (!selectedId) return i.deferUpdate();
    return renderDetail(i, i.user, selectedId);
  }

  // detail buttons
  if (i.isButton() && ['trk_update_open', 'trk_archive', 'trk_delete', 'trk_back'].includes(i.customId)) {
    const all = await getUserTrackers(i.user.id);
    const active = all.find(t => !t.archived);
    const book = active;
    if (!book && i.customId !== 'trk_back') return i.reply({ content: 'Tracker not found.', ephemeral: true });

    if (i.customId === 'trk_back') return renderList(i, i.user);

    if (i.customId === 'trk_update_open') {
      const modal = new ModalBuilder().setCustomId('trk_update_modal').setTitle('Update Tracker');
      const page = new TextInputBuilder().setCustomId('upd_page').setLabel('Current Page *').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(book.currentPage || 0));
      const total = new TextInputBuilder().setCustomId('upd_total').setLabel('Total Pages (optional)').setStyle(TextInputStyle.Short).setRequired(false).setValue(book.totalPages ? String(book.totalPages) : '');
      modal.addComponents(new ActionRowBuilder().addComponents(page), new ActionRowBuilder().addComponents(total));
      await i.showModal(modal);
      return;
    }

    if (i.customId === 'trk_archive') {
      book.archived = true;
      book.status = 'archived';
      book.updatedAt = new Date().toISOString();
      await saveUserTrackers(i.user.id, all);
      await i.reply({ content: `Archived **${book.title}**.`, ephemeral: true });
      return;
    }

    if (i.customId === 'trk_delete') {
      const idx = all.findIndex(t => t.id === book.id);
      if (idx !== -1) all.splice(idx, 1);
      await saveUserTrackers(i.user.id, all);
      await i.reply({ content: `Deleted tracker for **${book.title}**.`, ephemeral: true });
      return;
    }
  }

  // update tracker modal
  if (i.isModalSubmit() && i.customId === 'trk_update_modal') {
    const all = await getUserTrackers(i.user.id);
    const book = all.find(t => !t.archived);
    if (!book) return i.reply({ content: 'Tracker not found.', ephemeral: true });

    const prevPage = Number(book.currentPage || 0);
    const page = i.fields.getTextInputValue('upd_page').trim();
    const total = i.fields.getTextInputValue('upd_total').trim();

    updateTrackerFields(book, page, total === '' ? null : total);
    await saveUserTrackers(i.user.id, all);
    await appendReadingLog(i.user.id, book.id, book.currentPage, book.updatedAt);

    const delta = Number(book.currentPage) - prevPage;
    const note = delta > 0 ? ` (+${delta})` : '';
    await i.reply({ content: `Updated **${book.title}** → Page ${book.currentPage}${book.totalPages ? `/${book.totalPages}` : ''}${note}.`, ephemeral: true });
    return;
  }
}

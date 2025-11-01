// commands/my-stats.js — Bookcord Phase 8
// Shows all active book stats for a user

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { loadJSON, FILES } from '../utils/storage.js';
import { getUserLogs, calcBookStats } from '../utils/analytics.js';

const PURPLE = 0x8b5cf6;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const progressBarPages = (current, total, width = 18) => {
  if (!total || total <= 0) return '▱'.repeat(width);
  const pct = clamp(current / total, 0, 1);
  const filled = Math.round(pct * width);
  return '▰'.repeat(filled) + '▱'.repeat(Math.max(0, width - filled));
};
const fmtTime = d => new Date(d).toLocaleString();

export const definitions = [
  new SlashCommandBuilder().setName('my-stats').setDescription('Show your reading stats for all active books')
].map(c => c.toJSON());

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const trackers = await loadJSON(FILES.TRACKERS);
  const userTrackers = trackers[interaction.user.id]?.tracked?.filter(t => !t.archived) || [];
  if (!userTrackers.length) return interaction.editReply({ content: 'You have no active trackers yet. Use `/tracker` to add one.' });

  const logs = await getUserLogs(interaction.user.id);
  const lines = userTrackers.slice(0, 8).map(t => {
    const s = calcBookStats(logs, t.id);
    const cp = Number(t.currentPage || 0);
    const tp = Number(t.totalPages || 0);
    const pct = tp ? `${Math.round(clamp(cp / tp, 0, 1) * 100)}%` : '—';
    return `• **${t.title}** — ${progressBarPages(cp, tp)} Page ${cp}${tp ? `/${tp}` : ''}\n   📈 avg **${s.avgPerDay.toFixed(1)}**/day • 🔥 **${s.streak}d** • ⏱ ${s.lastAt ? fmtTime(s.lastAt) : '—'}`;
  }).join('\n\n');

  const e = new EmbedBuilder().setTitle('📊 My Reading Stats (Active Books)').setColor(PURPLE).setDescription(lines);
  return interaction.editReply({ embeds: [e] });
}

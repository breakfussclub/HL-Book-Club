// index.js — Bookcord Phase 8 (Modular)
// 🚀 Boots Discord client, registers slash commands, and dispatches to modules
// ✅ JSON data, purple theme, leaderboard ranges supported

import 'dotenv/config';
import {
  Client, GatewayIntentBits, Partials,
  REST, Routes
} from 'discord.js';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

// === ENV ===
const {
  DISCORD_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  PORT
} = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID');
  process.exit(1);
}

// === Keepalive (for Railway) ===
const port = Number(PORT || 0);
if (port) http.createServer((_, res) => res.end('ok')).listen(port, () => console.log(`[http] :${port}`));

// === Import Commands ===
import trackerCommand from './commands/tracker.js';
import bookCommand from './commands/book.js';
import myStatsCommand from './commands/my-stats.js';

// === Ensure Data Folder ===
const DATA_DIR = path.join(process.cwd(), 'data');
await fs.mkdir(DATA_DIR, { recursive: true });

// === Discord Client ===
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User, Partials.GuildMember],
});

// === Slash Command Registry ===
const commands = [
  ...trackerCommand.definitions,
  ...bookCommand.definitions,
  ...myStatsCommand.definitions,
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  console.log(`[register] updating guild ${GUILD_ID}…`);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log(`[register] done.`);
}

// === Startup ===
if (process.argv.includes('--register')) {
  await registerCommands();
  process.exit(0);
}

client.once('ready', async () => {
  console.log(`[ready] ${client.user.tag}`);
  await registerCommands();
});

// === Interaction Routing ===
client.on('interactionCreate', async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;

    switch (interaction.commandName) {
      case 'tracker':
        return trackerCommand.execute(interaction);
      case 'book':
        return bookCommand.execute(interaction);
      case 'my-stats':
        return myStatsCommand.execute(interaction);
      default:
        return;
    }
  } catch (err) {
    console.error('[interaction] error', err);
    if (interaction.deferred || interaction.replied)
      return interaction.editReply({ content: 'Something went wrong. Please try again.' });
    else
      return interaction.reply({ content: 'Something went wrong. Please try again.', ephemeral: true });
  }
});

// === Component Routing ===
client.on('interactionCreate', async (i) => {
  if (!i.isButton() && !i.isModalSubmit() && !i.isStringSelectMenu()) return;

  // delegate to tracker (handles modals/buttons)
  try {
    await trackerCommand.handleComponent(i);
  } catch (err) {
    console.error('[component] error', err);
  }
});

// === Launch ===
client.login(DISCORD_TOKEN);

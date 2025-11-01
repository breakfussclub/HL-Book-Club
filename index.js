// index.js — Bookcord Phase 8 Classic + QoL Merge
// ✅ Keeps full-feature commands (tracker, book, my-stats)
// ✅ Adds auto-registration, keepalive server, structured error handling
// ✅ Ready for Railway or local deployment

import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes
} from 'discord.js';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { ensureDataFiles } from './utils/storage.js';

// === ENV ===
const {
  DISCORD_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  PORT,
  DEBUG
} = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('❌ Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID in .env');
  process.exit(1);
}

// === Keepalive (for Railway / Render) ===
const port = Number(PORT || 0);
if (port) {
  http
    .createServer((_, res) => res.end('ok'))
    .listen(port, () => console.log(`[http] Keepalive listening on :${port}`));
}

// === Ensure data directory exists ===
await ensureDataFiles();

// === Import command modules ===
import * as trackerCommand from './commands/tracker.js';
import * as bookCommand from './commands/book.js';
import * as myStatsCommand from './commands/my-stats.js';

const commands = [
  ...trackerCommand.definitions,
  ...bookCommand.definitions,
  ...myStatsCommand.definitions
];

// === Discord Client ===
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.User,
    Partials.GuildMember
  ]
});

// === Command Registration ===
async function registerCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    console.log(`[register] Updating slash commands for guild ${GUILD_ID}...`);
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log('[register] Slash commands synced successfully.');
  } catch (err) {
    console.error('[register] Failed to register commands:', err);
  }
}

// Allow manual registration via CLI flag
if (process.argv.includes('--register')) {
  await registerCommands();
  process.exit(0);
}

// === Client Ready ===
client.once('ready', async () => {
  console.log(`[ready] Logged in as ${client.user.tag}`);
  await registerCommands();
});

// === Slash Command Routing ===
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    switch (interaction.commandName) {
      case 'tracker':
        return await trackerCommand.execute(interaction);
      case 'book':
        return await bookCommand.execute(interaction);
      case 'my-stats':
        return await myStatsCommand.execute(interaction);
      default:
        return;
    }
  } catch (err) {
    console.error(`[interaction:${interaction.commandName}]`, err);
    const msg = {
      content: '⚠️ Something went wrong. Please try again.',
      ephemeral: true
    };
    if (interaction.deferred || interaction.replied) await interaction.editReply(msg);
    else await interaction.reply(msg);
  }
});

// === Component / Modal / Menu Routing ===
client.on('interactionCreate', async (i) => {
  if (!i.isButton() && !i.isModalSubmit() && !i.isStringSelectMenu()) return;
  try {
    if (trackerCommand.handleComponent) await trackerCommand.handleComponent(i);
    if (DEBUG) console.log(`[component:${i.customId}] by ${i.user.username}`);
  } catch (err) {
    console.error('[component] error', err);
  }
});

// === Launch ===
client.login(DISCORD_TOKEN);

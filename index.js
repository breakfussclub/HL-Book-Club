// index.js — Bookcord Phase 8 (Modular Build)
// ✅ Uses JSON persistence, purple theme, leaderboard ranges
// ✅ Fixed: named imports for command modules (no default export errors)

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

// === ENV ===
const {
  DISCORD_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  PORT
} = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('❌ Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID in .env');
  process.exit(1);
}

// === Keepalive (for Railway) ===
const port = Number(PORT || 0);
if (port) {
  http
    .createServer((_, res) => res.end('ok'))
    .listen(port, () => console.log(`[http] listening on :${port}`));
}

// === Import Command Modules (named imports) ===
import * as trackerCommand from './commands/tracker.js';
import * as bookCommand from './commands/book.js';
import * as myStatsCommand from './commands/my-stats.js';

// === Ensure /data folder exists ===
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
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.User,
    Partials.GuildMember
  ]
});

// === Slash Command Registry ===
const commands = [
  ...trackerCommand.definitions,
  ...bookCommand.definitions,
  ...myStatsCommand.definitions
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  console.log(`[register] updating commands for guild ${GUILD_ID}...`);
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );
  console.log(`[register] done.`);
}

// === Startup ===
if (process.argv.includes('--register')) {
  await registerCommands();
  process.exit(0);
}

client.once('ready', async () => {
  console.log(`[ready] Logged in as ${client.user.tag}`);
  await registerCommands();
});

// === Slash Command Routing ===
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
    const msg = { content: 'Something went wrong. Please try again.', ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.editReply(msg);
    else await interaction.reply(msg);
  }
});

// === Component Routing (buttons, modals, selects) ===
client.on('interactionCreate', async (i) => {
  if (!i.isButton() && !i.isModalSubmit() && !i.isStringSelectMenu()) return;
  try {
    if (trackerCommand.handleComponent) await trackerCommand.handleComponent(i);
  } catch (err) {
    console.error('[component] error', err);
  }
});

// === Launch ===
client.login(DISCORD_TOKEN);

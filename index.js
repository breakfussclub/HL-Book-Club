// index.js — Phase 8 Modernized Core (with registration)
// ✅ Registers slash commands (guild-scoped) on startup
// ✅ Uses flags instead of ephemeral
// ✅ Loads commands dynamically from /commands
// ✅ Hybrid visibility (private/public) via isEphemeral()

import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  REST,
  Routes,
} from "discord.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DEBUG = process.env.DEBUG === "true";
const TOKEN = process.env.DISCORD_TOKEN || process.env.TOKEN; // accept either
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("❌ Missing DISCORD_TOKEN (or TOKEN), CLIENT_ID, or GUILD_ID in env.");
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();

// ---------------------------------------------------------------------------
// Load command modules from /commands
// Each module should export: definitions (array of toJSON()), execute(), and optional handlers
// ---------------------------------------------------------------------------
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith(".js"));

const allDefinitions = [];
for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const mod = await import(`file://${filePath}`);
  if (mod.definitions && mod.execute) {
    // Register by top-level command name(s)
    for (const def of mod.definitions) {
      client.commands.set(def.name, mod);
      allDefinitions.push(def);
    }
  } else if (DEBUG) {
    console.warn(`[index] Skipped ${file} (no definitions/execute)`);
  }
}

if (DEBUG) {
  console.log(
    `[index] Loaded ${client.commands.size} commands: ${[...client.commands.keys()].join(", ")}`
  );
}

// ---------------------------------------------------------------------------
// Guild command registration
// ---------------------------------------------------------------------------
async function registerCommands() {
  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    console.log(`[register] Syncing ${allDefinitions.length} commands to guild ${GUILD_ID}...`);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: allDefinitions,
    });
    console.log("[register] ✅ Guild slash commands updated.");
  } catch (err) {
    console.error("[register] ❌ Failed to register commands:", err);
  }
}

// Allow manual registration via CLI flag
if (process.argv.includes("--register")) {
  await registerCommands();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Hybrid visibility helper
// NOTE: `/tracker` (single command) should be private by default; `/book` is public.
// Adjust to your taste.
// ---------------------------------------------------------------------------
function isEphemeral(commandName) {
  // Private/personal dashboards; public club chatter stays visible
  const privateRoots = new Set(["tracker", "my-stats"]);
  // Subcommand-specific privacy (example: book my-quotes)
  const privatePairs = new Set(["book my-quotes", "book quote"]);

  // When the command has subcommands, Discord gives us only the root name here.
  // We'll keep it simple: tracker + my-stats private; everything else public.
  return privateRoots.has(commandName) || privatePairs.has(commandName);
}

// ---------------------------------------------------------------------------
// Ready
// ---------------------------------------------------------------------------
client.once(Events.ClientReady, async c => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  await registerCommands();
});

// ---------------------------------------------------------------------------
// Interaction handling
// ---------------------------------------------------------------------------
client.on(Events.InteractionCreate, async interaction => {
  try {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) {
        return await interaction.reply({ content: "Unknown command.", flags: 1 << 6 });
      }

      const ephemeral = isEphemeral(interaction.commandName);
      const flags = ephemeral ? 1 << 6 : undefined;

      await interaction.deferReply({ flags });
      await command.execute(interaction);

      if (DEBUG) {
        console.log(
          `[cmd] /${interaction.commandName} by ${interaction.user.username} (${ephemeral ? "private" : "public"})`
        );
      }
      return;
    }

    // Components (buttons, selects)
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
      for (const mod of client.commands.values()) {
        if (mod.handleComponent) await mod.handleComponent(interaction);
      }
      if (DEBUG) console.log(`[component] ${interaction.customId} by ${interaction.user.username}`);
      return;
    }

    // Modal submissions
    if (interaction.isModalSubmit()) {
      for (const mod of client.commands.values()) {
        if (mod.handleModalSubmit) await mod.handleModalSubmit(interaction);
      }
      if (DEBUG) console.log(`[modal] ${interaction.customId} by ${interaction.user.username}`);
      return;
    }
  } catch (err) {
    console.error("[interaction] error:", err);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: "⚠️ Something went wrong.", flags: 1 << 6 });
      } else {
        await interaction.reply({ content: "⚠️ Something went wrong.", flags: 1 << 6 });
      }
    } catch {}
  }
});

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
client.login(TOKEN);

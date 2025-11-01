// index.js — Modal-Safe Version
// ✅ Fixes InteractionAlreadyReplied for /tracker
// ✅ Loads commands dynamically
// ✅ Registers commands automatically on startup
// ✅ Uses flags (no deprecated ephemeral)
// ✅ Hybrid visibility + Railway DEBUG logs

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
const TOKEN = process.env.DISCORD_TOKEN || process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error(
    "❌ Missing DISCORD_TOKEN (or TOKEN), CLIENT_ID, or GUILD_ID in .env"
  );
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
// Load all commands dynamically
// ---------------------------------------------------------------------------
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter((f) => f.endsWith(".js"));
const allDefinitions = [];

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const mod = await import(`file://${filePath}`);
  if (mod.definitions && mod.execute) {
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
    `[index] Loaded ${client.commands.size} commands: ${[
      ...client.commands.keys(),
    ].join(", ")}`
  );
}

// ---------------------------------------------------------------------------
// Register commands (guild-scoped)
// ---------------------------------------------------------------------------
async function registerCommands() {
  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    console.log(`[register] Syncing ${allDefinitions.length} commands...`);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: allDefinitions,
    });
    console.log("✅ Commands registered successfully.");
  } catch (err) {
    console.error("❌ Command registration failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Visibility helper
// ---------------------------------------------------------------------------
function isEphemeral(commandName) {
  const privateRoots = new Set(["tracker", "my-stats"]);
  const privatePairs = new Set(["book my-quotes", "book quote"]);
  return privateRoots.has(commandName) || privatePairs.has(commandName);
}

// ---------------------------------------------------------------------------
// Ready event
// ---------------------------------------------------------------------------
client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  await registerCommands();
});

// ---------------------------------------------------------------------------
// Interaction handler (modal-safe)
// ---------------------------------------------------------------------------
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // Slash command interactions
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) {
        return await interaction.reply({
          content: "Unknown command.",
          flags: 1 << 6,
        });
      }

      const ephemeral = isEphemeral(interaction.commandName);
      const flags = ephemeral ? 1 << 6 : undefined;

      // 🚫 Skip deferReply for modal-based commands (like /tracker)
      if (interaction.commandName === "tracker") {
        await command.execute(interaction);
      } else {
        await interaction.deferReply({ flags });
        await command.execute(interaction);
      }

      if (DEBUG)
        console.log(
          `[cmd] /${interaction.commandName} by ${interaction.user.username}`
        );
      return;
    }

    // Buttons / Select menus
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
      for (const mod of client.commands.values()) {
        if (mod.handleComponent) await mod.handleComponent(interaction);
      }
      if (DEBUG) console.log(`[component] ${interaction.customId}`);
      return;
    }

    // Modal submissions
    if (interaction.isModalSubmit()) {
      for (const mod of client.commands.values()) {
        if (mod.handleModalSubmit) await mod.handleModalSubmit(interaction);
      }
      if (DEBUG) console.log(`[modal] ${interaction.customId}`);
      return;
    }
  } catch (err) {
    console.error("[interaction error]", err);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: "⚠️ Something went wrong.",
          flags: 1 << 6,
        });
      } else {
        await interaction.reply({
          content: "⚠️ Something went wrong.",
          flags: 1 << 6,
        });
      }
    } catch (nested) {
      console.error("[interaction fallback error]", nested);
    }
  }
});

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
client.login(TOKEN);

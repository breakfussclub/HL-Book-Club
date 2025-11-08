// index.js — HL Book Club main bot file (Phase 10)
// ✅ Adds configurable presence via BOT_ACTIVITY env var
// ✅ Keeps full modal + command routing stability
// ✅ Matches Railway deployment compatibility

import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  REST,
  Routes,
  EmbedBuilder,
} from "discord.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadJSON, saveJSON, FILES } from "./utils/storage.js";
import { isEphemeral } from "./utils/commandVisibility.js";

// ---------------------------------------------------------------------------
// ⚙️ Environment + constants
// ---------------------------------------------------------------------------
const DEBUG = process.env.DEBUG === "true";
const TOKEN = process.env.DISCORD_TOKEN || process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const BOT_ACTIVITY = process.env.BOT_ACTIVITY || "Reading: Separation of Church and Hate";

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("❌ Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID in .env");
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
// 📦 Load commands dynamically
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

// ---------------------------------------------------------------------------
// 🧩 Register slash commands
// ---------------------------------------------------------------------------
async function registerCommands() {
  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    console.log(`[register] Registering ${allDefinitions.length} commands...`);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: allDefinitions,
    });
    console.log("✅ Commands registered.");
  } catch (err) {
    console.error("❌ Registration failed:", err);
  }
}

// ---------------------------------------------------------------------------
// 🚀 Ready event — login + presence
// ---------------------------------------------------------------------------
client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);

  // 📖 Dynamic presence from Railway variable
  client.user.setPresence({
    activities: [{ name: BOT_ACTIVITY, type: 0 }], // 0 = "Playing", displays as "Reading: ..."
    status: "online",
  });

  await registerCommands();
});

// ---------------------------------------------------------------------------
// 🎮 Interaction handler
// ---------------------------------------------------------------------------
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // ---------------------------------------------------------------
    // 🎯 Handle “Add to My Tracker” button (from /search embed)
    // ---------------------------------------------------------------
    if (interaction.isButton() && interaction.customId === "trk_add_open") {
      try {
        const embed = interaction.message.embeds?.[0];
        if (!embed)
          return await interaction.reply({
            content: "⚠️ No book data found in this message.",
            flags: 1 << 6,
          });

        const book = {
          id: embed.url || embed.title,
          title: embed.title || "Untitled",
          authors: [],
          pageCount: 0,
          status: "current",
          progress: 0,
          addedAt: new Date().toISOString(),
        };

        const authorsField = embed.fields?.find((f) => f.name === "Authors");
        if (authorsField?.value)
          book.authors = authorsField.value.split(",").map((a) => a.trim());

        const trackers = await loadJSON(FILES.TRACKERS);
        trackers[interaction.user.id] ??= { tracked: [] };
        const userTracker = trackers[interaction.user.id].tracked;

        if (userTracker.some((b) => b.title.toLowerCase() === book.title.toLowerCase()))
          return await interaction.reply({
            content: `⚠️ *${book.title}* is already in your tracker.`,
            flags: 1 << 6,
          });

        userTracker.push(book);
        await saveJSON(FILES.TRACKERS, trackers);

        const confirm = new EmbedBuilder()
          .setTitle("✅ Added to Your Tracker")
          .setDescription(`**${book.title}**`)
          .setColor(0x16a34a);

        await interaction.reply({ embeds: [confirm], flags: 1 << 6 });
        if (DEBUG)
          console.log(`[button] ${interaction.user.username} added "${book.title}"`);
      } catch (err) {
        console.error("[button error]", err);
        await interaction.reply({
          content: "⚠️ Something went wrong adding to your tracker.",
          flags: 1 << 6,
        });
      }
      return;
    }

    // ---------------------------------------------------------------
    // 💬 Slash commands
    // ---------------------------------------------------------------
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command)
        return await interaction.reply({
          content: "Unknown command.",
          flags: 1 << 6,
        });

      const flags = isEphemeral(interaction.commandName) ? 1 << 6 : undefined;

      // ⚙️ Commands that open modals should NOT be deferred
      if (["tracker", "quote"].includes(interaction.commandName)) {
        await command.execute(interaction);
      } else {
        await interaction.deferReply({ flags });
        await command.execute(interaction);
      }

      if (DEBUG)
        console.log(`[cmd] /${interaction.commandName} by ${interaction.user.username}`);
      return;
    }

    // ---------------------------------------------------------------
    // 🧩 Buttons / Select menus
    // ---------------------------------------------------------------
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
      for (const mod of client.commands.values()) {
        if (mod.handleComponent) await mod.handleComponent(interaction);
      }
      if (DEBUG) console.log(`[component] ${interaction.customId}`);
      return;
    }

    // ---------------------------------------------------------------
    // 📝 Modal submissions
    // ---------------------------------------------------------------
    if (interaction.isModalSubmit()) {
      for (const mod of client.commands.values()) {
        if (mod.handleModalSubmit) {
          await mod.handleModalSubmit(interaction);
        } else if (mod.handleComponent) {
          await mod.handleComponent(interaction);
        }
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
// 🔑 Login
// ---------------------------------------------------------------------------
client.login(TOKEN);

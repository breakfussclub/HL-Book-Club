// index.js — Phase 8 Modernized Core
// ✅ Compatible with Discord.js v14.16+
// ✅ Uses flags instead of ephemeral
// ✅ No ensureDataFiles import (auto-created via loadJSON)
// ✅ DEBUG logs for Railway

import {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
} from "discord.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const DEBUG = process.env.DEBUG === "true";
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
// Command Loader
// ---------------------------------------------------------------------------

const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith(".js"));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = await import(`file://${filePath}`);
  if (command.definitions && command.execute) {
    for (const def of command.definitions) {
      client.commands.set(def.name, command);
    }
  }
}

if (DEBUG)
  console.log(
    `[index] Loaded ${client.commands.size} commands: ${[
      ...client.commands.keys(),
    ].join(", ")}`
  );

// ---------------------------------------------------------------------------
// Utility: Determine hybrid visibility (ephemeral vs. public)
// ---------------------------------------------------------------------------

function isEphemeral(commandName) {
  const ephemeralCommands = [
    "tracker",
    "my-stats",
    "book quote",
    "book my-quotes",
  ];
  return ephemeralCommands.some((c) => commandName.startsWith(c));
}

// ---------------------------------------------------------------------------
// Bot Ready
// ---------------------------------------------------------------------------

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
});

// ---------------------------------------------------------------------------
// Interaction Handler
// ---------------------------------------------------------------------------

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // Slash command
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command)
        return await interaction.reply({
          content: "Unknown command.",
          flags: 1 << 6,
        });

      // Hybrid reply logic
      const ephemeral = isEphemeral(interaction.commandName);
      const flags = ephemeral ? 1 << 6 : undefined;

      // Defer to show “thinking...” while executing
      await interaction.deferReply({ flags });

      // Execute command
      await command.execute(interaction);
      return;
    }

    // Component (button, select menu, modal)
    if (interaction.isButton() || interaction.isSelectMenu()) {
      for (const cmd of client.commands.values()) {
        if (cmd.handleComponent)
          await cmd.handleComponent(interaction);
      }
      return;
    }

    // Modal submission
    if (interaction.isModalSubmit()) {
      for (const cmd of client.commands.values()) {
        if (cmd.handleModalSubmit)
          await cmd.handleModalSubmit(interaction);
      }
    }
  } catch (err) {
    console.error("[index.InteractionCreate]", err);
    try {
      if (interaction.deferred || interaction.replied)
        await interaction.editReply({
          content: "⚠️ Something went wrong.",
          flags: 1 << 6,
        });
      else
        await interaction.reply({
          content: "⚠️ Something went wrong.",
          flags: 1 << 6,
        });
    } catch (nested) {
      console.error("[index.errorFallback]", nested);
    }
  }
});

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

client.login(process.env.TOKEN);

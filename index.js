// index.js — HL Book Club (FIXED: Proper defer handling)
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  REST,
  Routes,
} from "discord.js";
import { getConfig } from "./config.js";
import { ensureAllFiles } from "./utils/storage.js";
import { setupGlobalErrorHandlers, safeExecute, safeHandleComponent } from "./utils/errorHandler.js";
import { isEphemeral } from "./utils/commandVisibility.js";
import { logger } from "./utils/logger.js";
import { startBackupScheduler } from "./utils/backup.js";
import { startGoodreadsScheduler } from "./utils/goodreadsScheduler.js";

const config = getConfig();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure data dir exists
try {
  fs.mkdirSync(config.storage.dataDir, { recursive: true });
} catch (err) {
  logger.warn("Failed to ensure data directory", err);
}

// Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});
client.commands = new Collection();

// ─────────────────────────────────────────────────────────────
// COMMAND LOADER
// ─────────────────────────────────────────────────────────────

async function loadCommands() {
  const commandsPath = path.join(__dirname, "commands");
  const commandFiles = fs
    .readdirSync(commandsPath)
    .filter((file) => file.endsWith(".js"));

  const definitions = [];

  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    try {
      const mod = await import(`file://${filePath}`);
      const wrapped = { ...mod };

      if (typeof mod.execute === "function") {
        wrapped.execute = safeExecute(mod.execute);
      }

      if (typeof mod.handleComponent === "function") {
        wrapped.handleComponent = safeHandleComponent(mod.handleComponent);
      }

      if (typeof mod.handleModalSubmit === "function") {
        wrapped.handleModalSubmit = safeHandleComponent(mod.handleModalSubmit);
      }

      if (Array.isArray(mod.definitions)) {
        definitions.push(...mod.definitions);
      }

      const name =
        wrapped.commandName ||
        (mod.definitions?.[0]?.name ?? file.replace(".js", ""));
      client.commands.set(name, wrapped);
      logger.info(`Loaded command module: ${file}`);
    } catch (err) {
      logger.error(`Failed to load command ${file}`, { error: err.message });
    }
  }

  return definitions;
}

// ─────────────────────────────────────────────────────────────
// COMMAND REGISTRATION
// ─────────────────────────────────────────────────────────────

async function registerCommands(definitions) {
  try {
    const rest = new REST({ version: "10" }).setToken(config.discord.token);
    logger.info(
      `Registering ${definitions.length} slash command${definitions.length === 1 ? "" : "s"}`
    );

    await rest.put(
      Routes.applicationGuildCommands(
        config.discord.clientId,
        config.discord.guildId
      ),
      { body: definitions }
    );

    logger.info("✅ Commands registered successfully");
  } catch (error) {
    logger.error("Failed to register commands", { error: error.message });
  }
}

// ─────────────────────────────────────────────────────────────
// INTERACTION HANDLING (FIXED)
// ─────────────────────────────────────────────────────────────

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // Slash command
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      // FIXED: Don't defer here - let commands handle their own deferring
      // Commands that need to defer will do so internally
      return await command.execute(interaction);
    }

    // Buttons / selects
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
      for (const [, mod] of client.commands) {
        if (typeof mod.handleComponent === "function") {
          const handled = await mod.handleComponent(interaction);
          if (handled) return;
        }
      }
    }

    // Modals
    if (interaction.isModalSubmit()) {
      for (const [, mod] of client.commands) {
        if (typeof mod.handleModalSubmit === "function") {
          const handled = await mod.handleModalSubmit(interaction);
          if (handled) return;
        }

        // Fallback: reuse component handler for modals
        if (typeof mod.handleComponent === "function") {
          const handled = await mod.handleComponent(interaction);
          if (handled) return;
        }
      }
    }
  } catch (err) {
    logger.error("Interaction error", { error: err.message });
    
    // FIXED: Proper error response handling
    try {
      if (interaction.deferred) {
        await interaction.editReply({ 
          content: "❌ An error occurred while processing your command." 
        });
      } else if (!interaction.replied) {
        await interaction.reply({ 
          content: "❌ An error occurred while processing your command.",
          flags: 1 << 6 
        });
      }
    } catch (replyError) {
      // Can't reply - just log it
      logger.error("Failed to send error message", { error: replyError.message });
    }
  }
});

// ─────────────────────────────────────────────────────────────
// BOOTSTRAP
// ─────────────────────────────────────────────────────────────

client.once(Events.ClientReady, async () => {
  logger.info(`✅ Logged in as ${client.user.tag}`);
  client.user.setActivity(config.discord.activity || "HL Book Club 📚");
  await ensureAllFiles();
  startBackupScheduler();
  startGoodreadsScheduler(client);
  logger.info("🚀 Bot fully initialized and ready");
});

setupGlobalErrorHandlers();

(async () => {
  const definitions = await loadCommands();
  await registerCommands(definitions);
  await client.login(config.discord.token);
})();

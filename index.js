// index.js — HL Book Club Enhanced Bot
// ✅ Integrated logging, error handling, and backup systems
// ✅ Graceful shutdown and health monitoring
// ✅ Production-ready with proper safety features

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

// ===== Import Enhanced Utilities =====
import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import {
  setupGlobalErrorHandlers,
  handleInteractionError,
  safeExecute,
  safeHandleComponent,
} from "./utils/errorHandler.js";
import { ensureAllFiles } from "./utils/storage.js";
import { startBackupScheduler } from "./utils/backup.js";
import { isEphemeral } from "./utils/commandVisibility.js";

// ===== Setup Global Error Handlers =====
setupGlobalErrorHandlers();

// ===== Constants =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== Initialize Client =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();

// ===== Load Commands =====
async function loadCommands() {
  const commandsPath = path.join(__dirname, "commands");
  const commandFiles = fs
    .readdirSync(commandsPath)
    .filter((f) => f.endsWith(".js"));
  const allDefinitions = [];

  logger.info(`Loading ${commandFiles.length} command modules`);

  for (const file of commandFiles) {
    try {
      const filePath = path.join(commandsPath, file);
      const mod = await import(`file://${filePath}`);

      if (mod.definitions && mod.execute) {
        for (const def of mod.definitions) {
          // Wrap execute in safe handler
          const originalExecute = mod.execute;
          mod.execute = safeExecute(originalExecute);

          // Wrap component handler if exists
          if (mod.handleComponent) {
            const originalHandler = mod.handleComponent;
            mod.handleComponent = safeHandleComponent(originalHandler);
          }

          client.commands.set(def.name, mod);
          allDefinitions.push(def);
        }
        logger.debug(`Loaded command: ${file}`);
      } else {
        logger.warn(`Skipped ${file} - missing definitions or execute`);
      }
    } catch (error) {
      logger.error(`Failed to load command ${file}`, { error: error.message });
    }
  }

  return allDefinitions;
}

// ===== Register Commands =====
async function registerCommands(definitions) {
  try {
    const rest = new REST({ version: "10" }).setToken(config.discord.token);

    logger.info(`Registering ${definitions.length} slash commands`);

    await rest.put(
      Routes.applicationGuildCommands(
        config.discord.clientId,
        config.discord.guildId
      ),
      { body: definitions }
    );

    logger.info("✅ Commands registered successfully");
  } catch (error) {
    logger.error("❌ Command registration failed", { error: error.message });
    throw error;
  }
}

// ===== Bot Ready Event =====
client.once(Events.ClientReady, async (c) => {
  logger.info(`✅ Logged in as ${c.user.tag}`);

  // Set presence
  client.user.setPresence({
    activities: [{ name: config.discord.activity, type: 0 }],
    status: "online",
  });

  try {
    // Initialize data files
    await ensureAllFiles();

    // Load and register commands
    const definitions = await loadCommands();
    await registerCommands(definitions);

    // Start backup scheduler
    startBackupScheduler();

    logger.info("🚀 Bot fully initialized and ready");
  } catch (error) {
    logger.error("❌ Initialization failed", { error: error.message });
    process.exit(1);
  }
});

// ===== Interaction Handler =====
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // ===== Slash Commands =====
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);

      if (!command) {
        logger.warn("Unknown command", { command: interaction.commandName });
        return await interaction.reply({
          content: "⚠️ Unknown command.",
          flags: 1 << 6,
        });
      }

      // Log command execution
      logger.logCommand(interaction);

      // Determine visibility
      const flags = isEphemeral(interaction.commandName) ? 1 << 6 : undefined;

      // Commands that open modals should NOT be deferred
      const noDefer = ["tracker", "quote"];
      if (!noDefer.includes(interaction.commandName)) {
        await interaction.deferReply({ flags });
      }

      // Execute command (already wrapped in safeExecute)
      await command.execute(interaction);
      return;
    }

    // ===== Buttons & Select Menus =====
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
      logger.logComponent(interaction);

      // Special handling for "Add to Tracker" button
      if (interaction.isButton() && interaction.customId === "trk_add_open") {
        const trackerModule = client.commands.get("tracker");
        if (trackerModule?.handleComponent) {
          await trackerModule.handleComponent(interaction);
        }
        return;
      }

      // Route to appropriate command handler
      for (const mod of client.commands.values()) {
        if (mod.handleComponent) {
          await mod.handleComponent(interaction);
        }
      }
      return;
    }

    // ===== Modal Submissions =====
    if (interaction.isModalSubmit()) {
      logger.logComponent(interaction, { type: "modal" });

      for (const mod of client.commands.values()) {
        if (mod.handleModalSubmit) {
          await mod.handleModalSubmit(interaction);
        } else if (mod.handleComponent) {
          await mod.handleComponent(interaction);
        }
      }
      return;
    }
  } catch (error) {
    await handleInteractionError(interaction, error);
  }
});

// ===== Discord Client Error Handling =====
client.on(Events.Error, (error) => {
  logger.error("Discord client error", { error: error.message });
});

client.on(Events.Warn, (warning) => {
  logger.warn("Discord client warning", { warning });
});

// ===== Graceful Shutdown =====
async function gracefulShutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully`);

  try {
    // Stop accepting new interactions
    client.removeAllListeners(Events.InteractionCreate);

    // Destroy Discord client
    client.destroy();

    // Close logger
    await logger.close();

    logger.info("Shutdown complete");
    process.exit(0);
  } catch (error) {
    logger.error("Error during shutdown", { error: error.message });
    process.exit(1);
  }
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// ===== Health Check Endpoint (Optional) =====
// Useful for container orchestration platforms
if (process.env.HEALTH_CHECK_PORT) {
  import("http").then(({ createServer }) => {
    const port = parseInt(process.env.HEALTH_CHECK_PORT);

    createServer((req, res) => {
      if (req.url === "/health") {
        const healthy = client.isReady();
        res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: healthy ? "healthy" : "unhealthy",
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
          })
        );
      } else {
        res.writeHead(404);
        res.end();
      }
    }).listen(port, () => {
      logger.info(`Health check endpoint listening on port ${port}`);
    });
  });
}

// ===== Login =====
client
  .login(config.discord.token)
  .then(() => {
    logger.info("Discord login successful");
  })
  .catch((error) => {
    logger.error("❌ Discord login failed", { error: error.message });
    process.exit(1);
  });

// ===== Metrics Tracking (Optional) =====
setInterval(() => {
  if (client.isReady()) {
    logger.debug("Bot metrics", {
      guilds: client.guilds.cache.size,
      users: client.users.cache.size,
      uptime: Math.floor(process.uptime()),
      memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    });
  }
}, 300000); // Every 5 minutes

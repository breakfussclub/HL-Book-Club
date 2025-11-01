import { REST, Routes } from "discord.js";
import "dotenv/config";

const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID; // optional — only needed for per-guild clearing
const token = process.env.DISCORD_TOKEN;

if (!clientId || !token) {
  console.error("❌ Missing CLIENT_ID or DISCORD_TOKEN in environment variables.");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  try {
    console.log("🚨 Starting command deregistration...");

    if (guildId) {
      // Deregister all guild-specific commands
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] });
      console.log(`✅ Successfully cleared all guild commands for guild ${guildId}`);
    } else {
      // Deregister all global commands
      await rest.put(Routes.applicationCommands(clientId), { body: [] });
      console.log("✅ Successfully cleared all global commands.");
    }

    console.log("🧹 Command cleanup complete!");
  } catch (error) {
    console.error("❗ Error clearing commands:", error);
  }
})();

import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { validateGoodreadsUser, syncUserGoodreads } from "../utils/goodreadsSync.js";
import { loadJSON, saveJSON, FILES } from "../utils/storage.js";
import { logger } from "../utils/logger.js";

const SUCCESS_GREEN = 0x2ecc71;
const INFO_BLUE = 0x3498db;

export const definitions = [
  new SlashCommandBuilder()
    .setName("goodreads")
    .setDescription("Manage your Goodreads integration")
    .addSubcommand((sub) =>
      sub.setName("link").setDescription("Link your Goodreads account")
        .addStringOption((opt) => opt.setName("username").setDescription("Your Goodreads username").setRequired(true))
    )
    .addSubcommand((sub) => sub.setName("sync").setDescription("Sync your Goodreads books"))
].map((c) => c.toJSON());

export async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "link") {
    await interaction.deferReply({ flags: 1 << 6 });
    const username = interaction.options.getString("username");
    const validation = await validateGoodreadsUser(username);
    
    if (!validation.valid) {
      return interaction.editReply({ content: `❌ Error: ${validation.error}` });
    }

    const links = await loadJSON(FILES.GOODREADS_LINKS, {});
    links[interaction.user.id] = {
      discordUserId: interaction.user.id,
      goodreadsUserId: validation.userId,
      username: validation.username,
      linkedAt: new Date().toISOString(),
    };
    await saveJSON(FILES.GOODREADS_LINKS, links);

    return interaction.editReply({ content: `✅ Linked to ${validation.username}` });
  }

  if (subcommand === "sync") {
    await interaction.deferReply({ flags: 1 << 6 });
    
    const result = await syncUserGoodreads(interaction.user.id);
    
    if (!result.success) {
      return interaction.editReply({ content: `❌ Sync failed: ${result.error}` });
    }

    return interaction.editReply({ 
      content: `✅ Sync complete! New books: ${result.newBooks}, Total: ${result.totalBooks}` 
    });
  }
}

export const commandName = "goodreads";

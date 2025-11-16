// commands/goodreads.js — Goodreads Integration
// ✅ Link/unlink Goodreads profiles for automatic sync
// ✅ Manual sync trigger for immediate updates
// ✅ View linked profile status

import {
  SlashCommandBuilder,
  EmbedBuilder,
} from "discord.js";
import { loadJSON, saveJSON, FILES } from "../utils/storage.js";
import { validateGoodreadsUser } from "../utils/goodreadsSync.js";
import { getConfig } from "../config.js";

const config = getConfig();

export const definitions = [
  new SlashCommandBuilder()
    .setName("goodreads")
    .setDescription("Manage Goodreads integration")
    .addSubcommand((sub) =>
      sub
        .setName("link")
        .setDescription("Link your Goodreads profile for automatic sync")
        .addStringOption((opt) =>
          opt
            .setName("username")
            .setDescription("Your Goodreads username or user ID")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("unlink")
        .setDescription("Unlink your Goodreads profile")
    )
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("Check your Goodreads link status")
    )
    .addSubcommand((sub) =>
      sub
        .setName("sync")
        .setDescription("Manually sync your Goodreads shelf now")
    ),
].map((c) => c.toJSON());

export async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "link") {
    return await handleLink(interaction);
  } else if (subcommand === "unlink") {
    return await handleUnlink(interaction);
  } else if (subcommand === "status") {
    return await handleStatus(interaction);
  } else if (subcommand === "sync") {
    return await handleSync(interaction);
  }
}

// ─────────────────────────────────────────────────────────────
//   LINK GOODREADS PROFILE
// ─────────────────────────────────────────────────────────────

async function handleLink(interaction) {
  try {
    const username = interaction.options.getString("username").trim();
    
    // Validate and get user info from Goodreads
    const validationResult = await validateGoodreadsUser(username);
    
    if (!validationResult.valid) {
      return await interaction.editReply({
        content: `⚠️ ${validationResult.error}`,
      });
    }

    // Load existing links
    const links = await loadJSON(FILES.GOODREADS_LINKS, {});
    
    // Store the link
    links[interaction.user.id] = {
      userId: validationResult.userId,
      username: validationResult.username,
      rssUrl: validationResult.rssUrl,
      linkedAt: new Date().toISOString(),
      lastSync: null,
      lastSyncBooks: [],
    };

    await saveJSON(FILES.GOODREADS_LINKS, links);

    const embed = new EmbedBuilder()
      .setColor(config.colors.success)
      .setTitle("✅ Goodreads Linked")
      .setDescription(
        `Successfully linked to **${validationResult.username}**!\n\n` +
        `Your "Read" shelf will now sync automatically every ${config.goodreads.pollIntervalMinutes} minutes.\n\n` +
        `Use \`/goodreads sync\` to trigger an immediate sync.`
      )
      .setFooter({ text: `User ID: ${validationResult.userId}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("[goodreads.link]", error);
    await interaction.editReply({
      content: "⚠️ Failed to link Goodreads profile. Please try again.",
    });
  }
}

// ─────────────────────────────────────────────────────────────
//   UNLINK GOODREADS PROFILE
// ─────────────────────────────────────────────────────────────

async function handleUnlink(interaction) {
  try {
    const links = await loadJSON(FILES.GOODREADS_LINKS, {});
    
    if (!links[interaction.user.id]) {
      return await interaction.editReply({
        content: "⚠️ You don't have a linked Goodreads profile.",
      });
    }

    const username = links[interaction.user.id].username;
    delete links[interaction.user.id];
    
    await saveJSON(FILES.GOODREADS_LINKS, links);

    const embed = new EmbedBuilder()
      .setColor(config.colors.warning)
      .setTitle("🔗 Goodreads Unlinked")
      .setDescription(
        `Successfully unlinked from **${username}**.\n\n` +
        `Your Goodreads shelf will no longer sync automatically.`
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("[goodreads.unlink]", error);
    await interaction.editReply({
      content: "⚠️ Failed to unlink Goodreads profile. Please try again.",
    });
  }
}

// ─────────────────────────────────────────────────────────────
//   CHECK LINK STATUS
// ─────────────────────────────────────────────────────────────

async function handleStatus(interaction) {
  try {
    const links = await loadJSON(FILES.GOODREADS_LINKS, {});
    const userLink = links[interaction.user.id];
    
    if (!userLink) {
      return await interaction.editReply({
        content: "⚠️ You don't have a linked Goodreads profile.\n\nUse `/goodreads link` to connect your account.",
      });
    }

    const lastSyncTime = userLink.lastSync 
      ? `<t:${Math.floor(new Date(userLink.lastSync).getTime() / 1000)}:R>`
      : "Never";
    
    const bookCount = userLink.lastSyncBooks?.length || 0;

    const embed = new EmbedBuilder()
      .setColor(config.colors.info)
      .setTitle("📚 Goodreads Link Status")
      .addFields(
        { name: "Username", value: userLink.username, inline: true },
        { name: "User ID", value: userLink.userId, inline: true },
        { name: "Linked Since", value: `<t:${Math.floor(new Date(userLink.linkedAt).getTime() / 1000)}:D>`, inline: true },
        { name: "Last Sync", value: lastSyncTime, inline: true },
        { name: "Books Tracked", value: `${bookCount} books`, inline: true },
        { name: "Auto-Sync", value: `Every ${config.goodreads.pollIntervalMinutes} min`, inline: true }
      )
      .setFooter({ text: "Use /goodreads sync to manually sync now" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("[goodreads.status]", error);
    await interaction.editReply({
      content: "⚠️ Failed to check status. Please try again.",
    });
  }
}

// ─────────────────────────────────────────────────────────────
//   MANUAL SYNC
// ─────────────────────────────────────────────────────────────

async function handleSync(interaction) {
  try {
    const links = await loadJSON(FILES.GOODREADS_LINKS, {});
    const userLink = links[interaction.user.id];
    
    if (!userLink) {
      return await interaction.editReply({
        content: "⚠️ You don't have a linked Goodreads profile.\n\nUse `/goodreads link` to connect your account.",
      });
    }

    // Import sync function (avoid circular dependency)
    const { syncUserGoodreads } = await import("../utils/goodreadsSync.js");
    
    await interaction.editReply({
      content: "🔄 Syncing your Goodreads shelf...",
    });

    const result = await syncUserGoodreads(interaction.user.id, interaction.client);
    
    if (!result.success) {
      return await interaction.editReply({
        content: `⚠️ Sync failed: ${result.error}`,
      });
    }

    const embed = new EmbedBuilder()
      .setColor(config.colors.success)
      .setTitle("✅ Sync Complete")
      .setDescription(
        `Successfully synced with **${userLink.username}**'s Goodreads shelf.`
      )
      .addFields(
        { name: "New Books Found", value: `${result.newBooks || 0}`, inline: true },
        { name: "Total Books Tracked", value: `${result.totalBooks || 0}`, inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed], content: null });
  } catch (error) {
    console.error("[goodreads.sync]", error);
    await interaction.editReply({
      content: "⚠️ Sync failed. Please try again later.",
    });
  }
}

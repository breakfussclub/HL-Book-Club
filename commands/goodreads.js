// commands/goodreads.js — Goodreads Integration Commands (Full Version)
// ✅ Link/unlink Goodreads accounts
// ✅ Manual sync trigger
// ✅ View sync status
// ✅ Multi-shelf support
// ✅ Improved error messages with actionable guidance

import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import {
  validateGoodreadsUser,
  syncUserGoodreads,
} from "../utils/goodreadsSync.js";
import { loadJSON, saveJSON, FILES } from "../utils/storage.js";
import { logger } from "../utils/logger.js";

const PURPLE = 0x9b59b6;
const ERROR_RED = 0xe74c3c;
const SUCCESS_GREEN = 0x2ecc71;
const INFO_BLUE = 0x3498db;

export const definitions = [
  new SlashCommandBuilder()
    .setName("goodreads")
    .setDescription("Manage your Goodreads integration")
    .addSubcommand((sub) =>
      sub
        .setName("link")
        .setDescription("Link your Goodreads account")
        .addStringOption((opt) =>
          opt
            .setName("username")
            .setDescription("Your Goodreads username or user ID")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("unlink").setDescription("Unlink your Goodreads account")
    )
    .addSubcommand((sub) =>
      sub.setName("sync").setDescription("Manually sync your Goodreads books")
    )
    .addSubcommand((sub) =>
      sub.setName("status").setDescription("View your Goodreads sync status")
    ),
].map((c) => c.toJSON());

export async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "link") {
    await handleLink(interaction);
  } else if (subcommand === "unlink") {
    await handleUnlink(interaction);
  } else if (subcommand === "sync") {
    await handleSync(interaction);
  } else if (subcommand === "status") {
    await handleStatus(interaction);
  }
}

// ─────────────────────────────────────────────────────────────
//   LINK COMMAND
// ─────────────────────────────────────────────────────────────

async function handleLink(interaction) {
  await interaction.deferReply({ flags: 1 << 6 });

  const username = interaction.options.getString("username");
  
  const validation = await validateGoodreadsUser(username);

  if (!validation.valid) {
    const embed = new EmbedBuilder()
      .setColor(ERROR_RED)
      .setTitle("❌ Could Not Link Goodreads Account");

    if (validation.error.includes("404") || validation.error.includes("not found")) {
      embed.setDescription(
        `**User not found:** \`${username}\`\n\n` +
        "**Common issues:**\n" +
        "• Double-check your Goodreads username/ID for typos\n" +
        "• Make sure you're using your username, not display name\n" +
        "• Try using your numeric user ID instead (found in your profile URL)\n\n" +
        "**Example:** `goodreads.com/user/show/12345678-username` → Use `12345678`"
      );
    } else if (validation.error.includes("public")) {
      embed.setDescription(
        "**Your Goodreads profile is private.**\n\n" +
        "To sync with Discord, you need to make your profile public:\n\n" +
        "1. Go to [Goodreads Settings](https://www.goodreads.com/user/edit)\n" +
        "2. Click **Privacy Settings**\n" +
        "3. Set your profile to **Public**\n" +
        "4. Save changes and try linking again"
      );
    } else {
      embed.setDescription(
        `**Error:** ${validation.error}\n\n` +
        "**Troubleshooting tips:**\n" +
        "• Check your internet connection\n" +
        "• Wait a moment and try again\n" +
        "• Contact server admin if issue persists"
      );
    }

    return interaction.editReply({ embeds: [embed] });
  }

  const links = await loadJSON(FILES.GOODREADS_LINKS, {});
  links[interaction.user.id] = {
    discordUserId: interaction.user.id,
    goodreadsUserId: validation.userId,
    username: validation.username,
    rssUrl: validation.rssUrl,
    linkedAt: new Date().toISOString(),
    lastSync: null,
    lastSyncBooks: [],
  };
  await saveJSON(FILES.GOODREADS_LINKS, links);

  const embed = new EmbedBuilder()
    .setColor(SUCCESS_GREEN)
    .setTitle("✅ Goodreads Account Linked!")
    .setDescription(
      `Successfully linked to **${validation.username}**\n\n` +
      "Your books will sync automatically every 30 minutes.\n" +
      "Use `/goodreads sync` to sync immediately.\n\n" +
      "**What gets synced:**\n" +
      "📚 To-Read shelf → Planned books\n" +
      "📖 Currently Reading → Active reading\n" +
      "✅ Read shelf → Completed books"
    )
    .setFooter({ text: "Use /goodreads status to view sync info" });

  await interaction.editReply({ embeds: [embed] });

  logger.info("Goodreads linked", {
    discordUserId: interaction.user.id,
    goodreadsUser: validation.username,
  });
}

// ─────────────────────────────────────────────────────────────
//   UNLINK COMMAND
// ─────────────────────────────────────────────────────────────

async function handleUnlink(interaction) {
  await interaction.deferReply({ flags: 1 << 6 });

  const links = await loadJSON(FILES.GOODREADS_LINKS, {});

  if (!links[interaction.user.id]) {
    const embed = new EmbedBuilder()
      .setColor(INFO_BLUE)
      .setTitle("ℹ️ No Goodreads Account Linked")
      .setDescription(
        "You don't have a Goodreads account linked.\n\n" +
        "Use `/goodreads link [username]` to connect your account."
      );

    return interaction.editReply({ embeds: [embed] });
  }

  const username = links[interaction.user.id].username;
  delete links[interaction.user.id];
  await saveJSON(FILES.GOODREADS_LINKS, links);

  const embed = new EmbedBuilder()
    .setColor(SUCCESS_GREEN)
    .setTitle("✅ Goodreads Account Unlinked")
    .setDescription(
      `Successfully unlinked from **${username}**\n\n` +
      "Your existing synced books will remain in your tracker.\n" +
      "Automatic syncing has been stopped.\n\n" +
      "You can re-link anytime with `/goodreads link`."
    );

  await interaction.editReply({ embeds: [embed] });

  logger.info("Goodreads unlinked", {
    discordUserId: interaction.user.id,
    goodreadsUser: username,
  });
}

// ─────────────────────────────────────────────────────────────
//   SYNC COMMAND
// ─────────────────────────────────────────────────────────────

async function handleSync(interaction) {
  await interaction.deferReply({ flags: 1 << 6 });

  const links = await loadJSON(FILES.GOODREADS_LINKS, {});

  if (!links[interaction.user.id]) {
    const embed = new EmbedBuilder()
      .setColor(INFO_BLUE)
      .setTitle("ℹ️ No Goodreads Account Linked")
      .setDescription(
        "You need to link your Goodreads account first.\n\n" +
        "Use `/goodreads link [username]` to get started."
      );

    return interaction.editReply({ embeds: [embed] });
  }

  const result = await syncUserGoodreads(
    interaction.user.id,
    interaction.client
  );

  if (!result.success) {
    const embed = new EmbedBuilder()
      .setColor(ERROR_RED)
      .setTitle("❌ Sync Failed");

    if (result.error.includes("404")) {
      embed.setDescription(
        "**Your Goodreads profile could not be found.**\n\n" +
        "This might mean:\n" +
        "• Your profile was deleted or made private\n" +
        "• Your username changed on Goodreads\n\n" +
        "Try unlinking and re-linking your account:\n" +
        "`/goodreads unlink` → `/goodreads link [username]`"
      );
    } else if (result.error.includes("timeout") || result.error.includes("ECONNREFUSED")) {
      embed.setDescription(
        "**Connection timed out.**\n\n" +
        "Goodreads might be temporarily unavailable.\n" +
        "Please wait a few minutes and try again.\n\n" +
        "If this persists, check [Goodreads Status](https://www.goodreads.com)"
      );
    } else {
      embed.setDescription(
        `**Error:** ${result.error}\n\n` +
        "Try again in a moment. If this continues, contact a server admin."
      );
    }

    return interaction.editReply({ embeds: [embed] });
  }

  const embed = new EmbedBuilder()
    .setColor(result.newBooks > 0 ? SUCCESS_GREEN : INFO_BLUE)
    .setTitle(
      result.newBooks > 0
        ? `✅ Synced ${result.newBooks} New Book${result.newBooks === 1 ? "" : "s"}!`
        : "✅ Sync Complete"
    );

  if (result.newBooks > 0) {
    embed.setDescription(
      `Added **${result.newBooks}** new book${result.newBooks === 1 ? "" : "s"} to your tracker!\n\n` +
      `**Total Goodreads books:** ${result.totalBooks}\n\n` +
      "Check `/tracker` to see your synced books."
    );
  } else {
    embed.setDescription(
      "**No new books found.**\n\n" +
      `All ${result.totalBooks} book${result.totalBooks === 1 ? "" : "s"} from your Goodreads shelves are already synced.\n\n` +
      "Add books to your Goodreads shelves and sync again!"
    );
  }

  if (result.shelves) {
    const shelfStats = Object.entries(result.shelves)
      .map(([shelf, data]) => {
        const emoji = shelf === "read" ? "✅" : shelf === "currently-reading" ? "📖" : "📚";
        return `${emoji} **${shelf}**: ${data.count || 0} books`;
      })
      .join("\n");
    
    embed.addFields({ name: "Shelf Breakdown", value: shelfStats });
  }

  await interaction.editReply({ embeds: [embed] });
}

// ─────────────────────────────────────────────────────────────
//   STATUS COMMAND
// ─────────────────────────────────────────────────────────────

async function handleStatus(interaction) {
  await interaction.deferReply({ flags: 1 << 6 });

  const links = await loadJSON(FILES.GOODREADS_LINKS, {});

  if (!links[interaction.user.id]) {
    const embed = new EmbedBuilder()
      .setColor(INFO_BLUE)
      .setTitle("ℹ️ No Goodreads Account Linked")
      .setDescription(
        "You haven't linked a Goodreads account yet.\n\n" +
        "**Get started:**\n" +
        "Use `/goodreads link [username]` to sync your reading list!"
      );

    return interaction.editReply({ embeds: [embed] });
  }

  const link = links[interaction.user.id];
  const lastSync = link.lastSync
    ? new Date(link.lastSync).toLocaleString()
    : "Never";
  const bookCount = link.lastSyncBooks?.length || 0;

  const embed = new EmbedBuilder()
    .setColor(PURPLE)
    .setTitle("📊 Goodreads Sync Status")
    .setDescription(
      `**Linked Account:** ${link.username}\n` +
      `**Last Sync:** ${lastSync}\n` +
      `**Total Books Synced:** ${bookCount}`
    )
    .addFields(
      {
        name: "🔄 Automatic Sync",
        value: "Runs every 30 minutes",
        inline: true,
      },
      {
        name: "⚡ Manual Sync",
        value: "Use `/goodreads sync`",
        inline: true,
      }
    )
    .setFooter({ text: "Use /goodreads unlink to disconnect" });

  if (link.syncResults) {
    const shelfInfo = Object.entries(link.syncResults)
      .map(([shelf, data]) => {
        const emoji = shelf === "read" ? "✅" : shelf === "currently-reading" ? "📖" : "📚";
        const status = data.success ? `${data.count || 0} books` : "⚠️ Error";
        return `${emoji} **${shelf}**: ${status}`;
      })
      .join("\n");
    
    embed.addFields({ name: "Synced Shelves", value: shelfInfo });
  }

  await interaction.editReply({ embeds: [embed] });
}

export const commandName = "goodreads";

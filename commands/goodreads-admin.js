// commands/goodreads-admin.js — Goodreads Admin Dashboard
// ✅ View all linked users
// ✅ Force sync specific users
// ✅ View sync statistics
// ✅ Clear problematic links
// ✅ Admin-only access control

import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { syncUserGoodreads } from "../utils/goodreadsSync.js";
import { loadJSON, saveJSON, FILES } from "../utils/storage.js";
import { logger } from "../utils/logger.js";

const PURPLE = 0x9b59b6;
const ERROR_RED = 0xe74c3c;
const SUCCESS_GREEN = 0x2ecc71;
const WARNING_ORANGE = 0xf39c12;

export const definitions = [
  new SlashCommandBuilder()
    .setName("goodreads-admin")
    .setDescription("Admin tools for managing Goodreads integration")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("View all linked Goodreads accounts")
    )
    .addSubcommand((sub) =>
      sub
        .setName("sync-user")
        .setDescription("Force sync a specific user")
        .addUserOption((opt) =>
          opt
            .setName("user")
            .setDescription("The Discord user to sync")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("stats").setDescription("View Goodreads sync statistics")
    )
    .addSubcommand((sub) =>
      sub
        .setName("unlink-user")
        .setDescription("Unlink a user's Goodreads account (admin only)")
        .addUserOption((opt) =>
          opt
            .setName("user")
            .setDescription("The Discord user to unlink")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("sync-all")
        .setDescription("Force sync all linked users (use carefully)")
    ),
].map((c) => c.toJSON());

export async function execute(interaction) {
  // Double-check admin permissions
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    const embed = new EmbedBuilder()
      .setColor(ERROR_RED)
      .setTitle("❌ Access Denied")
      .setDescription("This command is only available to administrators.");

    return interaction.reply({ embeds: [embed], flags: 1 << 6 });
  }

  const subcommand = interaction.options.getSubcommand();

  try {
    if (subcommand === "list") {
      await handleList(interaction);
    } else if (subcommand === "sync-user") {
      await handleSyncUser(interaction);
    } else if (subcommand === "stats") {
      await handleStats(interaction);
    } else if (subcommand === "unlink-user") {
      await handleUnlinkUser(interaction);
    } else if (subcommand === "sync-all") {
      await handleSyncAll(interaction);
    }
  } catch (error) {
    logger.error("Goodreads admin command error", {
      subcommand,
      error: error.message,
    });

    const embed = new EmbedBuilder()
      .setColor(ERROR_RED)
      .setTitle("❌ Command Error")
      .setDescription(
        `Failed to execute \`${subcommand}\`.\n\n` +
        `**Error:** ${error.message}`
      );

    const reply = { embeds: [embed], flags: 1 << 6 };

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(reply);
    } else {
      await interaction.reply(reply);
    }
  }
}

// ─────────────────────────────────────────────────────────────
//   LIST ALL LINKED USERS
// ─────────────────────────────────────────────────────────────

async function handleList(interaction) {
  await interaction.deferReply({ flags: 1 << 6 });

  const links = await loadJSON(FILES.GOODREADS_LINKS, {});
  const userIds = Object.keys(links);

  if (userIds.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(PURPLE)
      .setTitle("📚 Linked Goodreads Accounts")
      .setDescription("No users have linked their Goodreads accounts yet.");

    return interaction.editReply({ embeds: [embed] });
  }

  // Fetch Discord user info
  const userList = await Promise.all(
    userIds.map(async (userId) => {
      try {
        const user = await interaction.client.users.fetch(userId);
        const link = links[userId];
        const lastSync = link.lastSync
          ? new Date(link.lastSync).toLocaleString()
          : "Never";
        const bookCount = link.lastSyncBooks?.length || 0;

        return {
          discord: user.username,
          goodreads: link.username,
          lastSync,
          bookCount,
          userId,
        };
      } catch (error) {
        return {
          discord: `Unknown (${userId})`,
          goodreads: links[userId].username,
          lastSync: "N/A",
          bookCount: 0,
          userId,
        };
      }
    })
  );

  // Format as list
  const description = userList
    .map(
      (u, i) =>
        `**${i + 1}.** ${u.discord}\n` +
        `   └ Goodreads: **${u.goodreads}**\n` +
        `   └ Last Sync: ${u.lastSync}\n` +
        `   └ Books: ${u.bookCount}`
    )
    .join("\n\n");

  const embed = new EmbedBuilder()
    .setColor(PURPLE)
    .setTitle("📚 Linked Goodreads Accounts")
    .setDescription(description)
    .setFooter({ text: `Total: ${userIds.length} user(s)` });

  await interaction.editReply({ embeds: [embed] });
}

// ─────────────────────────────────────────────────────────────
//   FORCE SYNC SPECIFIC USER
// ─────────────────────────────────────────────────────────────

async function handleSyncUser(interaction) {
  await interaction.deferReply({ flags: 1 << 6 });

  const targetUser = interaction.options.getUser("user");
  const links = await loadJSON(FILES.GOODREADS_LINKS, {});

  if (!links[targetUser.id]) {
    const embed = new EmbedBuilder()
      .setColor(ERROR_RED)
      .setTitle("❌ User Not Linked")
      .setDescription(
        `**${targetUser.username}** hasn't linked a Goodreads account.`
      );

    return interaction.editReply({ embeds: [embed] });
  }

  // Perform sync
  const result = await syncUserGoodreads(targetUser.id, interaction.client);

  if (!result.success) {
    const embed = new EmbedBuilder()
      .setColor(ERROR_RED)
      .setTitle("❌ Sync Failed")
      .setDescription(
        `Failed to sync **${targetUser.username}**\n\n` +
        `**Error:** ${result.error}\n\n` +
        `**Linked account:** ${links[targetUser.id].username}`
      );

    return interaction.editReply({ embeds: [embed] });
  }

  // Success
  const embed = new EmbedBuilder()
    .setColor(SUCCESS_GREEN)
    .setTitle("✅ User Synced Successfully")
    .setDescription(
      `Synced **${targetUser.username}**\n\n` +
      `**New Books:** ${result.newBooks}\n` +
      `**Total Books:** ${result.totalBooks}\n` +
      `**Goodreads Account:** ${links[targetUser.id].username}`
    );

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

  logger.info("Admin forced sync", {
    admin: interaction.user.id,
    target: targetUser.id,
    result: result.success,
  });
}

// ─────────────────────────────────────────────────────────────
//   VIEW SYNC STATISTICS
// ─────────────────────────────────────────────────────────────

async function handleStats(interaction) {
  await interaction.deferReply({ flags: 1 << 6 });

  const links = await loadJSON(FILES.GOODREADS_LINKS, {});
  const userIds = Object.keys(links);

  if (userIds.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(PURPLE)
      .setTitle("📊 Goodreads Statistics")
      .setDescription("No users have linked their Goodreads accounts yet.");

    return interaction.editReply({ embeds: [embed] });
  }

  // Calculate statistics
  let totalBooks = 0;
  let syncedCount = 0;
  let neverSyncedCount = 0;
  let recentSyncs = 0;
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;

  for (const userId in links) {
    const link = links[userId];
    totalBooks += link.lastSyncBooks?.length || 0;

    if (link.lastSync) {
      syncedCount++;
      const syncTime = new Date(link.lastSync).getTime();
      if (syncTime > oneHourAgo) recentSyncs++;
    } else {
      neverSyncedCount++;
    }
  }

  const avgBooksPerUser = userIds.length > 0 ? (totalBooks / userIds.length).toFixed(1) : 0;

  const embed = new EmbedBuilder()
    .setColor(PURPLE)
    .setTitle("📊 Goodreads Sync Statistics")
    .addFields(
      { name: "👥 Total Linked Users", value: String(userIds.length), inline: true },
      { name: "📚 Total Books Synced", value: String(totalBooks), inline: true },
      { name: "📖 Avg Books/User", value: String(avgBooksPerUser), inline: true },
      { name: "✅ Users With Syncs", value: String(syncedCount), inline: true },
      { name: "⏳ Never Synced", value: String(neverSyncedCount), inline: true },
      { name: "🕐 Synced (Last Hour)", value: String(recentSyncs), inline: true }
    )
    .setFooter({ text: "Use /goodreads-admin list to see individual users" });

  await interaction.editReply({ embeds: [embed] });
}

// ─────────────────────────────────────────────────────────────
//   UNLINK A USER (ADMIN ACTION)
// ─────────────────────────────────────────────────────────────

async function handleUnlinkUser(interaction) {
  await interaction.deferReply({ flags: 1 << 6 });

  const targetUser = interaction.options.getUser("user");
  const links = await loadJSON(FILES.GOODREADS_LINKS, {});

  if (!links[targetUser.id]) {
    const embed = new EmbedBuilder()
      .setColor(ERROR_RED)
      .setTitle("❌ User Not Linked")
      .setDescription(
        `**${targetUser.username}** doesn't have a linked Goodreads account.`
      );

    return interaction.editReply({ embeds: [embed] });
  }

  const goodreadsUsername = links[targetUser.id].username;
  delete links[targetUser.id];
  await saveJSON(FILES.GOODREADS_LINKS, links);

  const embed = new EmbedBuilder()
    .setColor(WARNING_ORANGE)
    .setTitle("⚠️ User Unlinked")
    .setDescription(
      `Unlinked **${targetUser.username}** from Goodreads.\n\n` +
      `**Former account:** ${goodreadsUsername}\n\n` +
      `Their synced books remain in the tracker.\n` +
      `They can re-link anytime with \`/goodreads link\`.`
    );

  await interaction.editReply({ embeds: [embed] });

  logger.info("Admin unlinked user", {
    admin: interaction.user.id,
    target: targetUser.id,
    goodreadsUser: goodreadsUsername,
  });
}

// ─────────────────────────────────────────────────────────────
//   FORCE SYNC ALL USERS
// ─────────────────────────────────────────────────────────────

async function handleSyncAll(interaction) {
  await interaction.deferReply({ flags: 1 << 6 });

  const links = await loadJSON(FILES.GOODREADS_LINKS, {});
  const userIds = Object.keys(links);

  if (userIds.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(PURPLE)
      .setTitle("📚 No Users to Sync")
      .setDescription("No users have linked their Goodreads accounts.");

    return interaction.editReply({ embeds: [embed] });
  }

  const embed = new EmbedBuilder()
    .setColor(PURPLE)
    .setTitle("🔄 Syncing All Users...")
    .setDescription(
      `Starting sync for **${userIds.length}** user(s).\n\n` +
      `This may take a few minutes. Check logs for details.`
    );

  await interaction.editReply({ embeds: [embed] });

  // Perform sync with rate limiting
  let successCount = 0;
  let failCount = 0;
  let newBooksTotal = 0;

  for (const userId of userIds) {
    try {
      const result = await syncUserGoodreads(userId, interaction.client);
      if (result.success) {
        successCount++;
        newBooksTotal += result.newBooks || 0;
      } else {
        failCount++;
      }
    } catch (error) {
      failCount++;
      logger.error("Sync all error", { userId, error: error.message });
    }

    // Rate limiting
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  // Update with results
  const resultEmbed = new EmbedBuilder()
    .setColor(SUCCESS_GREEN)
    .setTitle("✅ Batch Sync Complete")
    .setDescription(
      `**Total Users:** ${userIds.length}\n` +
      `**Successful:** ${successCount}\n` +
      `**Failed:** ${failCount}\n` +
      `**New Books Added:** ${newBooksTotal}`
    )
    .setFooter({ text: "Check /goodreads-admin stats for updated statistics" });

  await interaction.editReply({ embeds: [resultEmbed] });

  logger.info("Admin batch sync completed", {
    admin: interaction.user.id,
    total: userIds.length,
    success: successCount,
    failed: failCount,
    newBooks: newBooksTotal,
  });
}

export const commandName = "goodreads-admin";

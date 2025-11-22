// commands/goodreads-admin.js — Goodreads Admin Dashboard (SQL Version)
// ✅ View all linked users from DB
// ✅ Force sync specific users
// ✅ View sync statistics from DB
// ✅ Clear problematic links
// ✅ Admin-only access control

import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { syncUserGoodreads, syncAllUsers } from "../utils/goodreadsSync.js";
import { query } from "../utils/db.js";
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

  const res = await query(`SELECT * FROM bc_goodreads_links`);
  const links = res.rows;

  if (links.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(PURPLE)
      .setTitle("📚 Linked Goodreads Accounts")
      .setDescription("No users have linked their Goodreads accounts yet.");

    return interaction.editReply({ embeds: [embed] });
  }

  // Fetch Discord user info
  const userList = await Promise.all(
    links.map(async (link) => {
      try {
        const user = await interaction.client.users.fetch(link.user_id);
        const lastSync = link.last_sync
          ? new Date(link.last_sync).toLocaleString()
          : "Never";

        // Count books synced
        const countRes = await query(
          `SELECT COUNT(*) FROM bc_reading_logs WHERE user_id = $1 AND source = 'goodreads'`,
          [link.user_id]
        );
        const bookCount = parseInt(countRes.rows[0].count);

        return {
          discord: user.username,
          goodreads: link.username,
          lastSync,
          bookCount,
          userId: link.user_id,
        };
      } catch (error) {
        return {
          discord: `Unknown (${link.user_id})`,
          goodreads: link.username,
          lastSync: "N/A",
          bookCount: 0,
          userId: link.user_id,
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
    .setFooter({ text: `Total: ${links.length} user(s)` });

  await interaction.editReply({ embeds: [embed] });
}

// ─────────────────────────────────────────────────────────────
//   FORCE SYNC SPECIFIC USER
// ─────────────────────────────────────────────────────────────

async function handleSyncUser(interaction) {
  await interaction.deferReply({ flags: 1 << 6 });

  const targetUser = interaction.options.getUser("user");

  const res = await query(
    `SELECT username FROM bc_goodreads_links WHERE user_id = $1`,
    [targetUser.id]
  );

  if (res.rowCount === 0) {
    const embed = new EmbedBuilder()
      .setColor(ERROR_RED)
      .setTitle("❌ User Not Linked")
      .setDescription(
        `**${targetUser.username}** hasn't linked a Goodreads account.`
      );

    return interaction.editReply({ embeds: [embed] });
  }

  const goodreadsUsername = res.rows[0].username;

  // Perform sync
  const result = await syncUserGoodreads(targetUser.id, interaction.client);

  if (!result.success) {
    const embed = new EmbedBuilder()
      .setColor(ERROR_RED)
      .setTitle("❌ Sync Failed")
      .setDescription(
        `Failed to sync **${targetUser.username}**\n\n` +
        `**Error:** ${result.error}\n\n` +
        `**Linked account:** ${goodreadsUsername}`
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
      `**Goodreads Account:** ${goodreadsUsername}`
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

  const res = await query(`SELECT * FROM bc_goodreads_links`);
  const links = res.rows;

  if (links.length === 0) {
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

  // Get total books synced via goodreads
  const countRes = await query(
    `SELECT COUNT(*) FROM bc_reading_logs WHERE source = 'goodreads'`
  );
  totalBooks = parseInt(countRes.rows[0].count);

  for (const link of links) {
    if (link.last_sync) {
      syncedCount++;
      const syncTime = new Date(link.last_sync).getTime();
      if (syncTime > oneHourAgo) recentSyncs++;
    } else {
      neverSyncedCount++;
    }
  }

  const avgBooksPerUser = links.length > 0 ? (totalBooks / links.length).toFixed(1) : 0;

  const embed = new EmbedBuilder()
    .setColor(PURPLE)
    .setTitle("📊 Goodreads Sync Statistics")
    .addFields(
      { name: "👥 Total Linked Users", value: String(links.length), inline: true },
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

  const res = await query(
    `SELECT username FROM bc_goodreads_links WHERE user_id = $1`,
    [targetUser.id]
  );

  if (res.rowCount === 0) {
    const embed = new EmbedBuilder()
      .setColor(ERROR_RED)
      .setTitle("❌ User Not Linked")
      .setDescription(
        `**${targetUser.username}** doesn't have a linked Goodreads account.`
      );

    return interaction.editReply({ embeds: [embed] });
  }

  const goodreadsUsername = res.rows[0].username;

  await query(`DELETE FROM bc_goodreads_links WHERE user_id = $1`, [targetUser.id]);

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

  const embed = new EmbedBuilder()
    .setColor(PURPLE)
    .setTitle("🔄 Syncing All Users...")
    .setDescription(
      `Starting batch sync...\n` +
      `This may take a few minutes. Check logs for details.`
    );

  await interaction.editReply({ embeds: [embed] });

  // Use the util function which now handles SQL
  const result = await syncAllUsers(interaction.client);

  // Update with results
  const resultEmbed = new EmbedBuilder()
    .setColor(result.success ? SUCCESS_GREEN : ERROR_RED)
    .setTitle(result.success ? "✅ Batch Sync Complete" : "❌ Batch Sync Failed")
    .setDescription(
      `**Total Users:** ${result.total}\n` +
      `**Successful:** ${result.successCount}\n` +
      `**Failed:** ${result.failedCount}\n` +
      (result.error ? `**Error:** ${result.error}` : "")
    )
    .setFooter({ text: "Check /goodreads-admin stats for updated statistics" });

  await interaction.editReply({ embeds: [resultEmbed] });

  logger.info("Admin batch sync completed", {
    admin: interaction.user.id,
    result
  });
}

export const commandName = "goodreads-admin";

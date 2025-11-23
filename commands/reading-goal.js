// commands/reading-goal.js — Reading Goals System
// ✅ Set annual reading goals (PostgreSQL)
// ✅ Track progress with visual bar
// ✅ Calculate pace and milestones
// ✅ Year-end summaries

import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { query } from "../utils/db.js";
import { logger } from "../utils/logger.js";

const PURPLE = 0x9b59b6;
const SUCCESS_GREEN = 0x2ecc71;
const WARNING_ORANGE = 0xf39c12;
const INFO_BLUE = 0x3498db;

export const definitions = [
  new SlashCommandBuilder()
    .setName("reading-goal")
    .setDescription("Manage your reading goals")
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Set your annual reading goal")
        .addIntegerOption((opt) =>
          opt
            .setName("books")
            .setDescription("Number of books to read")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(1000)
        )
        .addIntegerOption((opt) =>
          opt
            .setName("year")
            .setDescription("Year for this goal (default: current year)")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("progress").setDescription("View your reading goal progress")
    )
    .addSubcommand((sub) =>
      sub.setName("remove").setDescription("Remove your current reading goal")
    ),
].map((c) => c.toJSON());

export async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();

  try {
    if (subcommand === "set") {
      await handleSet(interaction);
    } else if (subcommand === "progress") {
      await handleProgress(interaction);
    } else if (subcommand === "remove") {
      await handleRemove(interaction);
    }
  } catch (error) {
    logger.error("Reading goal command error", {
      subcommand,
      error: error.message,
    });

    const embed = new EmbedBuilder()
      .setColor(WARNING_ORANGE)
      .setTitle("⚠️ Something Went Wrong")
      .setDescription("Failed to process your reading goal. Try again later.");

    const reply = { embeds: [embed], flags: 1 << 6 };

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(reply);
    } else {
      await interaction.reply(reply);
    }
  }
}

// ─────────────────────────────────────────────────────────────
//   SET GOAL
// ─────────────────────────────────────────────────────────────

async function handleSet(interaction) {
  await interaction.deferReply({ flags: 1 << 6 });

  const bookCount = interaction.options.getInteger("books");
  const year = interaction.options.getInteger("year") || new Date().getFullYear();
  const currentYear = new Date().getFullYear();

  // Validate year
  if (year < currentYear - 1 || year > currentYear + 5) {
    const embed = new EmbedBuilder()
      .setColor(WARNING_ORANGE)
      .setTitle("⚠️ Invalid Year")
      .setDescription(
        `Please choose a year between ${currentYear - 1} and ${currentYear + 5}.`
      );

    return interaction.editReply({ embeds: [embed] });
  }

  const userId = interaction.user.id;

  // Ensure user exists
  await query(`INSERT INTO bc_users (user_id, username) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`, [userId, interaction.user.username]);

  // Save goal
  await query(`
    INSERT INTO bc_reading_goals (user_id, year, book_count)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id, year) DO UPDATE SET
      book_count = EXCLUDED.book_count,
      created_at = NOW()
  `, [userId, year, bookCount]);

  // Calculate current progress
  const progress = await calculateProgress(userId, year);

  const embed = new EmbedBuilder()
    .setColor(SUCCESS_GREEN)
    .setTitle("✅ Reading Goal Set!")
    .setDescription(
      `**Goal:** Read ${bookCount} book${bookCount === 1 ? "" : "s"} in ${year}\n\n` +
      `**Current Progress:** ${progress.completed}/${bookCount} books (${progress.percentage}%)\n\n` +
      progress.paceMessage
    )
    .setFooter({ text: "Use /reading-goal progress to check anytime!" });

  await interaction.editReply({ embeds: [embed] });

  logger.info("Reading goal set", {
    userId,
    bookCount,
    year,
  });
}

// ─────────────────────────────────────────────────────────────
//   VIEW PROGRESS
// ─────────────────────────────────────────────────────────────

async function handleProgress(interaction) {
  await interaction.deferReply({ flags: 1 << 6 });

  const userId = interaction.user.id;
  const currentYear = new Date().getFullYear();

  // Default to current year if no specific year requested (future enhancement: add year option to progress)
  // For now, we check if they have a goal for the current year, or maybe the most recent one?
  // Let's stick to current year or the most recent one they set.

  const res = await query(`
    SELECT * FROM bc_reading_goals 
    WHERE user_id = $1 
    ORDER BY year DESC 
    LIMIT 1
  `, [userId]);

  const goal = res.rows[0];

  if (!goal) {
    const embed = new EmbedBuilder()
      .setColor(INFO_BLUE)
      .setTitle("📚 No Reading Goal Set")
      .setDescription(
        "You haven't set a reading goal yet!\n\n" +
        "Use `/reading-goal set [books] [year]` to get started.\n\n" +
        "**Example:** `/reading-goal set 24 2025`"
      );

    return interaction.editReply({ embeds: [embed] });
  }

  const progress = await calculateProgress(userId, goal.year);
  const isCurrentYear = goal.year === currentYear;

  // Progress bar
  const progressBar = createProgressBar(progress.percentage, 20);

  // Determine color based on progress
  let color = PURPLE;
  if (progress.percentage >= 100) color = SUCCESS_GREEN;
  else if (progress.onPace === false) color = WARNING_ORANGE;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`📖 ${goal.year} Reading Goal`)
    .setDescription(
      `**Goal:** ${goal.book_count} book${goal.book_count === 1 ? "" : "s"}\n` +
      `**Completed:** ${progress.completed} book${progress.completed === 1 ? "" : "s"}\n` +
      `**Remaining:** ${progress.remaining} book${progress.remaining === 1 ? "" : "s"}\n\n` +
      `${progressBar} **${progress.percentage}%**\n\n` +
      progress.paceMessage
    );

  // Add milestones
  if (progress.milestones.length > 0) {
    embed.addFields({
      name: "🎯 Milestones Reached",
      value: progress.milestones.join("\n"),
    });
  }

  // Add time-based stats if current year
  if (isCurrentYear && progress.remaining > 0) {
    const today = new Date();
    const endOfYear = new Date(goal.year, 11, 31);
    const daysLeft = Math.ceil((endOfYear - today) / (1000 * 60 * 60 * 24));
    const booksPerMonth = (progress.remaining / (daysLeft / 30)).toFixed(1);

    embed.addFields({
      name: "📅 To Reach Your Goal",
      value:
        `**Days left in ${goal.year}:** ${daysLeft}\n` +
        `**Books per month needed:** ${booksPerMonth}\n` +
        `**Average pace needed:** ${(progress.remaining / (daysLeft / 7)).toFixed(1)} books/week`,
    });
  }

  embed.setFooter({
    text: `Goal set on ${new Date(goal.created_at).toLocaleDateString()}`,
  });

  await interaction.editReply({ embeds: [embed] });
}

// ─────────────────────────────────────────────────────────────
//   REMOVE GOAL
// ─────────────────────────────────────────────────────────────

async function handleRemove(interaction) {
  await interaction.deferReply({ flags: 1 << 6 });

  const userId = interaction.user.id;

  // Get current goal first to show what was removed
  const res = await query(`
    SELECT * FROM bc_reading_goals 
    WHERE user_id = $1 
    ORDER BY year DESC 
    LIMIT 1
  `, [userId]);

  const oldGoal = res.rows[0];

  if (!oldGoal) {
    const embed = new EmbedBuilder()
      .setColor(INFO_BLUE)
      .setTitle("ℹ️ No Goal to Remove")
      .setDescription("You don't have an active reading goal.");

    return interaction.editReply({ embeds: [embed] });
  }

  await query(`DELETE FROM bc_reading_goals WHERE user_id = $1 AND year = $2`, [userId, oldGoal.year]);

  const embed = new EmbedBuilder()
    .setColor(SUCCESS_GREEN)
    .setTitle("✅ Reading Goal Removed")
    .setDescription(
      `Your ${oldGoal.year} goal of ${oldGoal.book_count} books has been removed.\n\n` +
      "You can set a new goal anytime with `/reading-goal set`."
    );

  await interaction.editReply({ embeds: [embed] });

  logger.info("Reading goal removed", {
    userId,
    year: oldGoal.year,
  });
}

// ─────────────────────────────────────────────────────────────
//   HELPER: CALCULATE PROGRESS
// ─────────────────────────────────────────────────────────────

async function calculateProgress(userId, year) {
  // Count completed books in the target year from DB
  const res = await query(`
    SELECT COUNT(*) 
    FROM bc_reading_logs 
    WHERE user_id = $1 
      AND status = 'completed' 
      AND EXTRACT(YEAR FROM completed_at) = $2
  `, [userId, year]);

  const completed = parseInt(res.rows[0].count);

  const goalRes = await query(`
    SELECT book_count 
    FROM bc_reading_goals 
    WHERE user_id = $1 AND year = $2
  `, [userId, year]);

  const goal = goalRes.rows[0];

  if (!goal) {
    return {
      completed: 0,
      remaining: 0,
      percentage: 0,
      paceMessage: "No goal set",
      onPace: null,
      milestones: [],
    };
  }

  const bookCount = goal.book_count;
  const remaining = Math.max(0, bookCount - completed);
  const percentage = Math.min(100, Math.round((completed / bookCount) * 100));

  // Calculate if on pace
  const today = new Date();
  const startOfYear = new Date(year, 0, 1);
  const endOfYear = new Date(year, 11, 31);
  const yearProgress = (today - startOfYear) / (endOfYear - startOfYear);
  const expectedBooks = Math.floor(bookCount * yearProgress);
  const onPace = completed >= expectedBooks;

  // Generate pace message
  let paceMessage = "";
  if (completed >= bookCount) {
    paceMessage = `🎉 **Goal reached!** You've completed your ${year} reading goal!`;
  } else if (year === today.getFullYear()) {
    if (onPace) {
      paceMessage = `✅ **On pace!** You're ${completed - expectedBooks} book${completed - expectedBooks === 1 ? "" : "s"
        } ahead of schedule.`;
    } else {
      paceMessage = `⚠️ **Behind pace.** You need ${expectedBooks - completed} more book${expectedBooks - completed === 1 ? "" : "s"
        } to catch up.`;
    }
  } else if (year > today.getFullYear()) {
    paceMessage = `📅 Goal starts in ${year}`;
  } else {
    paceMessage = `📊 Final result for ${year}`;
  }

  // Milestones
  const milestones = [];
  if (percentage >= 25 && percentage < 50) milestones.push("🥉 25% Complete");
  if (percentage >= 50 && percentage < 75) milestones.push("🥈 50% Complete (Halfway there!)");
  if (percentage >= 75 && percentage < 100) milestones.push("🥇 75% Complete");
  if (percentage >= 100) milestones.push("🏆 100% Complete!");

  return {
    completed,
    remaining,
    percentage,
    paceMessage,
    onPace,
    milestones,
  };
}

// ─────────────────────────────────────────────────────────────
//   HELPER: CREATE PROGRESS BAR
// ─────────────────────────────────────────────────────────────

function createProgressBar(percentage, length = 20) {
  const filled = Math.round((percentage / 100) * length);
  const empty = length - filled;
  return "▰".repeat(filled) + "▱".repeat(empty);
}

// ─────────────────────────────────────────────────────────────
//   EXPORT HELPER FOR OTHER COMMANDS
// ─────────────────────────────────────────────────────────────

export async function getGoalProgress(userId) {
  // Get most recent goal
  const res = await query(`
    SELECT year FROM bc_reading_goals 
    WHERE user_id = $1 
    ORDER BY year DESC 
    LIMIT 1
  `, [userId]);

  const goal = res.rows[0];

  if (!goal) return null;

  return calculateProgress(userId, goal.year);
}

export const commandName = "reading-goal";

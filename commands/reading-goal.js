// commands/reading-goal.js — Reading Goals System
// ✅ Set annual reading goals
// ✅ Track progress with visual bar
// ✅ Calculate pace and milestones
// ✅ Year-end summaries

import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { loadJSON, saveJSON, FILES } from "../utils/storage.js";
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

  // Save goal
  const goals = await loadJSON(FILES.READING_GOALS, {});
  goals[interaction.user.id] = {
    userId: interaction.user.id,
    bookCount,
    year,
    createdAt: new Date().toISOString(),
  };
  await saveJSON(FILES.READING_GOALS, goals);

  // Calculate current progress
  const progress = await calculateProgress(interaction.user.id, year);

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
    userId: interaction.user.id,
    bookCount,
    year,
  });
}

// ─────────────────────────────────────────────────────────────
//   VIEW PROGRESS
// ─────────────────────────────────────────────────────────────

async function handleProgress(interaction) {
  await interaction.deferReply({ flags: 1 << 6 });

  const goals = await loadJSON(FILES.READING_GOALS, {});
  const goal = goals[interaction.user.id];

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

  const progress = await calculateProgress(interaction.user.id, goal.year);
  const isCurrentYear = goal.year === new Date().getFullYear();

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
      `**Goal:** ${goal.bookCount} book${goal.bookCount === 1 ? "" : "s"}\n` +
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
    text: `Goal set on ${new Date(goal.createdAt).toLocaleDateString()}`,
  });

  await interaction.editReply({ embeds: [embed] });
}

// ─────────────────────────────────────────────────────────────
//   REMOVE GOAL
// ─────────────────────────────────────────────────────────────

async function handleRemove(interaction) {
  await interaction.deferReply({ flags: 1 << 6 });

  const goals = await loadJSON(FILES.READING_GOALS, {});

  if (!goals[interaction.user.id]) {
    const embed = new EmbedBuilder()
      .setColor(INFO_BLUE)
      .setTitle("ℹ️ No Goal to Remove")
      .setDescription("You don't have an active reading goal.");

    return interaction.editReply({ embeds: [embed] });
  }

  const oldGoal = goals[interaction.user.id];
  delete goals[interaction.user.id];
  await saveJSON(FILES.READING_GOALS, goals);

  const embed = new EmbedBuilder()
    .setColor(SUCCESS_GREEN)
    .setTitle("✅ Reading Goal Removed")
    .setDescription(
      `Your ${oldGoal.year} goal of ${oldGoal.bookCount} books has been removed.\n\n` +
      "You can set a new goal anytime with `/reading-goal set`."
    );

  await interaction.editReply({ embeds: [embed] });

  logger.info("Reading goal removed", {
    userId: interaction.user.id,
    oldGoal,
  });
}

// ─────────────────────────────────────────────────────────────
//   HELPER: CALCULATE PROGRESS
// ─────────────────────────────────────────────────────────────

async function calculateProgress(userId, year) {
  const trackers = await loadJSON(FILES.TRACKERS, {});
  const userTrackers = trackers[userId]?.tracked || [];

  // Count completed books in the target year
  const completed = userTrackers.filter((book) => {
    if (book.status !== "completed" || !book.completedAt) return false;
    const completedYear = new Date(book.completedAt).getFullYear();
    return completedYear === year;
  }).length;

  const goals = await loadJSON(FILES.READING_GOALS, {});
  const goal = goals[userId];

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

  const remaining = Math.max(0, goal.bookCount - completed);
  const percentage = Math.min(100, Math.round((completed / goal.bookCount) * 100));

  // Calculate if on pace
  const today = new Date();
  const startOfYear = new Date(year, 0, 1);
  const endOfYear = new Date(year, 11, 31);
  const yearProgress = (today - startOfYear) / (endOfYear - startOfYear);
  const expectedBooks = Math.floor(goal.bookCount * yearProgress);
  const onPace = completed >= expectedBooks;

  // Generate pace message
  let paceMessage = "";
  if (completed >= goal.bookCount) {
    paceMessage = `🎉 **Goal reached!** You've completed your ${year} reading goal!`;
  } else if (year === today.getFullYear()) {
    if (onPace) {
      paceMessage = `✅ **On pace!** You're ${completed - expectedBooks} book${
        completed - expectedBooks === 1 ? "" : "s"
      } ahead of schedule.`;
    } else {
      paceMessage = `⚠️ **Behind pace.** You need ${expectedBooks - completed} more book${
        expectedBooks - completed === 1 ? "" : "s"
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
  const goals = await loadJSON(FILES.READING_GOALS, {});
  const goal = goals[userId];
  
  if (!goal) return null;
  
  return calculateProgress(userId, goal.year);
}

export const commandName = "reading-goal";

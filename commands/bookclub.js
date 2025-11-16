// commands/bookclub.js — Book Club Coordination Hub
// ✅ Current pick management
// ✅ Book nominations & voting
// ✅ Club stats & participation
// ✅ Discussion scheduling
// ✅ Member engagement tracking

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";
import { loadJSON, saveJSON, FILES } from "../utils/storage.js";
import { logger } from "../utils/logger.js";

const PURPLE = 0x9b59b6;
const GREEN = 0x2ecc71;
const GOLD = 0xf59e0b;
const BLUE = 0x3498db;

// ===== COMMAND DEFINITIONS =====

export const definitions = [
  new SlashCommandBuilder()
    .setName("bookclub")
    .setDescription("Manage HL Book Club activities")
    .addSubcommand((sub) =>
      sub.setName("current").setDescription("View current book club pick")
    )
    .addSubcommand((sub) =>
      sub.setName("picks").setDescription("View and vote on book nominations")
    )
    .addSubcommand((sub) =>
      sub.setName("stats").setDescription("View book club statistics")
    )
    .addSubcommand((sub) =>
      sub
        .setName("nominate")
        .setDescription("Nominate a book for the club to read")
        .addStringOption((opt) =>
          opt
            .setName("title")
            .setDescription("Book title")
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName("author").setDescription("Book author").setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName("reason")
            .setDescription("Why should the club read this?")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("select")
        .setDescription("(Admin) Select a book as the current club pick")
        .addStringOption((opt) =>
          opt
            .setName("nomination_id")
            .setDescription("ID of the nominated book")
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName("discussion_date")
            .setDescription("Discussion date (e.g., Dec 15, 2025)")
            .setRequired(false)
        )
    ),
].map((c) => c.toJSON());

// ===== EXECUTE =====

export async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "current") {
    return handleCurrent(interaction);
  } else if (subcommand === "picks") {
    return handlePicks(interaction);
  } else if (subcommand === "stats") {
    return handleStats(interaction);
  } else if (subcommand === "nominate") {
    return handleNominate(interaction);
  } else if (subcommand === "select") {
    return handleSelect(interaction);
  }
}

// ===== HANDLER: CURRENT PICK =====

async function handleCurrent(interaction) {
  await interaction.deferReply();

  const clubData = await loadJSON(FILES.BOOKCLUB || "bookclub.json", {
    currentPick: null,
    nominations: [],
    history: [],
  });

  if (!clubData.currentPick) {
    const embed = new EmbedBuilder()
      .setColor(BLUE)
      .setTitle("📚 HL Book Club")
      .setDescription(
        "**No current book selected!**\n\n" +
        "Use `/bookclub picks` to vote on nominations, or\n" +
        "Use `/bookclub nominate` to suggest a book!"
      )
      .setFooter({ text: "Higher-er Learning Book Club" });

    return interaction.editReply({ embeds: [embed] });
  }

  const pick = clubData.currentPick;
  const trackers = await loadJSON(FILES.TRACKERS, {});

  // Count how many members are reading it
  let readingCount = 0;
  let completedCount = 0;

  Object.values(trackers).forEach((userData) => {
    const book = userData.tracked?.find(
      (b) =>
        b.title.toLowerCase() === pick.title.toLowerCase() &&
        b.author?.toLowerCase() === pick.author?.toLowerCase()
    );
    if (book) {
      if (book.status === "reading") readingCount++;
      if (book.status === "completed") completedCount++;
    }
  });

  const embed = new EmbedBuilder()
    .setColor(GREEN)
    .setTitle("🎯 Current Book Club Pick")
    .setDescription(
      `**${pick.title}**\n` +
      `*by ${pick.author}*\n\n` +
      `${pick.reason || "Let's read this together!"}\n\n` +
      `👥 **${readingCount}** reading | ✅ **${completedCount}** completed`
    )
    .addFields(
      {
        name: "📅 Discussion Date",
        value: pick.discussionDate || "TBD",
        inline: true,
      },
      {
        name: "📝 Nominated By",
        value: pick.nominatedBy ? `<@${pick.nominatedBy}>` : "Admin",
        inline: true,
      }
    )
    .setFooter({ text: "Use /tracker to add this book to your reading list!" });

  const components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`bc_add_to_tracker_${pick.id}`)
        .setLabel("📖 Add to My Tracker")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`bc_start_discussion_${pick.id}`)
        .setLabel("💬 Discussion Thread")
        .setStyle(ButtonStyle.Primary)
    ),
  ];

  await interaction.editReply({ embeds: [embed], components });
}

// ===== HANDLER: NOMINATIONS & VOTING =====

async function handlePicks(interaction) {
  await interaction.deferReply();

  const clubData = await loadJSON(FILES.BOOKCLUB || "bookclub.json", {
    currentPick: null,
    nominations: [],
    history: [],
  });

  if (!clubData.nominations || clubData.nominations.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(BLUE)
      .setTitle("📚 Book Nominations")
      .setDescription(
        "**No nominations yet!**\n\n" +
        "Be the first to nominate a book:\n" +
        "`/bookclub nominate`"
      )
      .setFooter({ text: "HL Book Club" });

    return interaction.editReply({ embeds: [embed] });
  }

  // Sort by votes
  const sorted = [...clubData.nominations].sort(
    (a, b) => (b.votes?.length || 0) - (a.votes?.length || 0)
  );

  const lines = sorted.slice(0, 10).map((nom, idx) => {
    const voteCount = nom.votes?.length || 0;
    const hasVoted = nom.votes?.includes(interaction.user.id);
    const voteIndicator = hasVoted ? " ✓" : "";

    return (
      `**${idx + 1}.** ${nom.title} — *${nom.author}*\n` +
      `   📊 ${voteCount} vote${voteCount !== 1 ? "s" : ""}${voteIndicator}\n` +
      `   💬 ${nom.reason || "No description"}\n` +
      `   👤 Nominated by <@${nom.nominatedBy}>`
    );
  });

  const embed = new EmbedBuilder()
    .setColor(PURPLE)
    .setTitle("📚 Book Nominations — Vote for Next Pick!")
    .setDescription(lines.join("\n\n"))
    .setFooter({
      text: `${sorted.length} nomination${sorted.length !== 1 ? "s" : ""} • Use buttons below to vote`,
    });

  // Vote buttons (dropdown if more than 5)
  const components = [];

  if (sorted.length <= 5) {
    const buttons = sorted.slice(0, 5).map((nom, idx) =>
      new ButtonBuilder()
        .setCustomId(`bc_vote_${nom.id}`)
        .setLabel(`${idx + 1}. ${nom.title.slice(0, 50)}`)
        .setStyle(ButtonStyle.Secondary)
    );
    components.push(new ActionRowBuilder().addComponents(...buttons));
  } else {
    const options = sorted.slice(0, 20).map((nom, idx) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(`${idx + 1}. ${nom.title.slice(0, 80)}`)
        .setValue(nom.id)
        .setDescription(`by ${nom.author.slice(0, 80)}`)
    );

    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("bc_vote_select")
          .setPlaceholder("Select a book to vote for...")
          .setOptions(options)
      )
    );
  }

  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("bc_nominate_new")
        .setLabel("➕ Nominate a Book")
        .setStyle(ButtonStyle.Success)
    )
  );

  await interaction.editReply({ embeds: [embed], components });
}

// ===== HANDLER: STATS =====

async function handleStats(interaction) {
  await interaction.deferReply();

  const trackers = await loadJSON(FILES.TRACKERS, {});
  const clubData = await loadJSON(FILES.BOOKCLUB || "bookclub.json", {
    nominations: [],
    history: [],
  });

  // Calculate stats
  const totalMembers = Object.keys(trackers).length;
  let totalBooksRead = 0;
  let totalPagesRead = 0;
  let activeReaders = 0;

  const memberStats = [];

  Object.entries(trackers).forEach(([userId, data]) => {
    const completed = data.tracked?.filter((b) => b.status === "completed") || [];
    const reading = data.tracked?.filter((b) => b.status === "reading") || [];
    const pages = data.tracked?.reduce((sum, b) => sum + (b.currentPage || 0), 0) || 0;

    totalBooksRead += completed.length;
    totalPagesRead += pages;
    if (reading.length > 0) activeReaders++;

    memberStats.push({
      userId,
      booksCompleted: completed.length,
      pagesRead: pages,
    });
  });

  // Top readers
  const topReaders = memberStats
    .sort((a, b) => b.booksCompleted - a.booksCompleted)
    .slice(0, 5);

  const leaderboard = topReaders
    .map(
      (m, idx) =>
        `${idx + 1}. <@${m.userId}> — ${m.booksCompleted} book${m.booksCompleted !== 1 ? "s" : ""}, ${m.pagesRead.toLocaleString()} pages`
    )
    .join("\n");

  const embed = new EmbedBuilder()
    .setColor(GOLD)
    .setTitle("📊 HL Book Club Statistics")
    .setDescription(
      `**Club Overview**\n` +
      `👥 **${totalMembers}** members\n` +
      `📖 **${activeReaders}** actively reading\n` +
      `✅ **${totalBooksRead}** books completed\n` +
      `📄 **${totalPagesRead.toLocaleString()}** total pages read\n` +
      `📚 **${clubData.nominations?.length || 0}** books nominated\n` +
      `🎯 **${clubData.history?.length || 0}** past club picks`
    )
    .addFields({
      name: "🏆 Top Readers",
      value: leaderboard || "No data yet",
      inline: false,
    })
    .setFooter({ text: "Keep reading! 📚" });

  await interaction.editReply({ embeds: [embed] });
}

// ===== HANDLER: NOMINATE =====

async function handleNominate(interaction) {
  await interaction.deferReply({ flags: 1 << 6 });

  const title = interaction.options.getString("title");
  const author = interaction.options.getString("author");
  const reason = interaction.options.getString("reason") || "";

  const clubData = await loadJSON(FILES.BOOKCLUB || "bookclub.json", {
    currentPick: null,
    nominations: [],
    history: [],
  });

  // Check for duplicates
  const existing = clubData.nominations.find(
    (n) =>
      n.title.toLowerCase() === title.toLowerCase() &&
      n.author.toLowerCase() === author.toLowerCase()
  );

  if (existing) {
    return interaction.editReply({
      content: `📚 **${title}** by ${author} has already been nominated!\n\nUse \`/bookclub picks\` to vote for it.`,
    });
  }

  const nomination = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title,
    author,
    reason,
    nominatedBy: interaction.user.id,
    nominatedAt: new Date().toISOString(),
    votes: [],
  };

  clubData.nominations.push(nomination);
  await saveJSON(FILES.BOOKCLUB || "bookclub.json", clubData);

  await interaction.editReply({
    content:
      `✅ **Nominated:** ${title} by ${author}\n\n` +
      `Your nomination is now live! Others can vote with \`/bookclub picks\`.`,
  });

  logger.info("Book nominated", {
    title,
    author,
    userId: interaction.user.id,
  });
}

// ===== HANDLER: SELECT (ADMIN) =====

async function handleSelect(interaction) {
  await interaction.deferReply({ flags: 1 << 6 });

  // Check admin permissions (customize as needed)
  if (!interaction.member.permissions.has("ManageGuild")) {
    return interaction.editReply({
      content: "❌ Only admins can select book club picks.",
    });
  }

  const nominationId = interaction.options.getString("nomination_id");
  const discussionDate = interaction.options.getString("discussion_date");

  const clubData = await loadJSON(FILES.BOOKCLUB || "bookclub.json", {
    currentPick: null,
    nominations: [],
    history: [],
  });

  const nomination = clubData.nominations.find((n) => n.id === nominationId);

  if (!nomination) {
    return interaction.editReply({
      content: "❌ Nomination not found. Use `/bookclub picks` to see valid IDs.",
    });
  }

  // Move current pick to history
  if (clubData.currentPick) {
    clubData.history.push({
      ...clubData.currentPick,
      completedAt: new Date().toISOString(),
    });
  }

  // Set new pick
  clubData.currentPick = {
    ...nomination,
    selectedAt: new Date().toISOString(),
    discussionDate: discussionDate || "TBD",
  };

  // Remove from nominations
  clubData.nominations = clubData.nominations.filter((n) => n.id !== nominationId);

  await saveJSON(FILES.BOOKCLUB || "bookclub.json", clubData);

  await interaction.editReply({
    content:
      `🎯 **New Book Club Pick Selected!**\n\n` +
      `📚 ${nomination.title} by ${nomination.author}\n` +
      `📅 Discussion: ${discussionDate || "TBD"}\n\n` +
      `Members can now use \`/bookclub current\` to see details!`,
  });

  logger.info("Book club pick selected", {
    title: nomination.title,
    selectedBy: interaction.user.id,
  });
}

// ===== COMPONENT HANDLERS =====

export async function handleComponent(interaction) {
  const cid = interaction.customId;

  if (cid.startsWith("bc_vote_")) {
    return handleVote(interaction);
  } else if (cid === "bc_vote_select") {
    return handleVote(interaction);
  } else if (cid === "bc_nominate_new") {
    return handleNominateModal(interaction);
  } else if (cid.startsWith("bc_add_to_tracker_")) {
    return handleAddToTracker(interaction);
  } else if (cid.startsWith("bc_start_discussion_")) {
    return handleStartDiscussion(interaction);
  }

  return false;
}

async function handleVote(interaction) {
  await interaction.deferReply({ flags: 1 << 6 });

  const nominationId =
    interaction.customId.split("_")[2] || interaction.values?.[0];

  const clubData = await loadJSON(FILES.BOOKCLUB || "bookclub.json", {
    nominations: [],
  });

  const nomination = clubData.nominations.find((n) => n.id === nominationId);

  if (!nomination) {
    return interaction.editReply({
      content: "❌ Nomination not found.",
    });
  }

  if (!nomination.votes) nomination.votes = [];

  // Toggle vote
  if (nomination.votes.includes(interaction.user.id)) {
    nomination.votes = nomination.votes.filter((id) => id !== interaction.user.id);
    await saveJSON(FILES.BOOKCLUB || "bookclub.json", clubData);
    return interaction.editReply({
      content: `✅ Removed your vote for **${nomination.title}**`,
    });
  } else {
    nomination.votes.push(interaction.user.id);
    await saveJSON(FILES.BOOKCLUB || "bookclub.json", clubData);
    return interaction.editReply({
      content: `✅ Voted for **${nomination.title}** by ${nomination.author}!\n\nCurrent votes: ${nomination.votes.length}`,
    });
  }
}

async function handleNominateModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId("bc_nominate_modal_submit")
    .setTitle("Nominate a Book");

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("book_title")
        .setLabel("Book Title")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("book_author")
        .setLabel("Author")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("book_reason")
        .setLabel("Why should we read this? (optional)")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
    )
  );

  await interaction.showModal(modal);
  return true;
}

async function handleAddToTracker(interaction) {
  await interaction.deferReply({ flags: 1 << 6 });

  const clubData = await loadJSON(FILES.BOOKCLUB || "bookclub.json", {});
  const pick = clubData.currentPick;

  if (!pick) {
    return interaction.editReply({
      content: "❌ No current pick selected.",
    });
  }

  const trackers = await loadJSON(FILES.TRACKERS, {});
  const userId = interaction.user.id;

  if (!trackers[userId]) trackers[userId] = { tracked: [] };

  // Check if already added
  const existing = trackers[userId].tracked.find(
    (b) =>
      b.title.toLowerCase() === pick.title.toLowerCase() &&
      b.author?.toLowerCase() === pick.author?.toLowerCase()
  );

  if (existing) {
    return interaction.editReply({
      content: `📚 **${pick.title}** is already in your tracker!`,
    });
  }

  // Add to tracker
  const newTracker = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: pick.title,
    author: pick.author,
    totalPages: 0,
    currentPage: 0,
    status: "reading",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: "bookclub",
  };

  trackers[userId].tracked.push(newTracker);
  await saveJSON(FILES.TRACKERS, trackers);

  await interaction.editReply({
    content: `✅ Added **${pick.title}** to your reading tracker!\n\nUse \`/tracker\` to update your progress.`,
  });
}

async function handleStartDiscussion(interaction) {
  await interaction.deferReply({ flags: 1 << 6 });

  // This could create a thread or link to a discussion channel
  // For now, just a placeholder

  await interaction.editReply({
    content:
      "💬 **Discussion feature coming soon!**\n\n" +
      "For now, use your club's discussion channel to chat about this book.",
  });
}

// ===== MODAL SUBMIT =====

export async function handleModalSubmit(interaction) {
  if (interaction.customId === "bc_nominate_modal_submit") {
    await interaction.deferReply({ flags: 1 << 6 });

    const title = interaction.fields.getTextInputValue("book_title");
    const author = interaction.fields.getTextInputValue("book_author");
    const reason = interaction.fields.getTextInputValue("book_reason") || "";

    const clubData = await loadJSON(FILES.BOOKCLUB || "bookclub.json", {
      nominations: [],
    });

    const nomination = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title,
      author,
      reason,
      nominatedBy: interaction.user.id,
      nominatedAt: new Date().toISOString(),
      votes: [],
    };

    clubData.nominations.push(nomination);
    await saveJSON(FILES.BOOKCLUB || "bookclub.json", clubData);

    await interaction.editReply({
      content: `✅ **Nominated:** ${title} by ${author}\n\nUse \`/bookclub picks\` to see all nominations!`,
    });

    return true;
  }

  return false;
}

export const commandName = "bookclub";

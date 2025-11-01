// commands/tracker.js — Phase 8 Classic + QoL Merge (Modernized)
// ✅  flags-based interaction replies (Discord.js v14.16+)
// ✅  Seamless with hybrid visibility system
// ✅  DEBUG logs for Railway
// ✅  Reading tracker modals + log updates retained

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  ActionRowBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { loadJSON, saveJSON, FILES } from "../utils/storage.js";
import { appendReadingLog, calcBookStats } from "../utils/analytics.js";

const PURPLE = 0x8b5cf6;
const GREEN = 0x16a34a;
const RED = 0xf43f5e;
const DEBUG = process.env.DEBUG === "true";

// ---------------------------------------------------------------------------
// Slash Command Definition
// ---------------------------------------------------------------------------

export const definitions = [
  new SlashCommandBuilder()
    .setName("tracker")
    .setDescription("Track or update your current reading progress")
    .addSubcommand((sc) =>
      sc
        .setName("start")
        .setDescription("Start tracking a book")
        .addStringOption((o) =>
          o.setName("title").setDescription("Book title").setRequired(true)
        )
        .addIntegerOption((o) =>
          o.setName("total").setDescription("Total pages").setRequired(true)
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName("update")
        .setDescription("Update your progress on a tracked book")
        .addStringOption((o) =>
          o
            .setName("title")
            .setDescription("Book title (exact or partial match)")
            .setRequired(true)
        )
        .addIntegerOption((o) =>
          o
            .setName("page")
            .setDescription("Page number reached")
            .setRequired(true)
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName("resume")
        .setDescription("Show and update your current tracked books")
    ),
].map((c) => c.toJSON());

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const user = interaction.user;
  const uid = user.id;

  try {
    // Load user data
    const trackers = await loadJSON(FILES.TRACKERS);
    if (!trackers[uid]) trackers[uid] = { tracked: [] };

    // ---------------------------------------------------------
    // /tracker start
    // ---------------------------------------------------------
    if (sub === "start") {
      const title = interaction.options.getString("title", true).trim();
      const totalPages = interaction.options.getInteger("total", true);
      const exists = trackers[uid].tracked.find(
        (b) => b.title.toLowerCase() === title.toLowerCase()
      );
      if (exists)
        return interaction.editReply({
          content: `You're already tracking **${title}**.`,
        });

      trackers[uid].tracked.unshift({
        title,
        totalPages,
        currentPage: 0,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      await saveJSON(FILES.TRACKERS, trackers);

      const e = new EmbedBuilder()
        .setTitle(`Started tracking "${title}"`)
        .setColor(GREEN)
        .setDescription(`Total pages: **${totalPages}**`);
      await interaction.editReply({ embeds: [e] });
      if (DEBUG) console.log(`[tracker.start] ${user.username} → ${title}`);
      return;
    }

    // ---------------------------------------------------------
    // /tracker update
    // ---------------------------------------------------------
    if (sub === "update") {
      const title = interaction.options.getString("title", true).trim();
      const page = interaction.options.getInteger("page", true);
      const entry = trackers[uid].tracked.find((b) =>
        b.title.toLowerCase().includes(title.toLowerCase())
      );

      if (!entry)
        return interaction.editReply({
          content: `No tracked book found matching **${title}**.`,
        });

      if (page < entry.currentPage)
        return interaction.editReply({
          content: `⚠️ You’re already past page ${page}.`,
        });

      entry.currentPage = Math.min(page, entry.totalPages);
      entry.updatedAt = new Date().toISOString();
      await saveJSON(FILES.TRACKERS, trackers);

      await appendReadingLog(uid, entry.title, page);
      const stats = calcBookStats(entry);

      const e = new EmbedBuilder()
        .setTitle(`Updated: ${entry.title}`)
        .setColor(PURPLE)
        .setDescription(
          `Progress: **${entry.currentPage}/${entry.totalPages} pages**\n${stats}`
        );
      await interaction.editReply({ embeds: [e] });
      if (DEBUG)
        console.log(`[tracker.update] ${user.username} → ${entry.title} (${page})`);
      return;
    }

    // ---------------------------------------------------------
    // /tracker resume
    // ---------------------------------------------------------
    if (sub === "resume") {
      const tracked = trackers[uid].tracked || [];
      if (!tracked.length)
        return interaction.editReply({
          content: "You’re not tracking any books yet. Use `/tracker start`.",
        });

      const lines = tracked
        .map(
          (b, i) =>
            `**${i + 1}.** ${b.title} — ${b.currentPage}/${b.totalPages} pages`
        )
        .join("\n");

      const e = new EmbedBuilder()
        .setTitle("📖 Your Tracked Books")
        .setColor(PURPLE)
        .setDescription(lines)
        .setFooter({ text: "Use /tracker update to modify progress" });

      await interaction.editReply({ embeds: [e] });
      if (DEBUG) console.log(`[tracker.resume] by ${user.username}`);
      return;
    }

    await interaction.editReply({ content: "⚠️ Unknown subcommand." });
  } catch (err) {
    console.error(`[tracker.${sub}]`, err);
    const msg = { content: "⚠️ Something went wrong.", flags: 1 << 6 };
    if (interaction.deferred || interaction.replied)
      await interaction.editReply(msg);
    else await interaction.reply(msg);
  }
}

// ---------------------------------------------------------------------------
// Component / Modal Handler
// ---------------------------------------------------------------------------

export async function handleComponent(interaction) {
  if (interaction.customId !== "trk_add_open") return;

  const modal = new ModalBuilder()
    .setCustomId("trk_add_modal")
    .setTitle("Add Book to Tracker");

  const title = new TextInputBuilder()
    .setCustomId("trk_title")
    .setLabel("Book Title")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const pages = new TextInputBuilder()
    .setCustomId("trk_pages")
    .setLabel("Total Pages")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const row1 = new ActionRowBuilder().addComponents(title);
  const row2 = new ActionRowBuilder().addComponents(pages);
  await interaction.showModal(modal.addComponents(row1, row2));

  if (DEBUG) console.log(`[tracker.modal-open] by ${interaction.user.username}`);
}

// ---------------------------------------------------------------------------
// Modal Submission Handler
// ---------------------------------------------------------------------------

export async function handleModalSubmit(interaction) {
  if (interaction.customId !== "trk_add_modal") return;

  try {
    const title = interaction.fields.getTextInputValue("trk_title").trim();
    const totalPages = parseInt(
      interaction.fields.getTextInputValue("trk_pages").trim(),
      10
    );

    const user = interaction.user;
    const uid = user.id;

    const trackers = await loadJSON(FILES.TRACKERS);
    if (!trackers[uid]) trackers[uid] = { tracked: [] };

    const exists = trackers[uid].tracked.find(
      (b) => b.title.toLowerCase() === title.toLowerCase()
    );
    if (exists)
      return interaction.reply({
        content: `You’re already tracking **${title}**.`,
        flags: 1 << 6,
      });

    trackers[uid].tracked.unshift({
      title,
      totalPages,
      currentPage: 0,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await saveJSON(FILES.TRACKERS, trackers);

    const e = new EmbedBuilder()
      .setTitle(`Added "${title}" to Tracker`)
      .setColor(GREEN)
      .setDescription(`Total pages: **${totalPages}**`);

    await interaction.reply({ embeds: [e], flags: 1 << 6 });
    if (DEBUG) console.log(`[tracker.modal-submit] ${user.username} → ${title}`);
  } catch (err) {
    console.error("[tracker.handleModalSubmit]", err);
    try {
      await interaction.reply({
        content: "⚠️ Something went wrong adding your book.",
        flags: 1 << 6,
      });
    } catch {}
  }
}

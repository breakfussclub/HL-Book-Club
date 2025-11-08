// commands/leaderboard.js
// 🏆 Displays top readers (formerly /book leaderboard)
// ✅ Uses unified gold theme + HL Book Club header
// ✅ Supports all-time, month, and week ranges

import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { loadJSON, FILES } from "../utils/storage.js";
import { EMBED_THEME } from "../utils/embedThemes.js";

const DEBUG = process.env.DEBUG === "true";

export const definitions = [
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show top readers by pages read or books completed")
    .addStringOption((o) =>
      o
        .setName("range")
        .setDescription("Time range")
        .setChoices(
          { name: "All time", value: "all" },
          { name: "This month", value: "month" },
          { name: "This week", value: "week" }
        )
    ),
].map((c) => c.toJSON());

export async function execute(interaction) {
  try {
    const range = interaction.options.getString("range") || "all";

    const trackers = await loadJSON(FILES.TRACKERS);
    const logsAll = await loadJSON(FILES.READING_LOGS);

    const now = new Date();
    let since = null;
    if (range === "week") {
      since = new Date(now.getTime() - 7 * 86400000);
    } else if (range === "month") {
      const tmp = new Date(now);
      tmp.setDate(1);
      since = tmp;
    }

    // 🧮 Compute pages + completions
    const pagesInRange = (logs) => {
      const arr = (logs || []).filter((l) => !since || new Date(l.at) >= since);
      let pages = 0;
      for (let i = 1; i < arr.length; i++) {
        const d = arr[i].page - arr[i - 1].page;
        if (arr[i].bookId === arr[i - 1].bookId && d > 0) pages += d;
      }
      return pages;
    };

    const completedBooks = (uid) => {
      const u = trackers[uid];
      if (!u) return 0;
      const arr = u.tracked || [];
      return arr.filter(
        (t) =>
          t.totalPages &&
          t.currentPage >= t.totalPages &&
          (!since || new Date(t.updatedAt) >= since)
      ).length;
    };

    const scores = [];
    for (const uid of Object.keys(trackers)) {
      const pages = pagesInRange(logsAll[uid]);
      const comp = completedBooks(uid);
      if (pages > 0 || comp > 0) scores.push({ uid, pages, comp });
    }

    if (!scores.length)
      return interaction.editReply({
        content: "No progress to rank yet.",
      });

    scores.sort((a, b) => b.pages - a.pages || b.comp - a.comp);

    // 🥇 Compose leaderboard embed
    const medals = ["🥇", "🥈", "🥉"];
    const label =
      range === "week" ? "This Week" : range === "month" ? "This Month" : "All Time";

    const lines = scores
      .slice(0, 10)
      .map(
        (s, i) =>
          `${medals[i] || `#${i + 1}`} <@${s.uid}> — **${s.pages} pages**${
            s.comp ? ` • ${s.comp} completed` : ""
          }`
      )
      .join("\n");

    const embed = new EmbedBuilder()
      .setTitle(`🏆 Leaderboard — ${label}`)
      .setColor(EMBED_THEME.gold)
      .setAuthor({
        name: "HL Book Club",
        iconURL: interaction.client.user.displayAvatarURL(),
      })
      .setDescription(lines)
      .setFooter({ text: EMBED_THEME.footer });

    await interaction.editReply({ embeds: [embed] });

    if (DEBUG)
      console.log(`[leaderboard] displayed (${range}) by ${interaction.user.username}`);
  } catch (err) {
    console.error("[leaderboard.execute]", err);
    const msg = { content: "⚠️ Something went wrong.", flags: 1 << 6 };
    if (interaction.deferred || interaction.replied)
      await interaction.editReply(msg);
    else await interaction.reply(msg);
  }
}

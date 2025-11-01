// commands/book.js — Full Phase 8 Classic + QoL Merge (Modernized)
// ✅ Complete suite of book-club commands
// ✅ Uses flags-based interaction replies (Discord.js v14.16+ friendly)
// ✅ Amazon ISBN linking, rich embeds, hybrid visibility compatible
// ✅ Lightweight DEBUG logs for Railway

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
} from "discord.js";
import { loadJSON, saveJSON, FILES } from "../utils/storage.js";
import { hybridSearchMany } from "../utils/search.js";

const PURPLE = 0x8b5cf6;
const GOLD = 0xf59e0b;
const RED = 0xf43f5e;
const GREEN = 0x16a34a;
const CYAN = 0x06b6d4;
const DEBUG = process.env.DEBUG === "true";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isMod(inter) {
  return (
    inter.memberPermissions?.has("ManageGuild") ||
    inter.member?.roles?.cache?.some((r) =>
      r.name.toLowerCase().includes("mod")
    )
  );
}

function sortSchedules(arr = []) {
  return [...arr].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  );
}

// ---------------------------------------------------------------------------
// Slash Command Definitions
// ---------------------------------------------------------------------------

export const definitions = [
  new SlashCommandBuilder()
    .setName("book")
    .setDescription("Book-club commands")
    .addSubcommand((sc) =>
      sc
        .setName("search")
        .setDescription("Search for a book")
        .addStringOption((o) =>
          o.setName("query").setDescription("Title/author/ISBN").setRequired(true)
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName("add")
        .setDescription("Add a book to the club list")
        .addStringOption((o) =>
          o.setName("query").setDescription("Title/author/ISBN").setRequired(true)
        )
    )
    .addSubcommand((sc) => sc.setName("list").setDescription("Show recent club books"))
    .addSubcommand((sc) =>
      sc.setName("current").setDescription("Show the current club read")
    )
    .addSubcommand((sc) =>
      sc
        .setName("set-club-current")
        .setDescription("Set the club current book (mods only)")
        .addStringOption((o) =>
          o.setName("query").setDescription("Title/author/ISBN").setRequired(true)
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName("leaderboard")
        .setDescription("Show top readers")
        .addStringOption((o) =>
          o
            .setName("range")
            .setDescription("Time range")
            .setChoices(
              { name: "All time", value: "all" },
              { name: "This month", value: "month" },
              { name: "This week", value: "week" }
            )
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName("quote")
        .setDescription("Save a quote under your name")
        .addStringOption((o) =>
          o.setName("text").setDescription("Quote text").setRequired(true)
        )
    )
    .addSubcommand((sc) =>
      sc.setName("my-quotes").setDescription("Show your saved quotes")
    )
    .addSubcommand((sc) =>
      sc
        .setName("schedule-add")
        .setDescription("Add a club schedule item (mods only)")
        .addStringOption((o) =>
          o.setName("date").setDescription("YYYY-MM-DD").setRequired(true)
        )
        .addStringOption((o) =>
          o.setName("description").setDescription("Event description").setRequired(true)
        )
    )
    .addSubcommand((sc) =>
      sc.setName("schedule-list").setDescription("List upcoming schedule items")
    )
    .addSubcommand((sc) =>
      sc
        .setName("schedule-remove")
        .setDescription("Remove a schedule item (mods only)")
        .addIntegerOption((o) =>
          o.setName("index").setDescription("Number from list").setRequired(true)
        )
    ),
].map((c) => c.toJSON());

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const user = interaction.user;

  try {
    // ---------------------------------------------------------------------
    // /book search
    // ---------------------------------------------------------------------
    if (sub === "search") {
      const query = interaction.options.getString("query", true);

      const results = await hybridSearchMany(query, 1);
      if (!results.length)
        return interaction.editReply({ content: `No results for **${query}**.` });

      const book = results[0];
      const isbn = book.industryIdentifiers?.[0]?.identifier;
      const amazonUrl = isbn
        ? `https://www.amazon.com/s?k=${isbn}`
        : `https://www.amazon.com/s?k=${encodeURIComponent(
            book.title + " " + (book.authors?.[0] || "")
          )}`;

      const e = new EmbedBuilder()
        .setColor(PURPLE)
        .setAuthor({
          name: "HL Book Club",
          iconURL: interaction.client.user.displayAvatarURL(),
        })
        .setTitle(book.title || "Untitled")
        .setURL(book.previewLink || null)
        .setDescription(
          book.description
            ? book.description.slice(0, 400) +
              (book.description.length > 400 ? "..." : "")
            : "No summary available."
        )
        .addFields(
          { name: "Authors", value: book.authors?.join(", ") || "Unknown", inline: true },
          { name: "Language", value: book.language?.toUpperCase() || "—", inline: true },
          { name: "Page count", value: book.pageCount ? String(book.pageCount) : "—", inline: true }
        )
        .setFooter({
          text: `${book.source || "Google Books"}${
            book.publishedDate ? ` • Published ${book.publishedDate}` : ""
          }`,
        });

      if (book.thumbnail) e.setThumbnail(book.thumbnail);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("View on Google Books")
          .setStyle(ButtonStyle.Link)
          .setURL(
            book.previewLink ||
              `https://www.google.com/search?q=${encodeURIComponent(book.title)}`
          ),
        new ButtonBuilder()
          .setLabel("View on Amazon")
          .setStyle(ButtonStyle.Link)
          .setURL(amazonUrl),
        new ButtonBuilder()
          .setCustomId("trk_add_open")
          .setLabel("Add to My Tracker")
          .setStyle(ButtonStyle.Primary)
      );

      await interaction.editReply({ embeds: [e], components: [row] });
      if (DEBUG) console.log(`[book.search] "${book.title}" by ${user.username}`);
      return;
    }

    // ---------------------------------------------------------------------
    // /book add
    // ---------------------------------------------------------------------
    if (sub === "add") {
      const query = interaction.options.getString("query", true);

      const results = await hybridSearchMany(query, 1);
      if (!results.length)
        return interaction.editReply({ content: `No results for **${query}**.` });

      const book = results[0];
      const club = await loadJSON(FILES.CLUB);
      if (!club.books.find((b) => b.id === book.id)) {
        club.books.unshift({
          id: book.id,
          title: book.title,
          authors: book.authors,
          thumbnail: book.thumbnail,
          source: book.source,
          addedBy: user.id,
          addedAt: new Date().toISOString(),
        });
        if (club.books.length > 1000) club.books.pop();
        await saveJSON(FILES.CLUB, club);
      }

      const e = new EmbedBuilder()
        .setTitle(`Added to Book Club: ${book.title}`)
        .setColor(GREEN)
        .setDescription(book.authors?.length ? `by ${book.authors.join(", ")}` : null);
      if (book.thumbnail) e.setThumbnail(book.thumbnail);
      if (book.previewLink) e.setURL(book.previewLink);

      await interaction.editReply({ embeds: [e] });
      if (DEBUG) console.log(`[book.add] "${book.title}" by ${user.username}`);
      return;
    }

    // ---------------------------------------------------------------------
    // /book list
    // ---------------------------------------------------------------------
    if (sub === "list") {
      const club = await loadJSON(FILES.CLUB);
      if (!club.books.length)
        return interaction.editReply({ content: "No club books yet. Use /book add." });

      const lines = club.books
        .slice(0, 10)
        .map(
          (b, i) =>
            `**${i + 1}.** ${b.title}${
              b.authors?.length ? ` — ${b.authors.join(", ")}` : ""
            }`
        )
        .join("\n");

      const e = new EmbedBuilder()
        .setTitle("📚 Book Club List (Latest 10)")
        .setColor(GREEN)
        .setDescription(lines)
        .setFooter({ text: `Total: ${club.books.length}` });

      await interaction.editReply({ embeds: [e] });
      if (DEBUG) console.log(`[book.list] by ${user.username}`);
      return;
    }

    // ---------------------------------------------------------------------
    // /book current
    // ---------------------------------------------------------------------
    if (sub === "current") {
      const club = await loadJSON(FILES.CLUB);
      const e = new EmbedBuilder().setTitle("📌 Club Current Read").setColor(GOLD);

      if (club.clubCurrent) {
        e.setDescription(
          `**${club.clubCurrent.title}** — ${
            club.clubCurrent.authors?.join(", ") || "Unknown"
          }`
        );
        if (club.clubCurrent.thumbnail) e.setThumbnail(club.clubCurrent.thumbnail);
      } else {
        e.setDescription("No club current set.");
      }

      await interaction.editReply({ embeds: [e] });
      if (DEBUG) console.log(`[book.current] by ${user.username}`);
      return;
    }

    // ---------------------------------------------------------------------
    // /book set-club-current (mods only)
    // ---------------------------------------------------------------------
    if (sub === "set-club-current") {
      if (!isMod(interaction))
        return interaction.editReply({ content: "No permission." });

      const q = interaction.options.getString("query", true);
      const results = await hybridSearchMany(q, 1);
      if (!results.length)
        return interaction.editReply({ content: `No results for **${q}**.` });

      const book = results[0];
      const club = await loadJSON(FILES.CLUB);
      club.clubCurrent = {
        id: book.id,
        title: book.title,
        authors: book.authors,
        thumbnail: book.thumbnail,
        source: book.source,
        setAt: new Date().toISOString(),
        setBy: user.id,
      };
      await saveJSON(FILES.CLUB, club);

      const e = new EmbedBuilder()
        .setTitle(`Club Current Read: ${book.title}`)
        .setColor(GOLD)
        .setDescription(book.authors?.length ? `by ${book.authors.join(", ")}` : null);
      if (book.thumbnail) e.setThumbnail(book.thumbnail);
      if (book.previewLink) e.setURL(book.previewLink);

      await interaction.editReply({ embeds: [e] });
      if (DEBUG) console.log(`[book.set-club-current] "${book.title}" by ${user.username}`);
      return;
    }

    // ---------------------------------------------------------------------
    // /book leaderboard
    // ---------------------------------------------------------------------
    if (sub === "leaderboard") {
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
        return interaction.editReply({ content: "No progress to rank yet." });

      scores.sort((a, b) => b.pages - a.pages || b.comp - a.comp);
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

      const e = new EmbedBuilder()
        .setTitle(`🏆 Leaderboard — ${label}`)
        .setColor(RED)
        .setDescription(lines);

      await interaction.editReply({ embeds: [e] });
      if (DEBUG) console.log(`[book.leaderboard] by ${user.username}`);
      return;
    }

    // ---------------------------------------------------------------------
    // /book quote
    // ---------------------------------------------------------------------
    if (sub === "quote") {
      const text = interaction.options.getString("text", true).trim();
      const quotes = await loadJSON(FILES.QUOTES);
      quotes.misc = quotes.misc || [];
      quotes.misc.unshift({ text, by: user.id, at: new Date().toISOString() });
      await saveJSON(FILES.QUOTES, quotes);

      await interaction.editReply({ content: "🪶 Quote saved!" });
      if (DEBUG) console.log(`[book.quote] by ${user.username}`);
      return;
    }

    // ---------------------------------------------------------------------
    // /book my-quotes
    // ---------------------------------------------------------------------
    if (sub === "my-quotes") {
      const quotes = await loadJSON(FILES.QUOTES);
      const mine = [];
      for (const arr of Object.values(quotes)) {
        for (const q of arr) if (q.by === user.id) mine.push(q);
      }

      if (!mine.length)
        return interaction.editReply({ content: "No quotes yet." });

      mine.sort((a, b) => new Date(b.at) - new Date(a.at));
      const desc = mine
        .slice(0, 5)
        .map(
          (q, i) =>
            `**${i + 1}.** “${q.text}” — *${new Date(q.at).toLocaleString()}*`
        )
        .join("\n\n");

      const e = new EmbedBuilder()
        .setTitle("🪶 My Quotes")
        .setColor(PURPLE)
        .setDescription(desc);

      await interaction.editReply({ embeds: [e] });
      if (DEBUG) console.log(`[book.my-quotes] by ${user.username}`);
      return;
    }

    // ---------------------------------------------------------------------
    // /book schedule-add (mods only)
    // ---------------------------------------------------------------------
    if (sub === "schedule-add") {
      if (!isMod(interaction))
        return interaction.editReply({ content: "No permission." });

      const dateStr = interaction.options.getString("date", true).trim();
      const desc = interaction.options.getString("description", true).trim();

      const club = await loadJSON(FILES.CLUB);
      club.schedules = club.schedules || [];
      club.schedules.push({
        date: dateStr,
        description: desc,
        setBy: user.id,
        createdAt: new Date().toISOString(),
      });
      club.schedules = sortSchedules(club.schedules);
      await saveJSON(FILES.CLUB, club);

      const e = new EmbedBuilder()
        .setTitle("🗓️ Schedule Added")
        .setColor(GREEN)
        .setDescription(`**${dateStr}** — ${desc}`);

      await interaction.editReply({ embeds: [e] });
      if (DEBUG) console.log(`[book.schedule-add] by ${user.username}`);
      return;
    }

    // ---------------------------------------------------------------------
    // /book schedule-list
    // ---------------------------------------------------------------------
    if (sub === "schedule-list") {
      const club = await loadJSON(FILES.CLUB);
      const items = sortSchedules(club.schedules || []);

      if (!items.length)
        return interaction.editReply({ content: "No schedule items yet." });

      const lines = items
        .slice(0, 10)
        .map((s, i) => `**${i + 1}.** **${s.date}** — ${s.description}`)
        .join("\n");

      const e = new EmbedBuilder()
        .setTitle("🗓️ Upcoming Schedule")
        .setColor(CYAN)
        .setDescription(lines)
        .setFooter({ text: `Total items: ${items.length}` });

      await interaction.editReply({ embeds: [e] });
      if (DEBUG) console.log(`[book.schedule-list] by ${user.username}`);
      return;
    }

    // ---------------------------------------------------------------------
    // /book schedule-remove (mods only)
    // ---------------------------------------------------------------------
    if (sub === "schedule-remove") {
      if (!isMod(interaction))
        return interaction.editReply({ content: "No permission." });

      const index = interaction.options.getInteger("index", true);
      const club = await loadJSON(FILES.CLUB);
      club.schedules = sortSchedules(club.schedules || []);

      if (index < 1 || index > club.schedules.length)
        return interaction.editReply({ content: "Invalid index." });

      const removed = club.schedules.splice(index - 1, 1)[0];
      await saveJSON(FILES.CLUB, club);

      const e = new EmbedBuilder()
        .setTitle("🗓️ Schedule Removed")
        .setColor(RED)
        .setDescription(`**${removed.date}** — ${removed.description}`);

      await interaction.editReply({ embeds: [e] });
      if (DEBUG) console.log(`[book.schedule-remove] by ${user.username}`);
      return;
    }

    // ---------------------------------------------------------------------
    // Fallback
    // ---------------------------------------------------------------------
    await interaction.editReply({ content: "⚠️ Unknown subcommand." });
  } catch (err) {
    console.error(`[book.${sub}]`, err);
    // Use flags to ensure ephemeral fallback if needed
    const msg = { content: "⚠️ Something went wrong.", flags: 1 << 6 };
    if (interaction.deferred || interaction.replied)
      await interaction.editReply(msg);
    else await interaction.reply(msg);
  }
}

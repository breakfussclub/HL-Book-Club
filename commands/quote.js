// commands/quote.js — Consolidated Quote Command
// ✅ Subcommands: /quote add, /quote list
// ✅ Uses PostgreSQL (bc_quotes table)
// ✅ Merges functionality of quote.js and my-quotes.js

import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
} from "discord.js";
import { query } from "../utils/db.js";
import { EMBED_THEME } from "../utils/embedThemes.js";

const DEBUG = process.env.DEBUG === "true";

export const definitions = [
  new SlashCommandBuilder()
    .setName("quote")
    .setDescription("Manage your favorite book quotes")
    .addSubcommand((sub) =>
      sub.setName("add").setDescription("Add a new favorite quote")
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("View your saved quotes")
    ),
].map((c) => c.toJSON());

export async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "add") {
    await handleAdd(interaction);
  } else if (subcommand === "list") {
    await handleList(interaction);
  }
}

// ─────────────────────────────────────────────────────────────
//   ADD QUOTE (Modal)
// ─────────────────────────────────────────────────────────────

async function handleAdd(interaction) {
  const modal = new ModalBuilder()
    .setCustomId("quote_modal")
    .setTitle("Add a Favorite Quote");

  const quoteField = new TextInputBuilder()
    .setCustomId("quote_text")
    .setLabel("Quote")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("Enter the passage or quote")
    .setRequired(true);

  const bookField = new TextInputBuilder()
    .setCustomId("quote_book")
    .setLabel("Book Title")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("e.g., The Alchemist")
    .setRequired(true);

  const notesField = new TextInputBuilder()
    .setCustomId("quote_notes")
    .setLabel("Notes or context (optional)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(quoteField),
    new ActionRowBuilder().addComponents(bookField),
    new ActionRowBuilder().addComponents(notesField)
  );

  await interaction.showModal(modal);
}

// ─────────────────────────────────────────────────────────────
//   LIST QUOTES
// ─────────────────────────────────────────────────────────────

async function handleList(interaction) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply();
    }

    const userId = interaction.user.id;

    // Ensure user exists (though usually they should if they are using the bot)
    await query(`INSERT INTO bc_users (user_id, username) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`, [userId, interaction.user.username]);

    const res = await query(
      `SELECT * FROM bc_quotes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [userId]
    );
    const userQuotes = res.rows;

    if (!userQuotes.length) {
      return await interaction.editReply({
        content: "You don’t have any saved quotes yet. Use `/quote add` to save one!",
      });
    }

    const lines = userQuotes.map((q) => {
      const text = q.quote || "(no text)";
      const book = q.book_title || "—";
      const created = new Date(q.created_at);
      const time = `<t:${Math.floor(created.getTime() / 1000)}:R>`;
      const notes = q.notes ? `🗒️ *${q.notes.trim()}*\n` : "";

      return [`> "${text}"`, `📘 *${book}* • ${time}`, notes].join("\n");
    });

    const embed = new EmbedBuilder()
      .setColor(EMBED_THEME.primary)
      .setAuthor({
        name: "HL Book Club",
        iconURL: interaction.client.user.displayAvatarURL(),
      })
      .setTitle("🪶 My Saved Quotes")
      .setDescription(lines.join("\n\n"))
      .setFooter({
        text: `${userQuotes.length} recent quotes • ${EMBED_THEME.footer}`,
      });

    await interaction.editReply({ embeds: [embed] });

    if (DEBUG)
      console.log(`[quote] ${interaction.user.username} viewed quotes`);
  } catch (err) {
    console.error("[quote.list]", err);
    const msg = { content: "⚠️ Failed to load your quotes.", flags: 1 << 6 };
    if (interaction.deferred || interaction.replied)
      await interaction.editReply(msg);
    else await interaction.reply(msg);
  }
}

// ─────────────────────────────────────────────────────────────
//   MODAL HANDLER
// ─────────────────────────────────────────────────────────────

export async function handleModalSubmit(interaction) {
  if (interaction.customId !== "quote_modal") return false;

  try {
    const quote = interaction.fields.getTextInputValue("quote_text").trim();
    const book = interaction.fields.getTextInputValue("quote_book").trim();
    const notes = interaction.fields.getTextInputValue("quote_notes")?.trim() || "";

    if (!quote || !book) {
      await interaction.reply({ content: "⚠️ Please fill in both quote and book.", flags: 1 << 6 });
      return true;
    }

    const userId = interaction.user.id;

    // Ensure user exists
    await query(`INSERT INTO bc_users (user_id, username) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`, [userId, interaction.user.username]);

    // Insert quote
    await query(
      `INSERT INTO bc_quotes (user_id, quote, book_title, notes) VALUES ($1, $2, $3, $4)`,
      [userId, quote, book, notes]
    );

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("✅ Quote Added")
      .setDescription(`> "${quote}"\n\n— *${book}*${notes ? `\n📝 ${notes}` : ""}`);

    await interaction.reply({ embeds: [embed], flags: 1 << 6 });
    return true;
  } catch (err) {
    console.error("[quote.handleModalSubmit]", err);
    try {
      await interaction.reply({ content: "⚠️ Couldn't save quote.", flags: 1 << 6 });
    } catch { }
    return true;
  }
}

export const commandName = "quote";

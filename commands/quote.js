// commands/quote.js — Phase 9 update
// ✅ Adds Book Title field to quote modal
// ✅ Stores quote, book, and optional notes in quotes.json
// ✅ Uses modern flags for private confirmation

import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
} from "discord.js";
import { loadJSON, saveJSON, FILES } from "../utils/storage.js";

export const definitions = [
  new SlashCommandBuilder()
    .setName("quote")
    .setDescription("Add a favorite quote from a book"),
].map((c) => c.toJSON());

// Slash command: open modal
export async function execute(interaction) {
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

// Handle modal submit
export async function handleComponent(i) {
  if (!i.isModalSubmit() || i.customId !== "quote_modal") return;

  try {
    const quote = i.fields.getTextInputValue("quote_text").trim();
    const book = i.fields.getTextInputValue("quote_book").trim();
    const notes = i.fields.getTextInputValue("quote_notes")?.trim() || "";

    if (!quote || !book)
      return i.reply({ content: "⚠️ Please fill in both quote and book.", flags: 1 << 6 });

    const quotes = await loadJSON(FILES.QUOTES);
    quotes[i.user.id] = quotes[i.user.id] || [];
    quotes[i.user.id].unshift({
      quote,
      book,
      notes,
      addedAt: new Date().toISOString(),
    });
    await saveJSON(FILES.QUOTES, quotes);

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("✅ Quote Added")
      .setDescription(`> "${quote}"\n\n— *${book}*${notes ? `\n📝 ${notes}` : ""}`);

    await i.reply({ embeds: [embed], flags: 1 << 6 });
  } catch (err) {
    console.error("[quote.handleComponent]", err);
    try {
      await i.reply({ content: "⚠️ Couldn't save quote.", flags: 1 << 6 });
    } catch {}
  }
}

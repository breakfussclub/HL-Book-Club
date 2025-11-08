// commands/my-quotes.js — Phase 9 compatible (fixed for mixed schema)
// 🪶 Displays your saved quotes with backward compatibility
// ✅ Works with both {text, ...} and {quote, ...} formats

import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { loadJSON, FILES } from "../utils/storage.js";
import { EMBED_THEME } from "../utils/embedThemes.js";

const DEBUG = process.env.DEBUG === "true";

export const definitions = [
  new SlashCommandBuilder()
    .setName("my-quotes")
    .setDescription("Show your saved quotes"),
].map((c) => c.toJSON());

export async function execute(interaction) {
  try {
    const quotes = await loadJSON(FILES.QUOTES);
    const userQuotes = quotes[interaction.user.id] || [];

    if (!userQuotes.length) {
      return await interaction.editReply({
        content:
          "You don’t have any saved quotes yet. Use `/quote` to add one!",
      });
    }

    // Sort newest → oldest
    const sorted = [...userQuotes].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    const lines = sorted.slice(0, 10).map((q) => {
      const text = q.text || q.quote || "(no text)";
      const book = q.book || "—";
      const created = q.createdAt ? new Date(q.createdAt) : new Date();
      const time = `<t:${Math.floor(created.getTime() / 1000)}:R>`;
      const notes = q.notes ? `🗒️ *${q.notes.trim()}*\n` : "";

      return [`> ${text}`, `📘 *${book}* • ${time}`, notes].join("\n");
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
        text: `${userQuotes.length} total quotes • ${EMBED_THEME.footer}`,
      });

    await interaction.editReply({ embeds: [embed] });

    if (DEBUG)
      console.log(`[my-quotes] ${interaction.user.username} viewed quotes`);
  } catch (err) {
    console.error("[my-quotes.execute]", err);
    const msg = { content: "⚠️ Failed to load your quotes.", flags: 1 << 6 };
    if (interaction.deferred || interaction.replied)
      await interaction.editReply(msg);
    else await interaction.reply(msg);
  }
}

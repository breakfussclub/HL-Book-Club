// commands/my-quotes.js
// 🪶 Displays your saved quotes (formerly /book my-quotes)
// ✅ Uses unified theme + HL Book Club header
// ✅ Lists up to 10 recent quotes with timestamps

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

    const lines = sorted
      .slice(0, 10)
      .map(
        (q) =>
          `> ${q.text}\n📘 *${q.book || "—"}* • <t:${Math.floor(
            new Date(q.createdAt).getTime() / 1000
          )}:R>`
      );

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

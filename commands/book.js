// commands/book.js
// 📚 HL Book Club Menu
// ✅ Lightweight placeholder listing core Bookcord commands
// ✅ Uses unified purple theme + HL Book Club header

import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { EMBED_THEME } from "../utils/embedThemes.js";

export const definitions = [
  new SlashCommandBuilder()
    .setName("book")
    .setDescription("View available HL Book Club commands"),
].map((c) => c.toJSON());

export async function execute(interaction) {
  try {
    const embed = new EmbedBuilder()
      .setColor(EMBED_THEME.primary)
      .setAuthor({
        name: "HL Book Club",
        iconURL: interaction.client.user.displayAvatarURL(),
      })
      .setTitle("📚 HL Book Club Commands")
      .setDescription(
        [
          "• `/search` — Find and share books",
          "• `/leaderboard` — See top readers",
          "• `/quote` — Save a favorite quote",
          "• `/my-quotes` — View your saved quotes",
          "• `/my-stats` — View your personal reading stats",
          "",
          "Use these commands to explore and share your reading progress!",
        ].join("\n")
      )
      .setFooter({ text: EMBED_THEME.footer });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error("[book.execute]", err);
    const msg = { content: "⚠️ Failed to show command list.", flags: 1 << 6 };
    if (interaction.deferred || interaction.replied)
      await interaction.editReply(msg);
    else await interaction.reply(msg);
  }
}

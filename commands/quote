// commands/quote.js
// 💬 Save a quote (formerly /book quote)
// ✅ Uses unified theme + HL Book Club header
// ✅ Ephemeral confirmation to prevent channel clutter

import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { loadJSON, saveJSON, FILES } from "../utils/storage.js";
import { EMBED_THEME } from "../utils/embedThemes.js";

const DEBUG = process.env.DEBUG === "true";

export const definitions = [
  new SlashCommandBuilder()
    .setName("quote")
    .setDescription("Save a favorite quote from your reading")
    .addStringOption((o) =>
      o
        .setName("text")
        .setDescription("The quote text")
        .setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("book").setDescription("Optional book title")
    ),
].map((c) => c.toJSON());

export async function execute(interaction) {
  try {
    const text = interaction.options.getString("text", true);
    const book = interaction.options.getString("book") || "—";

    const quotes = await loadJSON(FILES.QUOTES);
    if (!quotes[interaction.user.id]) quotes[interaction.user.id] = [];

    quotes[interaction.user.id].push({
      text,
      book,
      createdAt: new Date().toISOString(),
    });

    await saveJSON(FILES.QUOTES, quotes);

    // ✅ Confirmation embed (ephemeral)
    const embed = new EmbedBuilder()
      .setColor(EMBED_THEME.success)
      .setAuthor({
        name: "HL Book Club",
        iconURL: interaction.client.user.displayAvatarURL(),
      })
      .setTitle("✅ Quote Saved")
      .setDescription(`> ${text}`)
      .addFields({ name: "Book", value: book })
      .setFooter({ text: EMBED_THEME.footer });

    await interaction.editReply({ embeds: [embed] });

    if (DEBUG)
      console.log(`[quote] ${interaction.user.username} saved quote: ${text}`);
  } catch (err) {
    console.error("[quote.execute]", err);
    const msg = { content: "⚠️ Couldn't save your quote.", flags: 1 << 6 };
    if (interaction.deferred || interaction.replied)
      await interaction.editReply(msg);
    else await interaction.reply(msg);
  }
}

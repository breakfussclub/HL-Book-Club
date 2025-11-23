// commands/help.js
// 📚 HL Book Club Menu
// ✅ Lists all available commands
// ✅ Uses unified purple theme + HL Book Club header

import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { EMBED_THEME } from "../utils/embedThemes.js";

export const definitions = [
    new SlashCommandBuilder()
        .setName("help")
        .setDescription("View available HL Book Club commands"),
].map((c) => c.toJSON());

export async function execute(interaction) {
    try {
        await interaction.deferReply();
        const embed = new EmbedBuilder()
            .setColor(EMBED_THEME.primary)
            .setAuthor({
                name: "HL Book Club",
                iconURL: interaction.client.user.displayAvatarURL(),
            })
            .setTitle("📚 HL Book Club Commands")
            .setDescription(
                [
                    "**Reading Tracker**",
                    "• `/tracker list` — View your reading list",
                    "• `/tracker stats` — View your reading stats",
                    "",
                    "**Book Club**",
                    "• `/bookclub current` — View current pick",
                    "• `/bookclub picks` — Vote on nominations",
                    "• `/bookclub nominate` — Nominate a book",
                    "",
                    "**Community**",
                    "• `/leaderboard` — See top readers",
                    "• `/recommend` — Get book recommendations",
                    "• `/profile` — View your profile",
                    "",
                    "**Tools**",
                    "• `/search` — Find books",
                    "• `/quote add` — Save a favorite quote",
                    "• `/quote list` — View your saved quotes",
                    "• `/goodreads link` — Sync with Goodreads",
                ].join("\n")
            )
            .setFooter({ text: EMBED_THEME.footer });

        await interaction.editReply({ embeds: [embed] });
    } catch (err) {
        console.error("[help.execute]", err);
        const msg = { content: "⚠️ Failed to show command list.", flags: 1 << 6 };
        if (interaction.deferred || interaction.replied)
            await interaction.editReply(msg);
        else await interaction.reply(msg);
    }
}

export const commandName = "help";

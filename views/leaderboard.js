import { EmbedBuilder } from "discord.js";
import { EMBED_THEME } from "../utils/embedThemes.js";

export function leaderboardEmbed(interaction, scores, range) {
    const medals = ["🥇", "🥈", "🥉"];
    const label =
        range === "week" ? "This Week" : range === "month" ? "This Month" : "All Time";

    if (!scores.length) {
        return new EmbedBuilder()
            .setTitle(`🏆 Leaderboard — ${label}`)
            .setColor(EMBED_THEME.gold)
            .setDescription("No reading activity recorded yet for this period.")
            .setFooter({ text: EMBED_THEME.footer });
    }

    const lines = scores
        .slice(0, 10)
        .map(
            (s, i) =>
                `${medals[i] || `#${i + 1}`} <@${s.userId}> — **${s.pages} pages**${s.completed ? ` • ${s.completed} completed` : ""
                }`
        )
        .join("\n");

    return new EmbedBuilder()
        .setTitle(`🏆 Leaderboard — ${label}`)
        .setColor(EMBED_THEME.gold)
        .setAuthor({
            name: "HL Book Club",
            iconURL: interaction.client.user.displayAvatarURL(),
        })
        .setDescription(lines)
        .setFooter({ text: EMBED_THEME.footer });
}

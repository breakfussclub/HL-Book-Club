import { EmbedBuilder } from "discord.js";
import { EMBED_THEME } from "../utils/embedThemes.js";

function createProgressBar(percentage, length = 15) {
    const filled = Math.round((percentage / 100) * length);
    const empty = length - filled;
    return "▰".repeat(filled) + "▱".repeat(empty);
}

function generateBadges(stats) {
    const badges = [];
    if (stats.booksTracked >= 10) badges.push("📚 **Bookworm**");
    if (stats.quotesSaved >= 5) badges.push("💬 **Quote Keeper**");
    if (stats.favorites >= 10) badges.push("❤️ **Curator**");
    if (stats.pagesRead >= 1000) badges.push("🏆 **Page Turner**");

    if (stats.goal) {
        const percentage = Math.round((stats.completedThisYear / stats.goal.bookCount) * 100);
        if (percentage >= 100) badges.push("🎯 **Goal Crusher**");
        else if (percentage >= 75) badges.push("🎯 **Nearly There**");
    }

    if (badges.length === 0) badges.push("✨ **Getting Started**");
    return badges.join(" • ");
}

export function buildProfileEmbed(interaction, target, stats) {
    const theme = EMBED_THEME.HL_BOOK_CLUB || { color: 0x9b59b6 };
    const badges = generateBadges(stats);

    // Build description body
    const descLines = [
        `**Books Tracked:** ${stats.booksTracked}`,
        `**Pages Read:** ${stats.pagesRead.toLocaleString()}`,
        `**Quotes Saved:** ${stats.quotesSaved}`,
        `**Favorites:** ${stats.favorites}`,
    ];

    // Add goal progress if exists
    if (stats.goal) {
        const percentage = Math.min(100, Math.round((stats.completedThisYear / stats.goal.bookCount) * 100));
        const progressBar = createProgressBar(percentage);
        descLines.push(
            `\n**📖 ${stats.goal.year} Reading Goal:**`,
            `${progressBar} ${stats.completedThisYear}/${stats.goal.bookCount} (${percentage}%)`
        );
    }

    const recentSection =
        stats.recentBooks.length > 0
            ? "\n**📖 Recent Reads:**\n" +
            stats.recentBooks
                .map(
                    (b) =>
                        `• [${b.title || "Untitled"}](${b.previewLink ||
                        `https://www.google.com/search?q=${encodeURIComponent(
                            b.title || ""
                        )}`
                        })${b.author ? ` by ${b.author}` : ""}`
                )
                .join("\n")
            : "";

    const quoteSection = stats.favoriteQuote
        ? `\n**🪶 Favorite Quote:**\n"${stats.favoriteQuote.slice(0, 150)}${stats.favoriteQuote.length > 150 ? '...' : ''}"`
        : "";

    return new EmbedBuilder()
        .setColor(theme.color)
        .setTitle(`📘 ${target.username}'s HL Book Club Profile`)
        .setThumbnail(target.displayAvatarURL({ dynamic: true, size: 256 }))
        .setDescription(`${descLines.join("\n")}${recentSection}${quoteSection}`)
        .addFields({
            name: "🏅 Achievements",
            value: badges,
            inline: false,
        })
        .setFooter({
            text: "HL Book Club • Higher-er Learning",
            iconURL: interaction.client.user.displayAvatarURL(),
        });
}

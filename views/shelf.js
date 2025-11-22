import {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
} from "discord.js";
import { EMBED_THEME } from "../utils/embedThemes.js";

const BOOKS_PER_PAGE = 8;

function formatDate(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d)) return "Unknown date";
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const y = String(d.getFullYear()).slice(-2);
    return `${m}/${day}/${y}`;
}

export function buildShelfEmbed(
    books,
    userFilter,
    statusFilter,
    sortType,
    viewMode,
    page,
    interaction,
    totalCount
) {
    const theme = EMBED_THEME?.HL_BOOK_CLUB || { color: 0x9b59b6 };
    const totalPages = Math.ceil(totalCount / BOOKS_PER_PAGE);

    if (!books.length) {
        const filterLabel = {
            mine: "your",
            all: "the community",
        }[userFilter] || "this user's";

        const statusLabel = {
            reading: "reading",
            completed: "completed",
            planned: "planned",
            all: "",
        }[statusFilter];

        return new EmbedBuilder()
            .setColor(theme.color)
            .setTitle("📚 Bookshelf")
            .setDescription(
                `No ${statusLabel} books found in ${filterLabel} shelf.\n\n` +
                "Try a different filter or add some books!"
            )
            .setFooter({ text: "HL Book Club • Higher-er Learning" });
    }

    // Group view
    if (viewMode === "grouped") {
        const lines = books.map((book) => {
            const readerCount = parseInt(book.reader_count || 0);
            // Note: In SQL version, we might need to fetch readers separately or aggregate them
            // For now, assuming book object has reader info or we format it differently

            // If we don't have detailed reader list in the main query, we might simplify the display
            // or we need to aggregate reader names in the SQL query (e.g. array_agg)

            const readers = book.readers || []; // Expecting array of names/ids from DB aggregation
            const readerList =
                readers.length <= 3
                    ? readers.map((r) => `<@${r}>`).join(", ")
                    : `<@${readers[0]}> +${readers.length - 1} more`;

            return `[**${book.title}**](${book.preview_link || ""})\n> **By ${book.author}**\n   👥 ${readerCount} reader${readerCount > 1 ? "s" : ""}: ${readerList}`;
        });

        return new EmbedBuilder()
            .setColor(theme.color)
            .setTitle("📚 HL Book Club — Bookshelf (Grouped)")
            .setDescription(lines.join("\n\n"))
            .setFooter({
                text: `Page ${page + 1}/${totalPages} • ${totalCount} unique books • HL Book Club`,
            });
    }

    // List view
    const lines = books.map((b) => {
        const userTag = b.user_id ? `<@${b.user_id}>` : "Unknown";
        const date = formatDate(b.started_at || b.updated_at);
        const title = b.title.length > 60 ? b.title.slice(0, 57) + "..." : b.title;

        const statusEmoji = {
            reading: "📖",
            completed: "✅",
            planned: "📚",
        }[b.status] || "📖";

        const progress =
            b.total_pages > 0
                ? ` • ${Math.round((b.current_page / b.total_pages) * 100)}%`
                : "";

        // Use preview_link from DB or fallback
        const link = b.thumbnail || `https://www.google.com/search?q=${encodeURIComponent(b.title)}`;

        return `${statusEmoji} [**${title}**](${link})\n> **By ${b.author}** • ${userTag} • ${date}${progress}`;
    });

    const filterLabel = userFilter === "mine" ? "Your" : "Community";
    const statusLabel = {
        reading: " (Reading)",
        completed: " (Completed)",
        planned: " (Planned)",
        all: "",
    }[statusFilter];

    return new EmbedBuilder()
        .setColor(theme.color)
        .setTitle(`📚 ${filterLabel} Bookshelf${statusLabel}`)
        .setDescription(lines.join("\n\n"))
        .setFooter({
            text: `Page ${page + 1}/${totalPages} • ${totalCount} books • HL Book Club`,
        });
}

export function buildComponents(userFilter, statusFilter, sortType, viewMode, page, totalCount) {
    const totalPages = Math.ceil(totalCount / BOOKS_PER_PAGE);
    const rows = [];

    // Row 1: User filter buttons
    rows.push(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`shelf_user_mine_${statusFilter}_${sortType}_${viewMode}_0`)
                .setLabel("👤 My Books")
                .setStyle(userFilter === "mine" ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`shelf_user_all_${statusFilter}_${sortType}_${viewMode}_0`)
                .setLabel("👥 All Members")
                .setStyle(userFilter === "all" ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`shelf_view_${userFilter}_${statusFilter}_${sortType}`)
                .setLabel(viewMode === "grouped" ? "📋 List View" : "📚 Group View")
                .setStyle(ButtonStyle.Secondary)
        )
    );

    // Row 2: Status filter buttons
    rows.push(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`shelf_status_reading_${userFilter}_${sortType}_${viewMode}_0`)
                .setLabel("📖 Reading")
                .setStyle(statusFilter === "reading" ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`shelf_status_completed_${userFilter}_${sortType}_${viewMode}_0`)
                .setLabel("✅ Completed")
                .setStyle(statusFilter === "completed" ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`shelf_status_planned_${userFilter}_${sortType}_${viewMode}_0`)
                .setLabel("📚 Planned")
                .setStyle(statusFilter === "planned" ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`shelf_status_all_${userFilter}_${sortType}_${viewMode}_0`)
                .setLabel("🌟 All")
                .setStyle(statusFilter === "all" ? ButtonStyle.Secondary : ButtonStyle.Secondary)
        )
    );

    // Row 3: Sort dropdown
    rows.push(
        new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`shelf_sort_${userFilter}_${statusFilter}_${viewMode}`)
                .setPlaceholder("Sort by...")
                .setOptions([
                    new StringSelectMenuOptionBuilder()
                        .setLabel("Recently Updated")
                        .setValue("recent")
                        .setEmoji("🕐")
                        .setDefault(sortType === "recent"),
                    new StringSelectMenuOptionBuilder()
                        .setLabel("Most Popular")
                        .setValue("popular")
                        .setEmoji("⭐")
                        .setDefault(sortType === "popular"),
                    new StringSelectMenuOptionBuilder()
                        .setLabel("Title (A-Z)")
                        .setValue("title")
                        .setEmoji("🔤")
                        .setDefault(sortType === "title"),
                    new StringSelectMenuOptionBuilder()
                        .setLabel("Date Added")
                        .setValue("added")
                        .setEmoji("📅")
                        .setDefault(sortType === "added"),
                ])
        )
    );

    // Row 4: Pagination
    if (totalPages > 1) {
        const navRow = new ActionRowBuilder();

        if (page > 0) {
            navRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(
                        `shelf_page_${userFilter}_${statusFilter}_${sortType}_${viewMode}_${page - 1}`
                    )
                    .setLabel("◀ Previous")
                    .setStyle(ButtonStyle.Secondary)
            );
        }

        if (page < totalPages - 1) {
            navRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(
                        `shelf_page_${userFilter}_${statusFilter}_${sortType}_${viewMode}_${page + 1}`
                    )
                    .setLabel("Next ▶")
                    .setStyle(ButtonStyle.Secondary)
            );
        }

        if (navRow.components.length > 0) {
            rows.push(navRow);
        }
    }

    return rows;
}

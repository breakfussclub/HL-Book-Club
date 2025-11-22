import {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} from "discord.js";

const PURPLE = 0x8b5cf6;
const GOLD = 0xf59e0b;
const BOOKS_PER_PAGE = 10;

// ===== Utility helpers =====
const progressBarPages = (current, total, width = 18) => {
    if (!total || total <= 0) return "";
    const pct = Math.min(1, Math.max(0, current / total));
    const filled = Math.round(pct * width);
    return "▰".repeat(filled) + "▱".repeat(width - filled);
};

const fmtTime = (d) => new Date(d).toLocaleString();

// ===== Embeds =====

export function listEmbed(username, books, filterType = "reading", sortType = "recent", page = 0, totalCount = 0) {
    const totalPages = Math.ceil(totalCount / BOOKS_PER_PAGE);
    const start = page * BOOKS_PER_PAGE;

    const filterEmoji = {
        reading: "📖",
        completed: "✅",
        planned: "📚",
        all: "🌟",
    };

    const e = new EmbedBuilder()
        .setTitle(`${filterEmoji[filterType]} ${username}'s Trackers`)
        .setColor(PURPLE);

    if (!books.length) {
        const emptyMsg = {
            reading: "You're not currently reading any books.\n\nAdd a book or sync from Goodreads!",
            completed: "You haven't completed any books yet.\n\nKeep reading! 📖",
            planned: "You don't have any planned books.\n\nAdd some to your reading list!",
            all: "You aren't tracking any books yet.\n\nClick **Add Book** below to start.",
        };
        e.setDescription(emptyMsg[filterType] || emptyMsg.all);
        return e;
    }

    const lines = books
        .map((t, idx) => {
            const globalIdx = start + idx + 1;
            const cp = Number(t.current_page || 0);
            const tp = Number(t.total_pages || 0); // Note: DB column names
            const bar = tp ? `${progressBarPages(cp, tp)} ` : "";
            const pct = tp ? ` (${Math.round((cp / tp) * 100)}%)` : "";
            const author = t.author ? ` — *${t.author}*` : "";
            const statusEmoji = {
                reading: "📖",
                completed: "✅",
                planned: "📚",
            }[t.status] || "";

            return `**${globalIdx}.** ${t.title}${author}\n   ${bar}Page ${cp}${tp ? `/${tp}${pct}` : ""
                } ${statusEmoji}`;
        })
        .join("\n\n");

    e.setDescription(lines);

    const sortLabel = {
        recent: "Recently Updated",
        title: "Title (A-Z)",
        progress: "Progress %",
        added: "Date Added",
    }[sortType] || "Recently Updated";

    e.setFooter({
        text: `Page ${page + 1}/${totalPages || 1} • ${totalCount} books • Sorted by: ${sortLabel}`,
    });

    return e;
}

export function detailEmbed(t, logs, stats) {
    const e = new EmbedBuilder()
        .setTitle(`📖 ${t.title}`)
        .setColor(GOLD);

    if (t.author) e.addFields({ name: "Author", value: t.author, inline: true });
    if (t.status) {
        const statusLabel = {
            reading: "📖 Reading",
            completed: "✅ Completed",
            planned: "📚 Planned",
        }[t.status] || t.status;
        e.addFields({ name: "Status", value: statusLabel, inline: true });
    }

    const tp = Number(t.total_pages || 0);
    if (tp)
        e.addFields({
            name: "Total Pages",
            value: String(tp),
            inline: true,
        });

    const cp = Number(t.current_page || 0);

    if (tp) {
        const pct = Math.round((cp / tp) * 100);
        const bar = progressBarPages(cp, tp);
        e.addFields({
            name: "Progress",
            value: `${bar} ${pct}%\nPage ${cp}/${tp}`,
            inline: false,
        });
    } else if (cp > 0) {
        e.addFields({
            name: "Progress",
            value: `Page ${cp}`,
            inline: false,
        });
    }

    if (stats?.avgPages) {
        e.addFields({
            name: "📊 Stats",
            value:
                `Avg: ${stats.avgPages.toFixed(1)} pages/session\n` +
                `Last update: ${fmtTime(t.updated_at || t.started_at)}`,
            inline: false,
        });
    }

    const recentLogs = (logs || []).slice(-3).reverse();
    if (recentLogs.length) {
        e.addFields({
            name: "Recent Logs",
            value: recentLogs
                .map((l) => `• +${l.pagesRead} pages on ${fmtTime(l.timestamp)}`)
                .join("\n"),
            // Note: logs structure might need adjustment depending on how we fetch them
            inline: false,
        });
    }

    return e;
}

// ===== Components =====

export function listComponents(books, filterType = "reading", sortType = "recent", page = 0, totalCount = 0) {
    const totalPages = Math.ceil(totalCount / BOOKS_PER_PAGE);
    const rows = [];

    // Filter buttons
    rows.push(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`trk_filter_reading_${sortType}_0`)
                .setLabel("📖 Reading")
                .setStyle(filterType === "reading" ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`trk_filter_completed_${sortType}_0`)
                .setLabel("✅ Completed")
                .setStyle(filterType === "completed" ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`trk_filter_planned_${sortType}_0`)
                .setLabel("📚 Planned")
                .setStyle(filterType === "planned" ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`trk_filter_all_${sortType}_0`)
                .setLabel("🌟 All")
                .setStyle(filterType === "all" ? ButtonStyle.Secondary : ButtonStyle.Secondary)
        )
    );

    // Sort dropdown
    rows.push(
        new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`trk_sort_${filterType}`)
                .setPlaceholder(`Sort: ${sortType === "recent" ? "Recently Updated" : sortType === "title" ? "Title" : sortType === "progress" ? "Progress" : "Date Added"}`)
                .setOptions([
                    new StringSelectMenuOptionBuilder()
                        .setLabel("Recently Updated")
                        .setValue("recent")
                        .setEmoji("🕐")
                        .setDefault(sortType === "recent"),
                    new StringSelectMenuOptionBuilder()
                        .setLabel("Title (A-Z)")
                        .setValue("title")
                        .setEmoji("🔤")
                        .setDefault(sortType === "title"),
                    new StringSelectMenuOptionBuilder()
                        .setLabel("Progress %")
                        .setValue("progress")
                        .setEmoji("📊")
                        .setDefault(sortType === "progress"),
                    new StringSelectMenuOptionBuilder()
                        .setLabel("Date Added")
                        .setValue("added")
                        .setEmoji("📅")
                        .setDefault(sortType === "added"),
                ])
        )
    );

    // Book selector dropdown
    if (books.length) {
        const usedValues = new Set();
        const start = page * BOOKS_PER_PAGE;

        const options = books.map((t, idx) => {
            // Use book_id from DB
            let safeId = String(t.book_id);

            if (safeId.length > 90 || usedValues.has(safeId)) {
                // Fallback if IDs are too long or duplicate (shouldn't happen with DB IDs)
                safeId = `idx_${start + idx}_${Date.now().toString(36).slice(-6)}`;
            }

            usedValues.add(safeId);

            return new StringSelectMenuOptionBuilder()
                .setLabel(t.title.slice(0, 100))
                .setValue(safeId)
                .setDescription(
                    `Page ${Number(t.current_page || 0)}${t.total_pages ? `/${t.total_pages}` : ""
                    }`
                );
        });

        rows.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`trk_select_${filterType}_${sortType}`)
                    .setPlaceholder("Select a book to view details…")
                    .setOptions(options)
            )
        );
    }

    // Pagination buttons
    if (totalPages > 1) {
        const navRow = new ActionRowBuilder();

        if (page > 0) {
            navRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`trk_filter_${filterType}_${sortType}_${page - 1}`)
                    .setLabel("◀ Previous")
                    .setStyle(ButtonStyle.Secondary)
            );
        }

        if (page < totalPages - 1) {
            navRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`trk_filter_${filterType}_${sortType}_${page + 1}`)
                    .setLabel("Next ▶")
                    .setStyle(ButtonStyle.Secondary)
            );
        }

        if (navRow.components.length > 0) {
            rows.push(navRow);
        }
    }

    // Add Book button
    rows.push(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("trk_add_modal")
                .setLabel("Add Book")
                .setStyle(ButtonStyle.Success)
        )
    );

    return rows;
}

export function detailComponents(bookId) {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`trk_update_${bookId}`)
                .setLabel("Update Progress")
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`trk_complete_${bookId}`)
                .setLabel("Mark Complete")
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`trk_delete_${bookId}`)
                .setLabel("Remove")
                .setStyle(ButtonStyle.Danger)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("trk_back_to_list")
                .setLabel("← Back to List")
                .setStyle(ButtonStyle.Secondary)
        ),
    ];
}

// ===== Modals =====

export function addBookModal() {
    const modal = new ModalBuilder()
        .setCustomId("trk_add_submit")
        .setTitle("Add New Book");

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId("book_title")
                .setLabel("Book Title")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId("book_author")
                .setLabel("Author (optional)")
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId("book_pages")
                .setLabel("Total Pages (optional)")
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
        )
    );
    return modal;
}

export function updateProgressModal(bookId) {
    const modal = new ModalBuilder()
        .setCustomId(`trk_update_submit_${bookId}`)
        .setTitle("Update Progress");

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId("new_page")
                .setLabel("Current Page")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
        )
    );
    return modal;
}

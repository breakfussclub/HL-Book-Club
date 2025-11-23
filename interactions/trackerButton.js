// interactions/trackerButton.js
// Handles "Add to My Tracker" button clicks
// ✅ Auto-adds book to tracker without modal
// ✅ Uses PostgreSQL

import { query } from "../utils/db.js";
import { EmbedBuilder } from "discord.js";

const GREEN = 0x16a34a;
const DEBUG = process.env.DEBUG === "true";

export async function handleTrackerButton(interaction) {
  try {
    // The book embed should be attached to the message
    const embed = interaction.message.embeds?.[0];
    if (!embed) {
      return interaction.reply({
        content: "⚠️ No book data found.",
        ephemeral: true,
      });
    }

    // Extract minimal info from the embed
    // Use URL (Google Books ID usually) or Title as ID
    // If URL is a full URL, we might want to hash it or just use it if it fits.
    // bc_books.book_id is VARCHAR(255).
    let bookId = embed.url || embed.title;
    // Sanitize ID if it's a URL to be shorter if needed, but 255 chars is usually enough for Google Books URLs.
    // Ideally we extract the ID from the URL if possible, but for now let's use what we have.

    const title = embed.title || "Untitled";
    let authors = [];

    // Try to parse author field if present
    const authorsField = embed.fields?.find((f) => f.name === "Authors");
    if (authorsField && authorsField.value)
      authors = authorsField.value.split(",").map((s) => s.trim());

    const authorStr = authors.join(", ");
    const pageCount = 0; // Default since we might not have it in embed easily or parsed

    const userId = interaction.user.id;

    // Ensure user exists
    await query(`INSERT INTO bc_users (user_id, username) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`, [userId, interaction.user.username]);

    // Check if already tracked
    const check = await query(`SELECT 1 FROM bc_reading_logs WHERE user_id = $1 AND book_id = $2`, [userId, bookId]);

    if (check.rowCount > 0) {
      await interaction.reply({
        content: `⚠️ *${title}* is already in your tracker.`,
        ephemeral: true,
      });
      return;
    }

    // Ensure book exists in bc_books
    await query(`
      INSERT INTO bc_books (book_id, title, author, page_count, thumbnail)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (book_id) DO UPDATE SET
        title = EXCLUDED.title,
        author = EXCLUDED.author,
        thumbnail = EXCLUDED.thumbnail
    `, [bookId, title, authorStr, pageCount, embed.thumbnail?.url || null]);

    // Add to reading logs
    await query(`
      INSERT INTO bc_reading_logs (user_id, book_id, status, current_page, total_pages, started_at, updated_at)
      VALUES ($1, $2, 'reading', 0, $3, NOW(), NOW())
    `, [userId, bookId, pageCount]);

    const confirm = new EmbedBuilder()
      .setTitle(`✅ Added to Your Tracker`)
      .setDescription(`**${title}**`)
      .setColor(GREEN);

    await interaction.reply({ embeds: [confirm], ephemeral: true });

    if (DEBUG)
      console.log(
        `[trackerButton] ${interaction.user.username} added "${title}"`
      );
  } catch (err) {
    console.error("[trackerButton]", err);
    await interaction.reply({
      content: "⚠️ Something went wrong while adding to your tracker.",
      ephemeral: true,
    });
  }
}

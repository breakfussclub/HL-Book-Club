// interactions/trackerButton.js
// Handles "Add to My Tracker" button clicks
// ✅ Auto-adds book to tracker without modal

import { loadJSON, saveJSON, FILES } from "../utils/storage.js";
import { EmbedBuilder } from "discord.js";

const GREEN = 0x16a34a;
const YELLOW = 0xfacc15;
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
    const book = {
      id: embed.url || embed.title,
      title: embed.title || "Untitled",
      authors: [],
      pageCount: 0,
      status: "current",
      progress: 0,
      addedAt: new Date().toISOString(),
    };

    // Try to parse author field if present
    const authorsField = embed.fields?.find((f) => f.name === "Authors");
    if (authorsField && authorsField.value)
      book.authors = authorsField.value.split(",").map((s) => s.trim());

    // Load trackers file
    const trackers = await loadJSON(FILES.TRACKERS);
    if (!trackers[interaction.user.id])
      trackers[interaction.user.id] = { tracked: [] };

    const userTracker = trackers[interaction.user.id].tracked;

    // Check for duplicates
    const exists = userTracker.some(
      (b) => b.title.toLowerCase() === book.title.toLowerCase()
    );

    if (exists) {
      await interaction.reply({
        content: `⚠️ *${book.title}* is already in your tracker.`,
        ephemeral: true,
      });
      return;
    }

    // Add and save
    userTracker.push(book);
    await saveJSON(FILES.TRACKERS, trackers);

    const confirm = new EmbedBuilder()
      .setTitle(`✅ Added to Your Tracker`)
      .setDescription(`**${book.title}**`)
      .setColor(GREEN);

    await interaction.reply({ embeds: [confirm], ephemeral: true });

    if (DEBUG)
      console.log(
        `[trackerButton] ${interaction.user.username} added "${book.title}"`
      );
  } catch (err) {
    console.error("[trackerButton]", err);
    await interaction.reply({
      content: "⚠️ Something went wrong while adding to your tracker.",
      ephemeral: true,
    });
  }
}

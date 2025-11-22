import fs from 'fs/promises';
import path from 'path';
import { initDB, query, getClient } from '../utils/db.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

// Define file paths (matching utils/storage.js)
const DATA_DIR = config.storage.dataDir;
const FILES = {
    TRACKERS: path.join(DATA_DIR, "trackers.json"),
    STATS: path.join(DATA_DIR, "stats.json"),
    GOODREADS_LINKS: path.join(DATA_DIR, "goodreads_links.json"),
    CLUB: path.join(DATA_DIR, "club.json"),
};

async function loadJSON(filePath) {
    try {
        const rawData = await fs.readFile(filePath, "utf8");
        return JSON.parse(rawData);
    } catch (error) {
        logger.warn(`Could not read ${filePath}: ${error.message}`);
        return null;
    }
}

async function migrateUsers(client, stats) {
    if (!stats) return;

    logger.info('Migrating users...');
    let count = 0;

    for (const [userId, userStats] of Object.entries(stats)) {
        // Insert into bc_users
        await client.query(`
      INSERT INTO bc_users (user_id, username, joined_at, last_active, stats)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id) DO UPDATE SET
        stats = EXCLUDED.stats,
        last_active = EXCLUDED.last_active
    `, [
            userId,
            userStats.username || 'Unknown',
            userStats.joinedAt || new Date(),
            userStats.lastActive || new Date(),
            JSON.stringify(userStats)
        ]);
        count++;
    }
    logger.info(`Migrated ${count} users.`);
}

async function migrateGoodreadsLinks(client, links) {
    if (!links) return;

    logger.info('Migrating Goodreads links...');
    let count = 0;

    for (const [userId, linkData] of Object.entries(links)) {
        // Ensure user exists first (FK constraint)
        await client.query(`
      INSERT INTO bc_users (user_id, username)
      VALUES ($1, $2)
      ON CONFLICT (user_id) DO NOTHING
    `, [userId, 'Unknown']);

        await client.query(`
      INSERT INTO bc_goodreads_links (user_id, goodreads_user_id, last_sync, sync_results)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id) DO UPDATE SET
        goodreads_user_id = EXCLUDED.goodreads_user_id,
        last_sync = EXCLUDED.last_sync,
        sync_results = EXCLUDED.sync_results
    `, [
            userId,
            linkData.goodreadsUserId,
            linkData.lastSync || null,
            JSON.stringify(linkData.syncResults || {})
        ]);
        count++;
    }
    logger.info(`Migrated ${count} Goodreads links.`);
}

async function migrateTrackers(client, trackers) {
    if (!trackers) return;

    logger.info('Migrating reading logs (trackers)...');
    let count = 0;

    for (const [userId, userData] of Object.entries(trackers)) {
        if (!userData.tracked || !Array.isArray(userData.tracked)) continue;

        // Ensure user exists
        await client.query(`
      INSERT INTO bc_users (user_id, username)
      VALUES ($1, $2)
      ON CONFLICT (user_id) DO NOTHING
    `, [userId, 'Unknown']);

        for (const book of userData.tracked) {
            // 1. Insert/Update Book Metadata (bc_books)
            // We use title+author as a pseudo-unique key if no ID, but ideally we'd have an ISBN or GR ID.
            // For migration, we'll generate a deterministic ID if missing.
            const bookId = book.goodreadsId || `manual_${Buffer.from(book.title + (book.author || '')).toString('base64').substring(0, 20)}`;

            await client.query(`
        INSERT INTO bc_books (book_id, title, author, description, thumbnail, page_count)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (book_id) DO NOTHING
      `, [
                bookId,
                book.title,
                book.author,
                book.description,
                book.thumbnail,
                book.totalPages
            ]);

            // 2. Insert Reading Log (bc_reading_logs)
            await client.query(`
        INSERT INTO bc_reading_logs (
          user_id, book_id, status, current_page, total_pages, 
          started_at, completed_at, rating, source, goodreads_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (user_id, book_id) DO UPDATE SET
          status = EXCLUDED.status,
          current_page = EXCLUDED.current_page,
          completed_at = EXCLUDED.completed_at,
          rating = EXCLUDED.rating
      `, [
                userId,
                bookId,
                book.status, // 'reading', 'completed', etc.
                book.currentPage || 0,
                book.totalPages || 0,
                book.startedAt || null,
                book.completedAt || null,
                book.rating || null,
                book.source || 'manual',
                book.goodreadsId
            ]);
            count++;
        }
    }
    logger.info(`Migrated ${count} reading log entries.`);
}

async function runMigration() {
    logger.info('Starting migration from JSON to PostgreSQL...');

    // 1. Initialize DB (create tables)
    await initDB();

    // 2. Load JSON data
    const stats = await loadJSON(FILES.STATS);
    const links = await loadJSON(FILES.GOODREADS_LINKS);
    const trackers = await loadJSON(FILES.TRACKERS);

    const client = await getClient();

    try {
        await client.query('BEGIN');

        await migrateUsers(client, stats);
        await migrateGoodreadsLinks(client, links);
        await migrateTrackers(client, trackers);

        await client.query('COMMIT');
        logger.info('Migration completed successfully!');
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Migration failed, rolled back changes.', error);
        process.exit(1);
    } finally {
        client.release();
        process.exit(0);
    }
}

runMigration();

import pg from 'pg';
import { config } from '../config.js';
import { logger } from './logger.js';

const { Pool } = pg;

// Initialize pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for Railway/Heroku in many cases
  }
});

pool.on('error', (err) => {
  logger.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Schema definition with bc_ prefix
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS bc_users (
    user_id VARCHAR(255) PRIMARY KEY,
    username VARCHAR(255),
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_active TIMESTAMP WITH TIME ZONE,
    stats JSONB DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS bc_books (
    book_id VARCHAR(255) PRIMARY KEY,
    title TEXT NOT NULL,
    author TEXT,
    description TEXT,
    thumbnail TEXT,
    page_count INTEGER,
    published_date VARCHAR(50),
    average_rating NUMERIC(3, 2),
    isbn VARCHAR(20)
  );

  CREATE TABLE IF NOT EXISTS bc_reading_logs (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) REFERENCES bc_users(user_id),
    book_id VARCHAR(255), -- Not strictly enforcing FK to bc_books to allow flexible tracking if needed, but ideally should.
    status VARCHAR(50), -- 'reading', 'completed', 'planned', 'dropped'
    current_page INTEGER DEFAULT 0,
    total_pages INTEGER DEFAULT 0,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    rating INTEGER,
    review TEXT,
    goodreads_id VARCHAR(255),
    source VARCHAR(50) DEFAULT 'manual',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, book_id)
  );

  CREATE TABLE IF NOT EXISTS bc_goodreads_links (
    user_id VARCHAR(255) PRIMARY KEY REFERENCES bc_users(user_id),
    goodreads_user_id VARCHAR(255),
    last_sync TIMESTAMP WITH TIME ZONE,
    sync_results JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bc_club_info (
    key VARCHAR(50) PRIMARY KEY,
    value JSONB,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );
  
  -- Indexes for performance
  CREATE INDEX IF NOT EXISTS idx_bc_reading_logs_user_id ON bc_reading_logs(user_id);
  CREATE INDEX IF NOT EXISTS idx_bc_reading_logs_status ON bc_reading_logs(status);
`;

export async function initDB() {
  const client = await pool.connect();
  try {
    logger.info('Initializing database schema...');
    await client.query(SCHEMA);
    logger.info('Database schema initialized successfully.');
  } catch (err) {
    logger.error('Failed to initialize database schema', err);
    throw err;
  } finally {
    client.release();
  }
}

export async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  // logger.debug('Executed query', { text, duration, rows: res.rowCount });
  return res;
}

export async function getClient() {
  const client = await pool.connect();
  return client;
}

export default {
  query,
  getClient,
  initDB
};

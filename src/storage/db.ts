/**
 * SQLite database setup using sql.js (pure JS, no native deps).
 * Auto-persists to disk after every write operation.
 */

import fs from 'node:fs';
import path from 'node:path';
import initSqlJs, { type Database } from 'sql.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('database');
const DATA_DIR = path.resolve(process.cwd(), 'data');

let db: Database | null = null;
let dbPath: string;

/** SQL migration statements */
const MIGRATIONS = `
  CREATE TABLE IF NOT EXISTS mints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chain TEXT NOT NULL,
    contract_address TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    tx_hash TEXT,
    token_id TEXT,
    mint_price TEXT NOT NULL,
    gas_cost TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error_reason TEXT,
    created_at INTEGER NOT NULL,
    confirmed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chain TEXT NOT NULL,
    contract_address TEXT NOT NULL,
    name TEXT NOT NULL,
    added_at INTEGER NOT NULL,
    UNIQUE(chain, contract_address)
  );

  CREATE TABLE IF NOT EXISTS config_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT NOT NULL,
    changed_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rpcs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chain TEXT NOT NULL,
    url TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0,
    added_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_mints_chain ON mints(chain);
  CREATE INDEX IF NOT EXISTS idx_mints_status ON mints(status);
  CREATE INDEX IF NOT EXISTS idx_mints_created ON mints(created_at);
  CREATE INDEX IF NOT EXISTS idx_watchlist_chain ON watchlist(chain);
`;

/**
 * Save the current database state to disk.
 */
function persistToFile(): void {
  if (db && dbPath) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  }
}

/**
 * Initialize the SQLite database.
 * Creates or opens the database file and runs migrations.
 */
export async function initDatabase(customPath?: string): Promise<Database> {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  dbPath = customPath ?? path.join(DATA_DIR, 'mint-bot.db');

  const SQL = await initSqlJs();

  // Load existing database or create new
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
    log.info({ path: dbPath }, 'Loaded existing database');
  } else {
    db = new SQL.Database();
    log.info({ path: dbPath }, 'Created new database');
  }

  // Run migrations
  db.run(MIGRATIONS);
  persistToFile();

  log.info('Database migrations complete');
  return db;
}

/**
 * Get the current database instance.
 * Throws if not initialized.
 */
export function getDatabase(): Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Save database to disk (call after write operations).
 */
export function saveDatabase(): void {
  persistToFile();
}

/**
 * Close the database and persist final state.
 */
export function closeDatabase(): void {
  if (db) {
    persistToFile();
    db.close();
    db = null;
    log.info('Database closed');
  }
}

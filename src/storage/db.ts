import Database from 'better-sqlite3';
import { getDatabasePath } from '../config/index.js';

let dbInstance: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = getDatabasePath();
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrency and reliability
  db.pragma('journal_mode = WAL');

  // Create schema according to SRS Section 6
  db.exec(`
    CREATE TABLE IF NOT EXISTS file_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action_batch_id TEXT NOT NULL,
        original_path TEXT NOT NULL,
        new_path TEXT NOT NULL,
        file_name_original TEXT NOT NULL,
        file_name_new TEXT NOT NULL,
        file_hash TEXT,
        category TEXT,
        ai_reason TEXT,
        provider_used TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT CHECK(status IN ('MOVED', 'REVERTED', 'FAILED')) DEFAULT 'MOVED'
    );

    CREATE INDEX IF NOT EXISTS idx_batch ON file_actions(action_batch_id);
    CREATE INDEX IF NOT EXISTS idx_status ON file_actions(status);
  `);

  dbInstance = db;
  return db;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

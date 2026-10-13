import { getDatabase } from './db.js';
import { FileActionRecord, ActionStatus } from '../config/types.js';

export function insertAction(action: Omit<FileActionRecord, 'id' | 'timestamp'>): number {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO file_actions (
      action_batch_id,
      original_path,
      new_path,
      file_name_original,
      file_name_new,
      file_hash,
      category,
      ai_reason,
      provider_used,
      status
    ) VALUES (
      @action_batch_id,
      @original_path,
      @new_path,
      @file_name_original,
      @file_name_new,
      @file_hash,
      @category,
      @ai_reason,
      @provider_used,
      @status
    )
  `);

  const info = stmt.run({
    action_batch_id: action.action_batch_id,
    original_path: action.original_path,
    new_path: action.new_path,
    file_name_original: action.file_name_original,
    file_name_new: action.file_name_new,
    file_hash: action.file_hash,
    category: action.category,
    ai_reason: action.ai_reason,
    provider_used: action.provider_used,
    status: action.status || 'MOVED'
  });

  return Number(info.lastInsertRowid);
}

export function updateActionStatus(id: number, status: ActionStatus): void {
  const db = getDatabase();
  const stmt = db.prepare('UPDATE file_actions SET status = ? WHERE id = ?');
  stmt.run(status, id);
}

export function getActiveMovedActions(limit: number = 1): FileActionRecord[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM file_actions
    WHERE status = 'MOVED'
    ORDER BY id DESC
    LIMIT ?
  `);
  return stmt.all(limit) as FileActionRecord[];
}

export function getHistory(limit: number = 25): FileActionRecord[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM file_actions
    ORDER BY id DESC
    LIMIT ?
  `);
  return stmt.all(limit) as FileActionRecord[];
}

export function getActionById(id: number): FileActionRecord | undefined {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM file_actions WHERE id = ?');
  return stmt.get(id) as FileActionRecord | undefined;
}

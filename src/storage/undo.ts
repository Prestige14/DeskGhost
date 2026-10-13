import fs from 'node:fs';
import path from 'node:path';
import { getActiveMovedActions, updateActionStatus } from './journal.js';
import { calculateFileHash } from '../core/hasher.js';
import { FileActionRecord } from '../config/types.js';

export interface UndoResultItem {
  record: FileActionRecord;
  success: boolean;
  message: string;
}

export interface UndoBatchResult {
  totalRequested: number;
  revertedCount: number;
  skippedCount: number;
  items: UndoResultItem[];
}

export function performUndo(lastCount: number = 1): UndoBatchResult {
  const actions = getActiveMovedActions(lastCount);
  const items: UndoResultItem[] = [];

  let revertedCount = 0;
  let skippedCount = 0;

  for (const action of actions) {
    const currentPath = action.new_path;
    const targetOriginalPath = action.original_path;

    // Safety check 1: Target file in organized location must exist
    if (!fs.existsSync(currentPath)) {
      items.push({
        record: action,
        success: false,
        message: 'File target sudah dimodifikasi secara eksternal; operasi dibatalkan untuk mencegah korupsi data'
      });
      skippedCount++;
      continue;
    }

    // Safety check 2: Check hash integrity if original hash was recorded
    if (action.file_hash) {
      const currentHash = calculateFileHash(currentPath);
      if (currentHash && currentHash !== action.file_hash) {
        items.push({
          record: action,
          success: false,
          message: 'File target sudah dimodifikasi secara eksternal; operasi dibatalkan untuk mencegah korupsi data'
        });
        skippedCount++;
        continue;
      }
    }

    try {
      // Ensure target original directory exists
      const targetDir = path.dirname(targetOriginalPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      // Check collision at original path
      let destinationPath = targetOriginalPath;
      if (fs.existsSync(destinationPath)) {
        const parsed = path.parse(targetOriginalPath);
        let counter = 1;
        while (fs.existsSync(destinationPath)) {
          destinationPath = path.join(parsed.dir, `${parsed.name}_reverted(${counter})${parsed.ext}`);
          counter++;
        }
      }

      // Move file back
      fs.renameSync(currentPath, destinationPath);

      // Clean up empty category directory if empty
      const parentDir = path.dirname(currentPath);
      try {
        const remaining = fs.readdirSync(parentDir);
        if (remaining.length === 0) {
          fs.rmdirSync(parentDir);
        }
      } catch {
        // Ignore if directory deletion fails
      }

      // Update record status in database
      if (action.id) {
        updateActionStatus(action.id, 'REVERTED');
      }

      revertedCount++;
      items.push({
        record: action,
        success: true,
        message: `Reverted: ${path.basename(currentPath)} -> ${path.basename(destinationPath)}`
      });
    } catch (err: any) {
      skippedCount++;
      items.push({
        record: action,
        success: false,
        message: `Gagal mengembalikan berkas: ${err?.message || String(err)}`
      });
    }
  }

  return {
    totalRequested: lastCount,
    revertedCount,
    skippedCount,
    items
  };
}

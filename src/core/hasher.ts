import fs from 'node:fs';
import crypto from 'node:crypto';

export function calculateFileHash(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const fileBuffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
  } catch {
    return null;
  }
}

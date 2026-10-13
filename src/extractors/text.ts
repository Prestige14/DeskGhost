import fs from 'node:fs';

export function extractTextSnippet(filePath: string, maxChars: number = 3000): string {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const cleaned = raw.replace(/\r\n/g, '\n').trim();
    if (cleaned.length > maxChars) {
      return cleaned.slice(0, maxChars) + '... [truncated]';
    }
    return cleaned;
  } catch (err) {
    return '';
  }
}

import fs from 'node:fs';
import pdf from 'pdf-parse';

export async function extractPdf(filePath: string): Promise<string> {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdf(dataBuffer);
    const cleanedText = data.text
      .replace(/\r\n/g, '\n')
      .replace(/\n\s*\n/g, '\n')
      .trim();

    const maxChars = 3000;
    if (cleanedText.length > maxChars) {
      return cleanedText.slice(0, maxChars) + '... [truncated]';
    }
    return cleanedText;
  } catch (err) {
    return '';
  }
}

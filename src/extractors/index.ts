import fs from 'node:fs';
import path from 'node:path';
import mime from 'mime-types';
import { ExtractedContent, FileContentType } from './types.js';
import { extractImage } from './image.js';
import { extractPdf } from './pdf.js';
import { extractTextSnippet } from './text.js';

export * from './types.js';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tiff', '.svg', '.ico']);
const PDF_EXTENSIONS = new Set(['.pdf']);
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.yaml', '.yml',
  '.xml', '.log', '.ini', '.conf', '.env.example'
]);
const CODE_EXTENSIONS = new Set([
  '.js', '.ts', '.tsx', '.jsx', '.py', '.rs', '.go', '.java', '.c',
  '.cpp', '.h', '.cs', '.html', '.css', '.scss', '.sh', '.ps1', '.sql'
]);
const ARCHIVE_EXTENSIONS = new Set([
  '.zip', '.tar', '.gz', '.tgz', '.7z', '.rar', '.bz2', '.xz'
]);

export async function extractFileContent(filePath: string): Promise<ExtractedContent> {
  const stats = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);
  const detectedMime = mime.lookup(ext) || 'application/octet-stream';
  const createdDate = stats.birthtime || stats.mtime || new Date();

  let type: FileContentType = 'binary';
  let textSnippet: string | undefined;
  let imageBase64: string | undefined;
  let imageMimeType: string | undefined;

  if (IMAGE_EXTENSIONS.has(ext)) {
    type = 'image';
    const imgData = await extractImage(filePath);
    imageBase64 = imgData.base64;
    imageMimeType = imgData.mimeType;
  } else if (PDF_EXTENSIONS.has(ext)) {
    type = 'pdf';
    textSnippet = await extractPdf(filePath);
  } else if (TEXT_EXTENSIONS.has(ext)) {
    type = 'text';
    textSnippet = extractTextSnippet(filePath);
  } else if (CODE_EXTENSIONS.has(ext)) {
    type = 'code';
    textSnippet = extractTextSnippet(filePath);
  } else if (ARCHIVE_EXTENSIONS.has(ext)) {
    type = 'archive';
  } else {
    type = 'binary';
  }

  return {
    type,
    fileName,
    fileExtension: ext,
    fileSize: stats.size,
    mimeType: detectedMime.toString(),
    createdDate,
    textSnippet,
    imageBase64,
    imageMimeType
  };
}

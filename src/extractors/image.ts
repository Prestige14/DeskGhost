import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import mime from 'mime-types';

export interface ImageExtractionResult {
  base64: string;
  mimeType: string;
}

export async function extractImage(filePath: string): Promise<ImageExtractionResult> {
  const ext = path.extname(filePath).toLowerCase();
  const detectedMime = mime.lookup(ext) || 'image/png';

  try {
    const image = sharp(filePath);
    const metadata = await image.metadata();

    let transformer = image;
    const maxDim = 1280;
    if ((metadata.width && metadata.width > maxDim) || (metadata.height && metadata.height > maxDim)) {
      transformer = transformer.resize({
        width: maxDim,
        height: maxDim,
        fit: 'inside',
        withoutEnlargement: true
      });
    }

    // Convert SVG or other vector formats to png for vision model consumption
    if (ext === '.svg' || ext === '.webp' || ext === '.gif') {
      const buffer = await transformer.png().toBuffer();
      return {
        base64: buffer.toString('base64'),
        mimeType: 'image/png'
      };
    }

    // Default to jpeg compression for photos to save bandwidth
    if (ext === '.jpg' || ext === '.jpeg') {
      const buffer = await transformer.jpeg({ quality: 85 }).toBuffer();
      return {
        base64: buffer.toString('base64'),
        mimeType: 'image/jpeg'
      };
    }

    const buffer = await transformer.png().toBuffer();
    return {
      base64: buffer.toString('base64'),
      mimeType: detectedMime.toString()
    };
  } catch (err) {
    // Fallback: Read raw buffer directly if sharp cannot decode
    const rawBuffer = fs.readFileSync(filePath);
    return {
      base64: rawBuffer.toString('base64'),
      mimeType: detectedMime.toString()
    };
  }
}

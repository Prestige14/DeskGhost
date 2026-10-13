import path from 'node:path';
import { ExtractedContent } from '../extractors/types.js';
import { ClassificationResult } from '../config/types.js';
import { AIProvider, SYSTEM_PROMPT } from './types.js';
import { sanitizeFileName } from './heuristic.js';

export class OllamaProvider implements AIProvider {
  name = 'ollama';
  private baseUrl: string;
  private model: string;

  constructor(baseUrl: string = 'http://127.0.0.1:11434', model: string = 'moondream') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.model = model;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(`${this.baseUrl}/api/version`, {
        signal: controller.signal
      });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }

  async classify(content: ExtractedContent): Promise<ClassificationResult> {
    const prompt = `Analyze this file and generate organization metadata.
Original file name: "${content.fileName}"
File extension: "${content.fileExtension}"
Detected MIME type: "${content.mimeType}"
File size: ${content.fileSize} bytes
${content.textSnippet ? `Extracted content snippet:\n"""\n${content.textSnippet}\n"""` : ''}

Respond with strictly valid JSON matching the requested schema.`;

    const body: Record<string, any> = {
      model: this.model,
      prompt,
      system: SYSTEM_PROMPT,
      format: 'json',
      stream: false
    };

    if (content.type === 'image' && content.imageBase64) {
      body.images = [content.imageBase64];
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Ollama request failed [${response.status}]: ${errText}`);
    }

    const json = (await response.json()) as { response?: string };
    if (!json.response) {
      throw new Error('Ollama returned empty response');
    }

    const parsed = JSON.parse(json.response);
    const ext = content.fileExtension.toLowerCase();
    let suggested = parsed.suggestedName || content.fileName;
    if (!suggested.toLowerCase().endsWith(ext)) {
      suggested = `${suggested}${ext}`;
    }

    const parsedPath = path.parse(suggested);
    const cleaned = `${sanitizeFileName(parsedPath.name)}${parsedPath.ext || ext}`;

    return {
      suggestedName: cleaned,
      category: sanitizeFileName(parsed.category || 'Organized'),
      reason: parsed.reason || 'Classified by Ollama vision/language model.',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.9,
      providerUsed: `ollama (${this.model})`
    };
  }
}

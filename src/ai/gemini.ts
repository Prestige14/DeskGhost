import path from 'node:path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ExtractedContent } from '../extractors/types.js';
import { ClassificationResult } from '../config/types.js';
import { AIProvider, SYSTEM_PROMPT } from './types.js';
import { sanitizeFileName } from './heuristic.js';

export class GeminiProvider implements AIProvider {
  name = 'gemini';
  private apiKey: string;
  private modelName: string;

  constructor(apiKey: string, modelName: string = 'gemini-1.5-flash') {
    this.apiKey = apiKey;
    this.modelName = modelName;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async classify(content: ExtractedContent): Promise<ClassificationResult> {
    if (!this.apiKey) {
      throw new Error('Gemini API key is not configured.');
    }

    const genAI = new GoogleGenerativeAI(this.apiKey);
    const model = genAI.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        responseMimeType: 'application/json'
      },
      systemInstruction: SYSTEM_PROMPT
    });

    const promptText = `Analyze this file and produce the JSON categorization metadata.
File name: "${content.fileName}"
File extension: "${content.fileExtension}"
MIME type: "${content.mimeType}"
Size: ${content.fileSize} bytes
${content.textSnippet ? `Document snippet:\n"""\n${content.textSnippet}\n"""` : ''}`;

    const parts: any[] = [{ text: promptText }];
    if (content.type === 'image' && content.imageBase64) {
      parts.push({
        inlineData: {
          data: content.imageBase64,
          mimeType: content.imageMimeType || 'image/png'
        }
      });
    }

    const result = await model.generateContent(parts);
    const text = result.response.text();
    const parsed = JSON.parse(text);

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
      reason: parsed.reason || 'Classified by Gemini 1.5 Flash multimodal vision.',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.95,
      providerUsed: `gemini (${this.modelName})`
    };
  }
}

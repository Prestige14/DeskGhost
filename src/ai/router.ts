import { ExtractedContent } from '../extractors/types.js';
import { DeskGhostConfig, ClassificationResult } from '../config/types.js';
import { resolveApiKey } from '../config/index.js';
import { HeuristicProvider } from './heuristic.js';
import { OllamaProvider } from './ollama.js';
import { GeminiProvider } from './gemini.js';

export class AIRouter {
  private config: DeskGhostConfig;
  private heuristic = new HeuristicProvider();

  constructor(config: DeskGhostConfig) {
    this.config = config;
  }

  async classify(content: ExtractedContent, onLog?: (msg: string) => void): Promise<ClassificationResult> {
    const log = onLog || (() => {});
    const primary = this.config.ai.provider || 'ollama';
    const fallback = this.config.ai.fallbackProvider || 'gemini';

    // 1. Try Primary Provider
    if (primary === 'ollama') {
      const ollama = new OllamaProvider(this.config.ai.ollamaBaseUrl, this.config.ai.model || 'moondream');
      if (await ollama.isAvailable()) {
        try {
          return await ollama.classify(content);
        } catch (err: any) {
          log(`[AI] Ollama classification failed (${err?.message || err}). Trying fallback...`);
        }
      } else {
        log(`[AI] Ollama is offline at ${this.config.ai.ollamaBaseUrl || 'localhost'}. Switching to fallback...`);
      }
    } else if (primary === 'gemini') {
      const apiKey = resolveApiKey(this.config.ai.geminiApiKey);
      if (apiKey) {
        try {
          const gemini = new GeminiProvider(apiKey, this.config.ai.model || 'gemini-1.5-flash');
          return await gemini.classify(content);
        } catch (err: any) {
          log(`[AI] Gemini classification failed (${err?.message || err}). Trying fallback...`);
        }
      } else {
        log('[AI] Gemini API key not found. Switching to fallback...');
      }
    }

    // 2. Try Fallback Provider
    if (fallback === 'gemini') {
      const apiKey = resolveApiKey(this.config.ai.geminiApiKey);
      if (apiKey) {
        try {
          const gemini = new GeminiProvider(apiKey, 'gemini-1.5-flash');
          return await gemini.classify(content);
        } catch (err: any) {
          log(`[AI] Fallback Gemini failed (${err?.message || err}). Falling back to heuristic engine.`);
        }
      }
    } else if (fallback === 'ollama') {
      const ollama = new OllamaProvider(this.config.ai.ollamaBaseUrl, 'moondream');
      if (await ollama.isAvailable()) {
        try {
          return await ollama.classify(content);
        } catch (err: any) {
          log(`[AI] Fallback Ollama failed (${err?.message || err}). Falling back to heuristic engine.`);
        }
      }
    }

    // 3. Fallback to Smart Heuristic Engine
    return await this.heuristic.classify(content);
  }
}

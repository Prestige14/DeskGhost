export interface AIConfig {
  provider: 'ollama' | 'gemini';
  model: string;
  fallbackProvider?: 'ollama' | 'gemini' | 'none';
  geminiApiKey?: string;
  ollamaBaseUrl?: string;
}

export interface DeskGhostConfig {
  watchPaths: string[];
  destinationRoot: string;
  ai: AIConfig;
  debounceMs: number;
  notifications: boolean;
  ignorePatterns: string[];
  maxConcurrency?: number;
}

export interface ClassificationResult {
  suggestedName: string;
  category: string;
  reason: string;
  confidence: number;
  providerUsed: string;
}

export type ActionStatus = 'MOVED' | 'REVERTED' | 'FAILED';

export interface FileActionRecord {
  id?: number;
  action_batch_id: string;
  original_path: string;
  new_path: string;
  file_name_original: string;
  file_name_new: string;
  file_hash: string | null;
  category: string | null;
  ai_reason: string | null;
  provider_used: string | null;
  timestamp?: string;
  status: ActionStatus;
}

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DeskGhostConfig } from './types.js';

export * from './types.js';

export function getAppDir(): string {
  const home = os.homedir();
  const dir = path.join(home, '.deskghost');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getConfigPath(): string {
  return path.join(getAppDir(), 'config.json');
}

export function getDatabasePath(): string {
  return path.join(getAppDir(), 'deskghost.db');
}

export function resolveHome(filePath: string): string {
  if (filePath.startsWith('~')) {
    const home = os.homedir();
    const resolved = path.join(home, filePath.slice(1));
    return path.resolve(resolved);
  }
  return path.resolve(filePath);
}

export function findExistingUserDir(folderName: 'Desktop' | 'Downloads' | 'Documents'): string {
  const home = os.homedir();
  const directPath = path.join(home, folderName);
  if (fs.existsSync(directPath)) {
    return directPath;
  }
  const oneDrivePath = path.join(home, 'OneDrive', folderName);
  if (fs.existsSync(oneDrivePath)) {
    return oneDrivePath;
  }
  return directPath;
}

export function getDefaultConfig(): DeskGhostConfig {
  const desktopPath = findExistingUserDir('Desktop');
  const downloadsPath = findExistingUserDir('Downloads');
  const documentsPath = findExistingUserDir('Documents');

  return {
    watchPaths: [desktopPath, downloadsPath],
    destinationRoot: path.join(documentsPath, 'Organized'),
    ai: {
      provider: 'ollama',
      model: 'moondream',
      fallbackProvider: 'gemini',
      geminiApiKey: 'env:GEMINI_API_KEY',
      ollamaBaseUrl: 'http://127.0.0.1:11434'
    },
    debounceMs: 3000,
    notifications: true,
    ignorePatterns: [
      '*.crdownload',
      '*.part',
      '*.tmp',
      '.DS_Store',
      'Thumbs.db',
      'desktop.ini',
      'node_modules',
      'node_modules/**',
      '.git',
      '.git/**',
      '.env*',
      '*.pem',
      '*.key',
      'id_rsa*',
      'id_ed25519*'
    ],
    maxConcurrency: 2
  };
}

export function resolveApiKey(keyOrEnv?: string): string | undefined {
  if (!keyOrEnv) {
    return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  }
  if (keyOrEnv.startsWith('env:')) {
    const envVar = keyOrEnv.slice(4).trim();
    return process.env[envVar] || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  }
  return keyOrEnv;
}

export function loadConfig(): DeskGhostConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    const defaultConfig = getDefaultConfig();
    saveConfig(defaultConfig);
    return defaultConfig;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const defaults = getDefaultConfig();

    return {
      ...defaults,
      ...parsed,
      ai: {
        ...defaults.ai,
        ...(parsed.ai || {})
      },
      watchPaths: (parsed.watchPaths || defaults.watchPaths).map((p: string) => resolveHome(p)),
      destinationRoot: resolveHome(parsed.destinationRoot || defaults.destinationRoot)
    };
  } catch (err) {
    console.warn(`[DeskGhost] Warning: Failed to parse ${configPath}, using default config.`, err);
    return getDefaultConfig();
  }
}

export function saveConfig(config: DeskGhostConfig): void {
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

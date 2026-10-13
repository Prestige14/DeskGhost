import fs from 'node:fs';
import path from 'node:path';
import chokidar, { FSWatcher } from 'chokidar';
import micromatch from 'micromatch';
import chalk from 'chalk';
import { DeskGhostConfig } from '../config/types.js';
import { FileOrganizer } from '../core/organizer.js';
import { ConcurrencyQueue } from './queue.js';

export function isIgnored(filePath: string, patterns: string[]): boolean {
  const baseName = path.basename(filePath);
  const normalized = filePath.replace(/\\/g, '/');

  for (const pattern of patterns) {
    if (micromatch.isMatch(baseName, pattern, { dot: true })) return true;
    if (micromatch.isMatch(normalized, pattern, { dot: true })) return true;
    if (micromatch.isMatch(normalized, `**/${pattern}/**`, { dot: true })) return true;
    if (micromatch.isMatch(normalized, `**/${pattern}`, { dot: true })) return true;
  }
  return false;
}

export function isTemporaryFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return (
    lower.endsWith('.crdownload') ||
    lower.endsWith('.part') ||
    lower.endsWith('.tmp') ||
    lower.endsWith('.download') ||
    lower.startsWith('~$')
  );
}

function formatTimestamp(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `[${hh}:${mm}:${ss}]`;
}

export class DirectoryWatcher {
  private config: DeskGhostConfig;
  private organizer: FileOrganizer;
  private queue: ConcurrencyQueue;
  private watcher: FSWatcher | null = null;
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private activeProcessing = new Set<string>();

  constructor(config: DeskGhostConfig) {
    this.config = config;
    this.organizer = new FileOrganizer(config);
    this.queue = new ConcurrencyQueue(config.maxConcurrency || 2);
  }

  async start(): Promise<void> {
    const existingWatchPaths = this.config.watchPaths.filter((p) => {
      const exists = fs.existsSync(p);
      if (!exists) {
        console.log(chalk.yellow(`[DeskGhost] Notice: Watch path "${p}" does not exist yet. Skipping.`));
      }
      return exists;
    });

    if (existingWatchPaths.length === 0) {
      console.error(chalk.red('[DeskGhost] Error: None of the configured watchPaths exist on this system.'));
      return;
    }

    console.log(chalk.bold.magenta('\n[DeskGhost v1.0.0] 👻 Starting background watcher...'));
    console.log(chalk.cyan(`[DeskGhost] Watching: ${existingWatchPaths.join(', ')}`));
    console.log(
      chalk.cyan(
        `[Engine] Provider: ${this.config.ai.provider} (${this.config.ai.model}) | Fallback: ${this.config.ai.fallbackProvider || 'none'} | Mode: Safe-Atomic`
      )
    );
    console.log(chalk.gray(`[Engine] Debounce: ${this.config.debounceMs}ms | Destination: ${this.config.destinationRoot}\n`));

    this.watcher = chokidar.watch(existingWatchPaths, {
      ignored: (filePath: string) => isIgnored(filePath, this.config.ignorePatterns),
      persistent: true,
      ignoreInitial: true,
      depth: 0, // Watch top-level drop folder (Desktop / Downloads)
      awaitWriteFinish: {
        stabilityThreshold: 1500,
        pollInterval: 200
      }
    });

    this.watcher.on('add', (filePath: string) => this.handleFileEvent(filePath));
    this.watcher.on('change', (filePath: string) => this.handleFileEvent(filePath));
    this.watcher.on('error', (err: any) => {
      console.error(chalk.red(`[DeskGhost] Watcher error: ${err?.message || err}`));
    });
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  private handleFileEvent(filePath: string): void {
    const fileName = path.basename(filePath);

    if (isTemporaryFile(fileName)) {
      return;
    }

    if (isIgnored(filePath, this.config.ignorePatterns)) {
      return;
    }

    // Cancel any pending timer for this file
    if (this.debounceTimers.has(filePath)) {
      clearTimeout(this.debounceTimers.get(filePath)!);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      this.scheduleProcessing(filePath);
    }, this.config.debounceMs);

    this.debounceTimers.set(filePath, timer);
  }

  private scheduleProcessing(filePath: string): void {
    if (this.activeProcessing.has(filePath)) {
      return;
    }

    this.activeProcessing.add(filePath);
    this.queue.push(async () => {
      try {
        await this.processFile(filePath);
      } finally {
        this.activeProcessing.delete(filePath);
      }
    });
  }

  private async processFile(filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) {
      return;
    }

    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        return;
      }
    } catch {
      return;
    }

    const fileName = path.basename(filePath);
    console.log(`${chalk.gray(formatTimestamp())} ${chalk.green('📥 New file detected:')} ${filePath}`);

    try {
      const result = await this.organizer.organizeFile(filePath, {
        dryRun: false,
        onLog: (msg) => console.log(`${chalk.gray(formatTimestamp())} ${chalk.yellow(msg)}`)
      });

      if (result.success) {
        console.log(
          `${chalk.gray(formatTimestamp())} ${chalk.blue('🧠 AI classified:')} ${result.decision.reason} (${chalk.cyan(result.decision.category)})`
        );
        console.log(`${chalk.gray(formatTimestamp())} ${chalk.magenta('🚚 Renamed & Moved:')}`);
        console.log(`           └─ Before: ${chalk.gray(result.originalName)}`);
        console.log(`           └─ After:  ${chalk.green(result.targetPath)}`);
        if (this.config.notifications) {
          console.log(`${chalk.gray(formatTimestamp())} ${chalk.dim('🔔 Desktop notification sent.')}\n`);
        } else {
          console.log();
        }
      } else {
        console.error(
          `${chalk.gray(formatTimestamp())} ${chalk.red('❌ Failed to organize:')} ${result.error || 'Unknown error'}\n`
        );
      }
    } catch (err: any) {
      console.error(
        `${chalk.gray(formatTimestamp())} ${chalk.red('❌ Error processing file:')} ${err?.message || err}\n`
      );
    }
  }
}

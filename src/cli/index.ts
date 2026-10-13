#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import {
  loadConfig,
  saveConfig,
  getConfigPath,
  getDatabasePath,
  resolveHome
} from '../config/index.js';
import { DirectoryWatcher, isIgnored, isTemporaryFile } from '../watcher/index.js';
import { FileOrganizer } from '../core/organizer.js';
import { performUndo } from '../storage/undo.js';
import { getHistory } from '../storage/journal.js';
import { closeDatabase } from '../storage/db.js';

const program = new Command();

program
  .name('deskghost')
  .description('👻 The silent, local-first background agent that organizes your Desktop & Downloads')
  .version('1.0.0');

// 1. START COMMAND
program
  .command('start')
  .description('Starts the continuous background file system watcher service')
  .action(async () => {
    const config = loadConfig();
    const watcher = new DirectoryWatcher(config);

    const cleanup = async () => {
      console.log(chalk.yellow('\n[DeskGhost] Stopping background watcher service...'));
      await watcher.stop();
      closeDatabase();
      console.log(chalk.gray('[DeskGhost] Goodbye! 👻'));
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    await watcher.start();
  });

// 2. ORGANIZE COMMAND
program
  .command('organize <targetPath>')
  .description('Runs a one-time organization sweep on a target directory or file')
  .option('--dry-run', 'Previews what will be moved and renamed without touching files', false)
  .action(async (targetPath: string, options: { dryRun: boolean }) => {
    const config = loadConfig();
    const organizer = new FileOrganizer(config);
    const resolved = resolveHome(targetPath);

    if (!fs.existsSync(resolved)) {
      console.error(chalk.red(`[DeskGhost] Error: Target path "${resolved}" does not exist.`));
      process.exit(1);
    }

    const stat = fs.statSync(resolved);
    const filesToProcess: string[] = [];

    if (stat.isDirectory()) {
      const items = fs.readdirSync(resolved);
      for (const item of items) {
        const full = path.join(resolved, item);
        if (!fs.statSync(full).isDirectory()) {
          if (!isTemporaryFile(item) && !isIgnored(full, config.ignorePatterns)) {
            filesToProcess.push(full);
          }
        }
      }
    } else {
      filesToProcess.push(resolved);
    }

    if (filesToProcess.length === 0) {
      console.log(chalk.yellow('[DeskGhost] No matching files found to organize in the target folder.'));
      return;
    }

    console.log(
      chalk.magenta(
        `\n[DeskGhost] ${options.dryRun ? '🔍 DRY-RUN PREVIEW:' : '🚀 ORGANIZING:'} Processing ${filesToProcess.length} file(s)...\n`
      )
    );

    let successCount = 0;
    let failCount = 0;

    for (const file of filesToProcess) {
      const result = await organizer.organizeFile(file, {
        dryRun: options.dryRun,
        onLog: (msg) => console.log(chalk.dim(`  ${msg}`))
      });

      if (result.success) {
        successCount++;
        console.log(chalk.green(`  ✓ [${result.decision.category}] ${result.originalName}`));
        console.log(chalk.cyan(`    └─ AI Name:   ${result.newName}`));
        console.log(chalk.gray(`    └─ Reason:    ${result.decision.reason}`));
        console.log(chalk.gray(`    └─ Provider:  ${result.decision.providerUsed}`));
        if (!options.dryRun) {
          console.log(chalk.magenta(`    └─ Moved To:  ${result.targetPath}`));
        }
        console.log();
      } else {
        failCount++;
        console.error(chalk.red(`  ✗ Failed: ${result.originalName} (${result.error})`));
      }
    }

    console.log(
      chalk.bold(
        `\n[Summary] Total: ${filesToProcess.length} | Succeeded: ${chalk.green(successCount)} | Failed: ${failCount > 0 ? chalk.red(failCount) : chalk.gray(0)}`
      )
    );

    if (options.dryRun) {
      console.log(chalk.yellow('\n(Dry-run mode: no files were moved or changed on disk.)\n'));
    }
  });

// 3. UNDO COMMAND
program
  .command('undo')
  .description('Reverts the last organization action or multiple actions')
  .option('--last <number>', 'Number of actions to revert', '1')
  .action((options: { last: string }) => {
    const count = parseInt(options.last, 10) || 1;
    console.log(chalk.magenta(`\n[DeskGhost] ⏪ Performing atomic undo (last ${count} action(s))...\n`));

    const result = performUndo(count);

    if (result.items.length === 0) {
      console.log(chalk.yellow('[DeskGhost] No active moves found in journal to revert.'));
      return;
    }

    for (const item of result.items) {
      if (item.success) {
        console.log(chalk.green(`  [DeskGhost] ⏪ ${item.message}`));
      } else {
        console.log(chalk.yellow(`  [DeskGhost] ⚠️  ${item.message}`));
      }
    }

    console.log(
      chalk.bold(
        `\n[Undo Summary] Reverted: ${chalk.green(result.revertedCount)} | Skipped: ${result.skippedCount > 0 ? chalk.yellow(result.skippedCount) : chalk.gray(0)}\n`
      )
    );
  });

// 4. HISTORY COMMAND
program
  .command('history')
  .description('Displays the audit log of organized files in terminal')
  .option('--limit <number>', 'Number of audit records to show', '20')
  .action((options: { limit: string }) => {
    const limit = parseInt(options.limit, 10) || 20;
    const history = getHistory(limit);

    if (history.length === 0) {
      console.log(chalk.yellow('[DeskGhost] History is empty. No files have been organized yet.'));
      return;
    }

    const table = new Table({
      head: [
        chalk.cyan('ID'),
        chalk.cyan('Original Name'),
        chalk.cyan('New Name'),
        chalk.cyan('Category'),
        chalk.cyan('Provider'),
        chalk.cyan('Status'),
        chalk.cyan('Timestamp')
      ],
      colWidths: [6, 25, 30, 15, 18, 12, 22],
      wordWrap: true
    });

    for (const row of history) {
      const statusColor =
        row.status === 'MOVED'
          ? chalk.green('MOVED')
          : row.status === 'REVERTED'
          ? chalk.yellow('REVERTED')
          : chalk.red(row.status);

      table.push([
        row.id?.toString() || '-',
        row.file_name_original,
        row.file_name_new,
        row.category || '-',
        row.provider_used || '-',
        statusColor,
        row.timestamp || '-'
      ]);
    }

    console.log(chalk.bold.magenta('\n📜 DeskGhost Audit Journal:\n'));
    console.log(table.toString());
    console.log(chalk.gray(`\nShowing last ${history.length} records. SQLite: ${getDatabasePath()}\n`));
  });

// 5. CONFIG COMMAND
program
  .command('config')
  .description('Opens, prints or updates current configuration')
  .option('--json', 'Prints raw JSON configuration', false)
  .option('--set-key <apiKey>', 'Set Gemini API key')
  .option('--set-provider <provider>', 'Set primary AI provider (ollama or gemini)')
  .option('--show-path', 'Prints config and database paths', false)
  .action((options: { json: boolean; setKey?: string; setProvider?: string; showPath: boolean }) => {
    const config = loadConfig();

    if (options.setKey) {
      config.ai.geminiApiKey = options.setKey;
      saveConfig(config);
      console.log(chalk.green('[DeskGhost] Gemini API key updated.'));
      return;
    }

    if (options.setProvider) {
      if (options.setProvider !== 'ollama' && options.setProvider !== 'gemini') {
        console.error(chalk.red('[DeskGhost] Error: Provider must be "ollama" or "gemini".'));
        process.exit(1);
      }
      config.ai.provider = options.setProvider as 'ollama' | 'gemini';
      saveConfig(config);
      console.log(chalk.green(`[DeskGhost] AI provider updated to "${options.setProvider}".`));
      return;
    }

    if (options.showPath) {
      console.log(chalk.cyan(`Config file:   ${getConfigPath()}`));
      console.log(chalk.cyan(`Database file: ${getDatabasePath()}`));
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(config, null, 2));
      return;
    }

    console.log(chalk.bold.magenta('\n⚙️ DeskGhost Configuration:\n'));
    console.log(`Config file:       ${chalk.cyan(getConfigPath())}`);
    console.log(`Database:          ${chalk.cyan(getDatabasePath())}`);
    console.log(`Watch Paths:       ${chalk.green(config.watchPaths.join(', '))}`);
    console.log(`Destination Root:  ${chalk.green(config.destinationRoot)}`);
    console.log(`Primary Provider:  ${chalk.yellow(config.ai.provider)} (${config.ai.model})`);
    console.log(`Fallback Provider: ${chalk.yellow(config.ai.fallbackProvider || 'none')}`);
    console.log(`Debounce Interval: ${chalk.cyan(config.debounceMs + 'ms')}`);
    console.log(`Notifications:     ${config.notifications ? chalk.green('Enabled') : chalk.gray('Disabled')}`);
    console.log(`Max Concurrency:   ${chalk.cyan(config.maxConcurrency || 2)}`);
    console.log(`Ignore Patterns:   ${chalk.gray(config.ignorePatterns.slice(0, 5).join(', ') + '...')}\n`);
  });

program.parse(process.argv);

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DeskGhostConfig, ClassificationResult, FileActionRecord } from '../config/types.js';
import { extractFileContent } from '../extractors/index.js';
import { AIRouter } from '../ai/router.js';
import { calculateFileHash } from './hasher.js';
import { insertAction } from '../storage/journal.js';
import { Notifier } from '../notifier/notifier.js';

export interface OrganizeResult {
  success: boolean;
  dryRun: boolean;
  originalPath: string;
  targetPath: string;
  originalName: string;
  newName: string;
  category: string;
  decision: ClassificationResult;
  fileHash: string | null;
  error?: string;
}

export function resolveUniquePath(targetDir: string, fileName: string): string {
  let targetPath = path.join(targetDir, fileName);
  if (!fs.existsSync(targetPath)) {
    return targetPath;
  }

  const parsed = path.parse(fileName);
  let counter = 1;
  while (fs.existsSync(targetPath)) {
    targetPath = path.join(targetDir, `${parsed.name} (${counter})${parsed.ext}`);
    counter++;
  }
  return targetPath;
}

export function safeMoveFile(source: string, destination: string): void {
  try {
    fs.renameSync(source, destination);
  } catch (err: any) {
    if (err?.code === 'EXDEV') {
      // Cross-device fallback
      fs.copyFileSync(source, destination);
      fs.unlinkSync(source);
    } else {
      throw err;
    }
  }
}

export class FileOrganizer {
  private config: DeskGhostConfig;
  private router: AIRouter;
  private notifier: Notifier;

  constructor(config: DeskGhostConfig) {
    this.config = config;
    this.router = new AIRouter(config);
    this.notifier = new Notifier(config);
  }

  async organizeFile(
    filePath: string,
    options: { dryRun?: boolean; batchId?: string; onLog?: (msg: string) => void } = {}
  ): Promise<OrganizeResult> {
    const { dryRun = false, batchId = crypto.randomUUID(), onLog = () => {} } = options;
    const resolvedPath = path.resolve(filePath);

    if (!fs.existsSync(resolvedPath)) {
      return {
        success: false,
        dryRun,
        originalPath: resolvedPath,
        targetPath: '',
        originalName: path.basename(resolvedPath),
        newName: '',
        category: '',
        decision: {
          suggestedName: '',
          category: '',
          reason: 'File not found',
          confidence: 0,
          providerUsed: 'none'
        },
        fileHash: null,
        error: `File not found: ${resolvedPath}`
      };
    }

    const originalName = path.basename(resolvedPath);

    // 1. Multimodal Extraction
    const content = await extractFileContent(resolvedPath);

    // 2. AI Reasoning & Classification
    const decision = await this.router.classify(content, onLog);

    // 3. Compute Destination Path with Collision Avoidance
    const categoryDir = path.join(this.config.destinationRoot, decision.category);
    const suggestedFileName = decision.suggestedName || originalName;
    const finalTargetPath = resolveUniquePath(categoryDir, suggestedFileName);
    const finalNewName = path.basename(finalTargetPath);

    // 4. Compute Hash
    const fileHash = calculateFileHash(resolvedPath);

    // 5. Dry-run early exit
    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        originalPath: resolvedPath,
        targetPath: finalTargetPath,
        originalName,
        newName: finalNewName,
        category: decision.category,
        decision,
        fileHash
      };
    }

    // 6. Execute atomic move
    try {
      if (!fs.existsSync(categoryDir)) {
        fs.mkdirSync(categoryDir, { recursive: true });
      }

      safeMoveFile(resolvedPath, finalTargetPath);

      // 7. Journal into SQLite
      insertAction({
        action_batch_id: batchId,
        original_path: resolvedPath,
        new_path: finalTargetPath,
        file_name_original: originalName,
        file_name_new: finalNewName,
        file_hash: fileHash,
        category: decision.category,
        ai_reason: decision.reason,
        provider_used: decision.providerUsed,
        status: 'MOVED'
      });

      // 8. Desktop Notification
      this.notifier.notify(
        `Organized ${decision.category}`,
        `${originalName} -> ${finalNewName}`
      );

      return {
        success: true,
        dryRun: false,
        originalPath: resolvedPath,
        targetPath: finalTargetPath,
        originalName,
        newName: finalNewName,
        category: decision.category,
        decision,
        fileHash
      };
    } catch (err: any) {
      return {
        success: false,
        dryRun: false,
        originalPath: resolvedPath,
        targetPath: finalTargetPath,
        originalName,
        newName: finalNewName,
        category: decision.category,
        decision,
        fileHash,
        error: err?.message || String(err)
      };
    }
  }
}

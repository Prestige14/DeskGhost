import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';

import {
  resolveHome,
  getDefaultConfig,
  isIgnored,
  isTemporaryFile,
  ConcurrencyQueue,
  calculateFileHash,
  resolveUniquePath,
  safeMoveFile,
  extractTextSnippet,
  extractImage,
  HeuristicProvider,
  getDatabase,
  closeDatabase,
  insertAction,
  getActiveMovedActions,
  getHistory,
  updateActionStatus,
  performUndo,
  FileOrganizer
} from '../dist/index.js';

test('1. Configuration & Path Resolution', () => {
  const resolved = resolveHome('~/test-folder');
  assert.ok(resolved.startsWith(os.homedir()), 'Should resolve ~ to user homedir');

  const config = getDefaultConfig();
  assert.equal(typeof config.debounceMs, 'number');
  assert.equal(config.ai.provider, 'ollama');
  assert.ok(config.watchPaths.length > 0);
});

test('2. Ignore Patterns & Temporary Files', () => {
  const patterns = ['*.tmp', '*.crdownload', 'node_modules', '.git', '.env*'];

  assert.equal(isTemporaryFile('download.crdownload'), true);
  assert.equal(isTemporaryFile('archive.part'), true);
  assert.equal(isTemporaryFile('scratch.tmp'), true);
  assert.equal(isTemporaryFile('~$document.docx'), true);
  assert.equal(isTemporaryFile('regular.pdf'), false);

  assert.equal(isIgnored('file.tmp', patterns), true);
  assert.equal(isIgnored('.env.local', patterns), true);
  assert.equal(isIgnored('src/node_modules/pkg/index.js', patterns), true);
  assert.equal(isIgnored('photo.png', patterns), false);
});

test('3. Concurrency Queue', async () => {
  const queue = new ConcurrencyQueue(2);
  let active = 0;
  let maxActive = 0;

  const runTask = () =>
    new Promise<void>((resolve) => {
      queue.push(async () => {
        active++;
        if (active > maxActive) maxActive = active;
        await new Promise((r) => setTimeout(r, 50));
        active--;
        resolve();
      });
    });

  await Promise.all([runTask(), runTask(), runTask(), runTask()]);
  assert.ok(maxActive <= 2, `Max active concurrency was ${maxActive}, should be <= 2`);
});

test('4. Extractors (Sharp image & text)', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-test-extract-'));

  // Test Text Extractor
  const txtPath = path.join(tempDir, 'sample.txt');
  fs.writeFileSync(txtPath, 'DeskGhost automated text extraction test snippet', 'utf-8');
  const extractedTxt = extractTextSnippet(txtPath);
  assert.ok(extractedTxt.includes('DeskGhost automated'));

  // Test Image Extractor with Sharp
  const imgPath = path.join(tempDir, 'sample.png');
  // Create a 2000x1500 test image to test auto-resize to max 1280
  await sharp({
    create: {
      width: 2000,
      height: 1500,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 }
    }
  }).png().toFile(imgPath);

  const imgData = await extractImage(imgPath);
  assert.ok(imgData.base64.length > 0);
  assert.equal(imgData.mimeType, 'image/png');

  // Verify decoded resized dimensions
  const resizedBuffer = Buffer.from(imgData.base64, 'base64');
  const metadata = await sharp(resizedBuffer).metadata();
  assert.ok((metadata.width || 0) <= 1280, 'Image should be resized to max 1280px');

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('5. Heuristic AI Classifier', async () => {
  const heuristic = new HeuristicProvider();

  // Test Screenshot
  const ssResult = await heuristic.classify({
    type: 'image',
    fileName: 'Screenshot 2026-10-09 at 14.22.45.png',
    fileExtension: '.png',
    fileSize: 1024,
    mimeType: 'image/png',
    createdDate: new Date('2026-10-09T14:22:45')
  });
  assert.equal(ssResult.category, 'Screenshots');
  assert.ok(ssResult.suggestedName.endsWith('.png'));

  // Test Travel Flight Ticket
  const travelResult = await heuristic.classify({
    type: 'pdf',
    fileName: 'garuda_boarding_pass.pdf',
    fileExtension: '.pdf',
    fileSize: 5000,
    mimeType: 'application/pdf',
    createdDate: new Date('2026-10-10'),
    textSnippet: 'Electronic Ticket Flight GA401 CGK to DPS Passenger Confirmation'
  });
  assert.equal(travelResult.category, 'Travel');
  assert.ok(travelResult.suggestedName.includes('Garuda_Flight'));

  // Test Financial Invoice
  const invoiceResult = await heuristic.classify({
    type: 'pdf',
    fileName: 'inv-98234.pdf',
    fileExtension: '.pdf',
    fileSize: 3000,
    mimeType: 'application/pdf',
    createdDate: new Date('2026-10-10'),
    textSnippet: 'Invoice #98234 Total Payment Due: $500.00'
  });
  assert.equal(invoiceResult.category, 'Finances');
  assert.ok(invoiceResult.suggestedName.includes('Invoice'));
});

test('6. Collision Avoidance (FR-05)', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-test-collision-'));

  const file1 = path.join(tempDir, 'Invoice.pdf');
  fs.writeFileSync(file1, 'first invoice');

  const resolvedNext = resolveUniquePath(tempDir, 'Invoice.pdf');
  assert.equal(path.basename(resolvedNext), 'Invoice (1).pdf');

  fs.writeFileSync(resolvedNext, 'second invoice');
  const resolvedThird = resolveUniquePath(tempDir, 'Invoice.pdf');
  assert.equal(path.basename(resolvedThird), 'Invoice (2).pdf');

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('7. Atomic Move & SQLite Audit Journal & Undo Engine (FR-05, FR-06, SRS 6 & 7.2)', async () => {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-test-organize-'));
  const sourceFolder = path.join(testRoot, 'Downloads');
  const targetFolder = path.join(testRoot, 'Organized');
  fs.mkdirSync(sourceFolder, { recursive: true });

  const testFile = path.join(sourceFolder, 'invoice_nov_2026.pdf');
  fs.writeFileSync(testFile, 'Invoice #5512 for Client Acme Inc. Amount: $1,200', 'utf-8');
  const originalHash = calculateFileHash(testFile);

  const customConfig = {
    watchPaths: [sourceFolder],
    destinationRoot: targetFolder,
    ai: {
      provider: 'ollama' as const,
      model: 'moondream',
      fallbackProvider: 'none' as const
    },
    debounceMs: 500,
    notifications: false,
    ignorePatterns: ['*.tmp'],
    maxConcurrency: 2
  };

  const organizer = new FileOrganizer(customConfig);

  // 1. Dry run test (FR-07)
  const dryResult = await organizer.organizeFile(testFile, { dryRun: true });
  assert.equal(dryResult.dryRun, true);
  assert.equal(dryResult.success, true);
  assert.ok(fs.existsSync(testFile), 'Source file must NOT be moved during dry-run');

  // 2. Real organize execution
  const organizeResult = await organizer.organizeFile(testFile, { dryRun: false });
  assert.equal(organizeResult.success, true);
  assert.equal(fs.existsSync(testFile), false, 'Source file must be moved from original path');
  assert.equal(fs.existsSync(organizeResult.targetPath), true, 'Target file must exist in organized folder');
  assert.equal(calculateFileHash(organizeResult.targetPath), originalHash, 'Hash must match exactly');

  // 3. Verify SQLite Journal
  const history = getHistory(1);
  assert.ok(history.length > 0);
  assert.equal(history[0].original_path, testFile);
  assert.equal(history[0].new_path, organizeResult.targetPath);
  assert.equal(history[0].status, 'MOVED');

  // 4. Test Undo Engine (FR-06)
  const undoResult = performUndo(1);
  assert.equal(undoResult.revertedCount, 1);
  assert.equal(fs.existsSync(testFile), true, 'File must be restored to original path');
  assert.equal(fs.existsSync(organizeResult.targetPath), false, 'File must no longer be at organized path');

  const historyAfterUndo = getHistory(1);
  assert.equal(historyAfterUndo[0].status, 'REVERTED');

  // 5. Test Safety Check: Missing or modified file on Undo (SRS 7.2)
  // Organize again
  const organizeResult2 = await organizer.organizeFile(testFile, { dryRun: false });
  assert.equal(organizeResult2.success, true);

  // Externally delete the file before calling undo
  fs.unlinkSync(organizeResult2.targetPath);

  const undoResultTampered = performUndo(1);
  assert.equal(undoResultTampered.revertedCount, 0);
  assert.equal(undoResultTampered.skippedCount, 1);
  assert.ok(
    undoResultTampered.items[0].message.includes('File target sudah dimodifikasi secara eksternal'),
    'Should report external modification warning'
  );

  fs.rmSync(testRoot, { recursive: true, force: true });
});

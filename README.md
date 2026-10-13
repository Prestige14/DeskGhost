# DeskGhost

A background service and CLI tool that semantically categorizes, renames, and organizes files in your `Desktop` and `Downloads` folders using multimodal AI (Ollama & Gemini) with atomic SQLite journaling and rollback (`undo`).

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![GitHub](https://img.shields.io/badge/GitHub-Prestige14%2FDeskGhost-black.svg)](https://github.com/Prestige14/DeskGhost)

---

## Overview

Traditional desktop cleanup scripts sort files solely by extension (moving all images to `Images/` and all PDFs to `PDFs/`). DeskGhost inspects the actual contents of files:

- **Images & Screenshots:** Downscaled using `sharp` and analyzed via vision models (Ollama `moondream2` / `llama3.2-vision` or Gemini 1.5 Flash).
- **Documents & PDFs:** Extracted using `pdf-parse` and classified by document context (invoices, boarding passes, contracts, resumes).
- **Code, Data & Archives:** Categorized with structural heuristics into dedicated directories (`Development`, `Data`, `Archives`, `Installers`).
- **Atomic Undo:** Every operation is recorded in a local SQLite database (`~/.deskghost/deskghost.db`). Running `deskghost undo` restores files to their original names and locations with checksum validation.

---

## Requirements

- **Node.js:** v18.0.0 or later (tested on Node v20 and v24)
- **AI Provider (optional):**
  - **Local (default):** [Ollama](https://ollama.ai/) running locally on port 11434 (`ollama run moondream`)
  - **Cloud (fallback):** Google Gemini API key (`GEMINI_API_KEY`)
  - **Offline Heuristic:** If no AI model is reachable, DeskGhost falls back to a built-in semantic pattern classifier.

---

## Installation

### From Source

```bash
git clone https://github.com/Prestige14/DeskGhost.git
cd DeskGhost
npm install
npm run build
npm link
```

### Global NPM (once published)

```bash
npm install -g deskghost
```

---

## CLI Reference

### Commands

| Command | Description |
| :--- | :--- |
| `deskghost start` | Starts the background file system watcher daemon |
| `deskghost organize <path>` | Runs a one-time sweep on a file or directory |
| `deskghost organize <path> --dry-run` | Previews renaming and destination paths without moving files |
| `deskghost undo` | Reverts the last organization action |
| `deskghost undo --last <N>` | Reverts the last `N` actions in reverse chronological order |
| `deskghost history` | Displays recent file operations from the SQLite audit journal |
| `deskghost history --limit <N>` | Displays the last `N` journal records (default: 20) |
| `deskghost config` | Prints current configuration and paths |
| `deskghost config --json` | Outputs configuration in raw JSON format |
| `deskghost config --set-provider <provider>` | Sets primary provider (`ollama` or `gemini`) |
| `deskghost config --set-key <key>` | Sets Gemini API key |
| `deskghost config --show-path` | Prints the config file and SQLite database paths |

---

## Usage Examples

### 1. Previewing Changes (Dry Run)

```bash
deskghost organize ~/Downloads --dry-run
```

Output:
```
[DeskGhost] DRY-RUN PREVIEW: Processing 3 file(s)...

  ✓ [Travel] Garuda_Flight_E-Ticket_CGK_DPS.pdf
    └─ AI Name:   2026-10-10_Garuda_Flight.pdf
    └─ Reason:    Contains travel, flight, or booking references
    └─ Provider:  heuristic

  ✓ [Finances] invoice_98234.pdf
    └─ AI Name:   2026-10-10_Invoice.pdf
    └─ Reason:    Identified financial invoice or payment receipt keyword
    └─ Provider:  heuristic

[Summary] Total: 2 | Succeeded: 2 | Failed: 0
(Dry-run mode: no files were moved or changed on disk.)
```

### 2. Organizing a Directory

```bash
deskghost organize ~/Downloads
```

### 3. Reverting Accidental Moves

```bash
# Revert the last move
deskghost undo

# Revert the last 5 moves
deskghost undo --last 5
```

If a target file was deleted or modified externally after being organized, DeskGhost detects the checksum mismatch or missing target and safely halts the rollback for that file to prevent data corruption.

### 4. Background Watcher

```bash
deskghost start
```

Monitors configured directories (default: Desktop and Downloads). When a new file finishes downloading, it is classified and moved automatically.

---

## Configuration

Configuration is stored at `~/.deskghost/config.json`. It is generated automatically on first run with system-appropriate defaults:

```json
{
  "watchPaths": [
    "~/Desktop",
    "~/Downloads"
  ],
  "destinationRoot": "~/Documents/Organized",
  "ai": {
    "provider": "ollama",
    "model": "moondream",
    "fallbackProvider": "gemini",
    "geminiApiKey": "env:GEMINI_API_KEY",
    "ollamaBaseUrl": "http://127.0.0.1:11434"
  },
  "debounceMs": 3000,
  "notifications": true,
  "ignorePatterns": [
    "*.crdownload",
    "*.part",
    "*.tmp",
    ".DS_Store",
    "Thumbs.db",
    "desktop.ini",
    "node_modules",
    ".git",
    ".env*",
    "*.pem",
    "*.key",
    "id_rsa*"
  ],
  "maxConcurrency": 2
}
```

### Configuration Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `watchPaths` | `string[]` | `["~/Desktop", "~/Downloads"]` | Directories monitored by `deskghost start`. Auto-resolves OneDrive paths on Windows if present. |
| `destinationRoot` | `string` | `"~/Documents/Organized"` | Base directory where categorized folders (`Travel/`, `Finances/`, etc.) are created. |
| `ai.provider` | `string` | `"ollama"` | Primary classification provider (`"ollama"` or `"gemini"`). |
| `ai.model` | `string` | `"moondream"` | Model name for Ollama or Gemini. |
| `ai.fallbackProvider` | `string` | `"gemini"` | Backup provider if the primary provider is unreachable. |
| `ai.geminiApiKey` | `string` | `"env:GEMINI_API_KEY"` | API key string or environment variable reference. |
| `debounceMs` | `number` | `3000` | Milliseconds to wait after file creation before processing. |
| `notifications` | `boolean` | `true` | Enables native desktop notifications on file move. |
| `ignorePatterns` | `string[]` | *See above* | Glob patterns to ignore (temp downloads, secrets, system files). |
| `maxConcurrency` | `number` | `2` | Maximum number of files processed in parallel. |

---

## Architecture & Safety Guarantees

```
File Drop (Desktop / Downloads)
  │
  ▼
Chokidar Watcher (Debounce 3000ms + Temporary file filter)
  │
  ▼
Concurrency Queue (Max 2 parallel tasks)
  │
  ▼
Content Extractor:
  ├─ Images (.png, .jpg, .webp) ──> Sharp auto-resize (max 1280px)
  ├─ Documents (.pdf)           ──> pdf-parse text extraction
  └─ Text & Code (.csv, .md, ..)──> UTF-8 snippet reader
  │
  ▼
AI Router:
  ├─ 1. Primary Provider   (Ollama Vision / Text)
  ├─ 2. Fallback Provider  (Google Gemini 1.5 Flash)
  └─ 3. Heuristic Engine   (Local rules & metadata regex)
  │
  ▼
Collision Handling:
  └─ If file exists in destination, appends (1), (2), etc. Never overwrites.
  │
  ▼
Atomic File Move + SHA-256 Checksum
  │
  ▼
SQLite Audit Journal (~/.deskghost/deskghost.db)
  │
  ▼
Desktop Notification (node-notifier)
```

### Safety Rules

1. **Zero Overwrite Policy:** If a file with the target name already exists, numeric suffixes (`name (1).ext`) are applied sequentially.
2. **Sensitive File Exclusions:** Files matching `.env*`, `*.pem`, `*.key`, `id_rsa*`, and VCS directories are ignored and never transmitted to any AI provider.
3. **Lock & Download Guard:** Incomplete downloads (`.crdownload`, `.part`, `.tmp`) are ignored until the browser completes the download and renames the file.
4. **Verified Rollback:** The `undo` command validates target file presence and hash integrity before moving files back to their original path.

---

## Development & Testing

```bash
# Run TypeScript compilation
npm run build

# Watch mode during development
npm run watch

# Run test suite
npm test
```

### Test Coverage

Tests use Node.js's built-in test runner (`node --test`) and cover:
- Path resolution and configuration defaults
- Ignore patterns and temporary download file filters
- Concurrency queue throttling
- Image extraction and automatic resizing with `sharp`
- Heuristic AI classification across screenshots, travel, invoices, documents, data, and code
- Name collision handling (`(1)`, `(2)`)
- End-to-end atomic move, SQLite journal recording, and `undo` rollback with tamper protection

---

## License

MIT © 2026 DeskGhost Contributors.

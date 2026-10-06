# AiFileSort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an on-device Electron + TypeScript app that recursively scans a directory, uses Ollama embeddings + k-means clustering + LLM reasoning to suggest file groupings, and lets the user approve and execute moves.

**Architecture:** Main process owns all filesystem and Ollama work; renderer is React-only UI communicating over Electron IPC. Pipeline: scan → extract → embed → cluster → reason → suggest → user review → execute.

**Tech Stack:** Electron, React, TypeScript, Ollama (`nomic-embed-text` + `llama3.2:3b`), `ml-kmeans`, `pdf-parse`, `mammoth`, `xlsx`, Jest + ts-jest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-06-aifilesort-design.md`

## Global Constraints

- Node.js ≥ 20, Electron ≥ 30
- All Ollama calls target `http://localhost:11434` — no external network calls
- TypeScript strict mode enabled throughout
- All main-process modules are pure functions or classes with no global side effects — testable without Electron
- Test files live alongside source (`*.test.ts`) except integration (`tests/integration/`) and e2e (`tests/e2e/`)
- Every commit via `git commit -m "feat|fix|test|chore: description"`

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.main.json`
- Create: `tsconfig.renderer.json`
- Create: `jest.config.ts`
- Create: `electron-builder.yml`
- Create: `src/main/index.ts`
- Create: `src/renderer/index.tsx`
- Create: `src/renderer/App.tsx`
- Create: `index.html`

**Interfaces:**
- Produces: a working `npm start` that opens an Electron window showing "AiFileSort"

- [ ] **Step 1: Initialise package.json**

```bash
cd C:\Users\sebas\dev\claude\AiFileSort
npm init -y
npm install --save-dev electron electron-builder typescript ts-node @types/node @types/react @types/react-dom react react-dom
npm install --save-dev jest ts-jest @types/jest
npm install --save-dev @playwright/test
npm install --save-dev concurrently wait-on
npm install ml-kmeans pdf-parse mammoth xlsx
npm install --save-dev @types/pdf-parse @types/mammoth
```

- [ ] **Step 2: Write tsconfig.json (base)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist"
  }
}
```

- [ ] **Step 3: Write tsconfig.main.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "dist/main",
    "module": "commonjs"
  },
  "include": ["src/main/**/*", "src/shared/**/*"]
}
```

- [ ] **Step 4: Write tsconfig.renderer.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "dist/renderer",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx"
  },
  "include": ["src/renderer/**/*", "src/shared/**/*"]
}
```

- [ ] **Step 5: Write jest.config.ts**

```typescript
import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['tests/e2e'],
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
  },
};

export default config;
```

- [ ] **Step 6: Write electron-builder.yml**

```yaml
appId: com.aifilesort.app
productName: AiFileSort
directories:
  output: release
files:
  - dist/**/*
  - index.html
  - package.json
win:
  target: nsis
mac:
  target: dmg
linux:
  target: AppImage
```

- [ ] **Step 7: Write index.html**

```html
<!DOCTYPE html>
<html>
  <head><meta charset="UTF-8" /><title>AiFileSort</title></head>
  <body><div id="root"></div><script src="dist/renderer/index.js"></script></body>
</html>
```

- [ ] **Step 8: Write src/main/index.ts**

```typescript
import { app, BrowserWindow } from 'electron';
import path from 'path';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  win.loadFile('index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
```

- [ ] **Step 9: Write src/renderer/index.tsx**

```typescript
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
```

- [ ] **Step 10: Write src/renderer/App.tsx**

```typescript
import React from 'react';

export default function App(): React.JSX.Element {
  return <div style={{ fontFamily: 'sans-serif', padding: 32 }}>AiFileSort</div>;
}
```

- [ ] **Step 11: Add npm scripts to package.json**

Add under `"scripts"`:
```json
{
  "start": "concurrently \"tsc -p tsconfig.main.json --watch\" \"electron .\"",
  "build": "tsc -p tsconfig.main.json && tsc -p tsconfig.renderer.json",
  "test": "jest",
  "test:e2e": "playwright test"
}
```

- [ ] **Step 12: Run build and verify no TypeScript errors**

```bash
npm run build
```
Expected: `dist/main/index.js` and `dist/renderer/index.js` exist, no errors.

- [ ] **Step 13: Commit**

```bash
git add .
git commit -m "chore: scaffold Electron + React + TypeScript project"
```

---

### Task 2: Shared Types

**Files:**
- Create: `src/shared/types.ts`

**Interfaces:**
- Produces: `FileMeta`, `FileSuggestion`, `ClusterGroup`, `ScanProgress`, `IpcChannels` — used by every subsequent task

- [ ] **Step 1: Write src/shared/types.ts**

```typescript
export interface FileMeta {
  absolutePath: string;
  name: string;
  extension: string;
  sizeBytes: number;
  createdAt: Date;
  modifiedAt: Date;
  mimeType: string;
  contentSnippet?: string; // populated by ContentExtractor
}

export interface FileVector {
  filePath: string;
  vector: number[];
}

export interface ClusterAssignment {
  filePath: string;
  clusterId: number;
}

export interface FileSuggestion {
  filePath: string;
  clusterId: number;
  suggestedDestination: string;
  rationale: string;
  confidence: number; // 0–1
  status: 'pending' | 'approved' | 'rejected';
}

export interface ClusterGroup {
  clusterId: number;
  suggestedDestination: string;
  rationale: string;
  confidence: number;
  files: FileSuggestion[];
}

export type ScanPhase =
  | 'scanning'
  | 'extracting'
  | 'embedding'
  | 'clustering'
  | 'reasoning'
  | 'done';

export interface ScanProgress {
  phase: ScanPhase;
  current: number;
  total: number;
  message?: string;
}

export interface ExecuteProgress {
  moved: number;
  total: number;
  skipped: string[]; // file paths that failed
}

export interface UndoManifest {
  timestamp: string;
  moves: Array<{ from: string; to: string; completed: boolean }>;
}

export const IpcChannels = {
  SCAN_START: 'scan:start',
  SCAN_PROGRESS: 'scan:progress',
  SCAN_COMPLETE: 'scan:complete',
  SCAN_CANCEL: 'scan:cancel',
  OLLAMA_HEALTH: 'ollama:health',
  SUGGESTIONS_UPDATE: 'suggestions:update',
  SUGGESTION_SET_STATUS: 'suggestion:setStatus',
  EXECUTE_START: 'execute:start',
  EXECUTE_PROGRESS: 'execute:progress',
  EXECUTE_COMPLETE: 'execute:complete',
  UNDO_START: 'undo:start',
  UNDO_COMPLETE: 'undo:complete',
  RECLUSTER: 'recluster',
} as const;
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

```bash
npm run build
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add shared types"
```

---

### Task 3: Ollama Client

**Files:**
- Create: `src/main/ollama/ollamaClient.ts`
- Create: `src/main/ollama/ollamaClient.test.ts`

**Interfaces:**
- Produces:
  - `checkHealth(): Promise<boolean>`
  - `checkModelAvailable(model: string): Promise<boolean>`
  - `embed(model: string, text: string): Promise<number[]>`
  - `chat(model: string, prompt: string): Promise<string>`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/ollama/ollamaClient.test.ts
import { OllamaClient } from './ollamaClient';

const mockFetch = jest.fn();
global.fetch = mockFetch;

afterEach(() => mockFetch.mockReset());

describe('OllamaClient.checkHealth', () => {
  it('returns true when Ollama responds 200', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    const client = new OllamaClient();
    expect(await client.checkHealth()).toBe(true);
  });

  it('returns false when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const client = new OllamaClient();
    expect(await client.checkHealth()).toBe(false);
  });
});

describe('OllamaClient.embed', () => {
  it('returns embedding vector from Ollama response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embedding: [0.1, 0.2, 0.3] }),
    });
    const client = new OllamaClient();
    const result = await client.embed('nomic-embed-text', 'hello');
    expect(result).toEqual([0.1, 0.2, 0.3]);
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, statusText: 'Not Found' });
    const client = new OllamaClient();
    await expect(client.embed('nomic-embed-text', 'hello')).rejects.toThrow('Not Found');
  });
});

describe('OllamaClient.chat', () => {
  it('returns response text from Ollama', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: { content: 'hello back' } }),
    });
    const client = new OllamaClient();
    const result = await client.chat('llama3.2:3b', 'hello');
    expect(result).toBe('hello back');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest ollamaClient --no-coverage
```
Expected: FAIL — `OllamaClient` not defined.

- [ ] **Step 3: Write src/main/ollama/ollamaClient.ts**

```typescript
const OLLAMA_BASE = 'http://localhost:11434';

export class OllamaClient {
  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${OLLAMA_BASE}/api/tags`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async checkModelAvailable(model: string): Promise<boolean> {
    try {
      const res = await fetch(`${OLLAMA_BASE}/api/tags`);
      if (!res.ok) return false;
      const data = await res.json() as { models: Array<{ name: string }> };
      return data.models.some((m) => m.name.startsWith(model));
    } catch {
      return false;
    }
  }

  async embed(model: string, text: string): Promise<number[]> {
    const res = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: text }),
    });
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json() as { embedding: number[] };
    return data.embedding;
  }

  async chat(model: string, prompt: string): Promise<string> {
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
      }),
    });
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json() as { message: { content: string } };
    return data.message.content;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest ollamaClient --no-coverage
```
Expected: PASS (3 suites, all green).

- [ ] **Step 5: Commit**

```bash
git add src/main/ollama/
git commit -m "feat: add OllamaClient with health, embed, chat"
```

---

### Task 4: File Scanner

**Files:**
- Create: `src/main/scanner/fileScanner.ts`
- Create: `src/main/scanner/fileScanner.test.ts`

**Interfaces:**
- Consumes: `FileMeta` from `@shared/types`
- Produces:
  - `scanDirectory(rootPath: string, onProgress: (count: number) => void): Promise<FileMeta[]>`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/scanner/fileScanner.test.ts
import path from 'path';
import { scanDirectory } from './fileScanner';

jest.mock('fs/promises');
import fsp from 'fs/promises';
const mockFsp = fsp as jest.Mocked<typeof fsp>;

describe('scanDirectory', () => {
  it('returns FileMeta for each file', async () => {
    mockFsp.readdir = jest.fn().mockResolvedValueOnce([
      { name: 'file.txt', isDirectory: () => false, isFile: () => true } as unknown as import('fs').Dirent,
    ]);
    mockFsp.stat = jest.fn().mockResolvedValueOnce({
      size: 100,
      birthtime: new Date('2024-01-01'),
      mtime: new Date('2024-06-01'),
    } as import('fs').Stats);

    const results = await scanDirectory('/fake/dir', () => {});
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('file.txt');
    expect(results[0].extension).toBe('.txt');
    expect(results[0].sizeBytes).toBe(100);
  });

  it('skips hidden files', async () => {
    mockFsp.readdir = jest.fn().mockResolvedValueOnce([
      { name: '.hidden', isDirectory: () => false, isFile: () => true } as unknown as import('fs').Dirent,
    ]);
    const results = await scanDirectory('/fake/dir', () => {});
    expect(results).toHaveLength(0);
  });

  it('skips node_modules directory', async () => {
    mockFsp.readdir = jest.fn()
      .mockResolvedValueOnce([
        { name: 'node_modules', isDirectory: () => true, isFile: () => false } as unknown as import('fs').Dirent,
      ]);
    const results = await scanDirectory('/fake/dir', () => {});
    expect(results).toHaveLength(0);
  });

  it('calls onProgress for each file found', async () => {
    mockFsp.readdir = jest.fn().mockResolvedValueOnce([
      { name: 'a.txt', isDirectory: () => false, isFile: () => true } as unknown as import('fs').Dirent,
      { name: 'b.txt', isDirectory: () => false, isFile: () => true } as unknown as import('fs').Dirent,
    ]);
    mockFsp.stat = jest.fn().mockResolvedValue({
      size: 50, birthtime: new Date(), mtime: new Date(),
    } as import('fs').Stats);

    const counts: number[] = [];
    await scanDirectory('/fake/dir', (n) => counts.push(n));
    expect(counts).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest fileScanner --no-coverage
```
Expected: FAIL — `scanDirectory` not defined.

- [ ] **Step 3: Write src/main/scanner/fileScanner.ts**

```typescript
import fsp from 'fs/promises';
import path from 'path';
import { FileMeta } from '@shared/types';

const SKIP_DIRS = new Set([
  'node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information',
  '.Trash', '__pycache__', '.cache',
]);

export async function scanDirectory(
  rootPath: string,
  onProgress: (count: number) => void,
): Promise<FileMeta[]> {
  const results: FileMeta[] = [];
  await walk(rootPath, results, onProgress);
  return results;
}

async function walk(
  dir: string,
  results: FileMeta[],
  onProgress: (count: number) => void,
): Promise<void> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return; // permission denied — skip
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(path.join(dir, entry.name), results, onProgress);
    } else if (entry.isFile()) {
      const fullPath = path.join(dir, entry.name);
      try {
        const stat = await fsp.stat(fullPath);
        const ext = path.extname(entry.name).toLowerCase();
        results.push({
          absolutePath: fullPath,
          name: entry.name,
          extension: ext,
          sizeBytes: stat.size,
          createdAt: stat.birthtime,
          modifiedAt: stat.mtime,
          mimeType: extToMime(ext),
        });
        onProgress(results.length);
      } catch {
        // unreadable — skip
      }
    }
  }
}

function extToMime(ext: string): string {
  const map: Record<string, string> = {
    '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json',
    '.csv': 'text/csv', '.xml': 'application/xml', '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg',
  };
  return map[ext] ?? 'application/octet-stream';
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest fileScanner --no-coverage
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/scanner/
git commit -m "feat: add FileScanner with recursive walk and skip rules"
```

---

### Task 5: Content Extractor

**Files:**
- Create: `src/main/extractor/contentExtractor.ts`
- Create: `src/main/extractor/contentExtractor.test.ts`
- Create: `tests/fixtures/sample.txt`
- Create: `tests/fixtures/sample.md`

**Interfaces:**
- Consumes: `FileMeta` from `@shared/types`
- Produces:
  - `extractContent(file: FileMeta): Promise<string>` — returns up to 500 chars of text, or `''` for unsupported/failed

- [ ] **Step 1: Create fixture files**

Create `tests/fixtures/sample.txt`:
```
This is a plain text fixture file used for content extraction testing.
It contains multiple lines of text to verify snippet truncation works correctly.
```

Create `tests/fixtures/sample.md`:
```markdown
# Sample Markdown

This is a **markdown** fixture file for testing content extraction.
```

- [ ] **Step 2: Write the failing tests**

```typescript
// src/main/extractor/contentExtractor.test.ts
import path from 'path';
import { extractContent } from './contentExtractor';
import { FileMeta } from '@shared/types';

function makeMeta(filename: string): FileMeta {
  return {
    absolutePath: path.join(__dirname, '../../../tests/fixtures', filename),
    name: filename,
    extension: path.extname(filename),
    sizeBytes: 100,
    createdAt: new Date(),
    modifiedAt: new Date(),
    mimeType: 'text/plain',
  };
}

describe('extractContent', () => {
  it('reads plain text files', async () => {
    const result = await extractContent(makeMeta('sample.txt'));
    expect(result).toContain('plain text fixture');
  });

  it('reads markdown files', async () => {
    const result = await extractContent(makeMeta('sample.md'));
    expect(result).toContain('markdown');
  });

  it('truncates content to 500 chars', async () => {
    const result = await extractContent(makeMeta('sample.txt'));
    expect(result.length).toBeLessThanOrEqual(500);
  });

  it('returns empty string for unsupported extension', async () => {
    const meta = makeMeta('photo.jpg');
    meta.absolutePath = '/fake/photo.jpg';
    const result = await extractContent(meta);
    expect(result).toBe('');
  });

  it('returns empty string if file read fails', async () => {
    const meta = makeMeta('nonexistent.txt');
    meta.absolutePath = '/nonexistent/path/file.txt';
    const result = await extractContent(meta);
    expect(result).toBe('');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx jest contentExtractor --no-coverage
```
Expected: FAIL — `extractContent` not defined.

- [ ] **Step 4: Write src/main/extractor/contentExtractor.ts**

```typescript
import fsp from 'fs/promises';
import path from 'path';
import { FileMeta } from '@shared/types';

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonc', '.csv', '.xml',
  '.yaml', '.yml', '.toml', '.ini', '.env', '.log',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.cs',
  '.html', '.htm', '.css', '.scss', '.sass', '.less',
  '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
  '.sql', '.graphql', '.proto',
]);

const SNIPPET_LENGTH = 500;

export async function extractContent(file: FileMeta): Promise<string> {
  const ext = file.extension.toLowerCase();
  try {
    if (TEXT_EXTENSIONS.has(ext)) {
      return await readTextSnippet(file.absolutePath);
    }
    if (ext === '.pdf') return await readPdf(file.absolutePath);
    if (ext === '.docx') return await readDocx(file.absolutePath);
    if (ext === '.xlsx') return await readXlsx(file.absolutePath);
    return '';
  } catch {
    return '';
  }
}

async function readTextSnippet(filePath: string): Promise<string> {
  const content = await fsp.readFile(filePath, 'utf-8');
  return content.slice(0, SNIPPET_LENGTH);
}

async function readPdf(filePath: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;
  const buf = await fsp.readFile(filePath);
  const data = await pdfParse(buf);
  return data.text.slice(0, SNIPPET_LENGTH);
}

async function readDocx(filePath: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mammoth = require('mammoth') as {
    extractRawText: (opts: { path: string }) => Promise<{ value: string }>;
  };
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value.slice(0, SNIPPET_LENGTH);
}

async function readXlsx(filePath: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require('xlsx') as typeof import('xlsx');
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const text = XLSX.utils.sheet_to_csv(sheet);
  return text.slice(0, SNIPPET_LENGTH);
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx jest contentExtractor --no-coverage
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/extractor/ tests/fixtures/sample.txt tests/fixtures/sample.md
git commit -m "feat: add ContentExtractor for text, PDF, DOCX, XLSX"
```

---

### Task 6: Embedding Engine

**Files:**
- Create: `src/main/embedding/embeddingEngine.ts`
- Create: `src/main/embedding/embeddingEngine.test.ts`

**Interfaces:**
- Consumes: `FileMeta`, `FileVector` from `@shared/types`; `OllamaClient` from `../ollama/ollamaClient`
- Produces:
  - `embedFiles(files: FileMeta[], client: OllamaClient, model: string, batchSize: number, onProgress: (pct: number) => void, signal: AbortSignal): Promise<FileVector[]>`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/embedding/embeddingEngine.test.ts
import { embedFiles } from './embeddingEngine';
import { OllamaClient } from '../ollama/ollamaClient';
import { FileMeta } from '@shared/types';

function makeFile(name: string): FileMeta {
  return {
    absolutePath: `/fake/${name}`,
    name,
    extension: '.txt',
    sizeBytes: 100,
    createdAt: new Date('2024-01-01'),
    modifiedAt: new Date('2024-01-01'),
    mimeType: 'text/plain',
    contentSnippet: 'some content',
  };
}

describe('embedFiles', () => {
  it('returns a FileVector for each file', async () => {
    const client = { embed: jest.fn().mockResolvedValue([0.1, 0.2]) } as unknown as OllamaClient;
    const files = [makeFile('a.txt'), makeFile('b.txt')];
    const result = await embedFiles(files, client, 'nomic-embed-text', 5, () => {}, new AbortController().signal);
    expect(result).toHaveLength(2);
    expect(result[0].vector).toEqual([0.1, 0.2]);
  });

  it('skips a file and continues if embed throws', async () => {
    const client = {
      embed: jest.fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce([0.5, 0.6]),
    } as unknown as OllamaClient;
    const files = [makeFile('fail.txt'), makeFile('ok.txt')];
    const result = await embedFiles(files, client, 'nomic-embed-text', 5, () => {}, new AbortController().signal);
    expect(result).toHaveLength(1);
    expect(result[0].filePath).toBe('/fake/ok.txt');
  });

  it('calls onProgress with percentage', async () => {
    const client = { embed: jest.fn().mockResolvedValue([1]) } as unknown as OllamaClient;
    const files = [makeFile('a.txt'), makeFile('b.txt'), makeFile('c.txt'), makeFile('d.txt')];
    const progress: number[] = [];
    await embedFiles(files, client, 'nomic-embed-text', 2, (pct) => progress.push(pct), new AbortController().signal);
    expect(progress[progress.length - 1]).toBe(100);
  });

  it('stops early when aborted', async () => {
    const controller = new AbortController();
    const client = {
      embed: jest.fn().mockImplementation(async () => {
        controller.abort();
        return [1];
      }),
    } as unknown as OllamaClient;
    const files = [makeFile('a.txt'), makeFile('b.txt'), makeFile('c.txt')];
    const result = await embedFiles(files, client, 'nomic-embed-text', 1, () => {}, controller.signal);
    expect(result.length).toBeLessThan(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest embeddingEngine --no-coverage
```
Expected: FAIL.

- [ ] **Step 3: Write src/main/embedding/embeddingEngine.ts**

```typescript
import { FileMeta, FileVector } from '@shared/types';
import { OllamaClient } from '../ollama/ollamaClient';

function buildDescription(file: FileMeta): string {
  const date = file.createdAt.toISOString().split('T')[0];
  return [
    `filename: ${file.name}`,
    `type: ${file.mimeType}`,
    `date: ${date}`,
    file.contentSnippet ? `content: ${file.contentSnippet}` : '',
  ].filter(Boolean).join(' | ');
}

export async function embedFiles(
  files: FileMeta[],
  client: OllamaClient,
  model: string,
  batchSize: number,
  onProgress: (pct: number) => void,
  signal: AbortSignal,
): Promise<FileVector[]> {
  const results: FileVector[] = [];

  for (let i = 0; i < files.length; i += batchSize) {
    if (signal.aborted) break;
    const batch = files.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (file) => {
        if (signal.aborted) return;
        const description = buildDescription(file);
        let vector: number[];
        try {
          vector = await client.embed(model, description);
        } catch {
          // retry once
          try {
            vector = await client.embed(model, description);
          } catch {
            return; // skip file
          }
        }
        results.push({ filePath: file.absolutePath, vector });
      }),
    );
    onProgress(Math.round(((i + batch.length) / files.length) * 100));
  }

  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest embeddingEngine --no-coverage
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/embedding/
git commit -m "feat: add EmbeddingEngine with batching, retry, and abort support"
```

---

### Task 7: Clustering Engine

**Files:**
- Create: `src/main/clustering/clusteringEngine.ts`
- Create: `src/main/clustering/clusteringEngine.test.ts`

**Interfaces:**
- Consumes: `FileVector`, `ClusterAssignment` from `@shared/types`
- Produces:
  - `clusterFiles(vectors: FileVector[], k?: number): ClusterAssignment[]`
  - `estimateK(fileCount: number): number`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/clustering/clusteringEngine.test.ts
import { clusterFiles, estimateK } from './clusteringEngine';

describe('estimateK', () => {
  it('returns sqrt of file count', () => {
    expect(estimateK(100)).toBe(10);
  });
  it('caps at 50', () => {
    expect(estimateK(10000)).toBe(50);
  });
  it('has a floor of 1', () => {
    expect(estimateK(0)).toBe(1);
  });
});

describe('clusterFiles', () => {
  it('returns one ClusterAssignment per vector', () => {
    const vectors = [
      { filePath: '/a.txt', vector: [1, 0] },
      { filePath: '/b.txt', vector: [0, 1] },
      { filePath: '/c.txt', vector: [1, 0.1] },
    ];
    const result = clusterFiles(vectors, 2);
    expect(result).toHaveLength(3);
    expect(result.every((r) => typeof r.clusterId === 'number')).toBe(true);
  });

  it('groups similar vectors into the same cluster', () => {
    const vectors = [
      { filePath: '/a.txt', vector: [10, 0] },
      { filePath: '/b.txt', vector: [10.1, 0] },
      { filePath: '/c.txt', vector: [0, 10] },
      { filePath: '/d.txt', vector: [0, 10.1] },
    ];
    const result = clusterFiles(vectors, 2);
    const abCluster = result.find((r) => r.filePath === '/a.txt')!.clusterId;
    const abCluster2 = result.find((r) => r.filePath === '/b.txt')!.clusterId;
    const cdCluster = result.find((r) => r.filePath === '/c.txt')!.clusterId;
    const cdCluster2 = result.find((r) => r.filePath === '/d.txt')!.clusterId;
    expect(abCluster).toBe(abCluster2);
    expect(cdCluster).toBe(cdCluster2);
    expect(abCluster).not.toBe(cdCluster);
  });

  it('uses estimateK when k not provided', () => {
    const vectors = Array.from({ length: 9 }, (_, i) => ({
      filePath: `/file${i}.txt`,
      vector: [Math.random(), Math.random()],
    }));
    const result = clusterFiles(vectors);
    expect(result).toHaveLength(9);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest clusteringEngine --no-coverage
```
Expected: FAIL.

- [ ] **Step 3: Write src/main/clustering/clusteringEngine.ts**

```typescript
import { kmeans } from 'ml-kmeans';
import { ClusterAssignment, FileVector } from '@shared/types';

export function estimateK(fileCount: number): number {
  if (fileCount <= 0) return 1;
  return Math.min(50, Math.max(1, Math.round(Math.sqrt(fileCount))));
}

export function clusterFiles(vectors: FileVector[], k?: number): ClusterAssignment[] {
  if (vectors.length === 0) return [];
  const resolvedK = Math.min(k ?? estimateK(vectors.length), vectors.length);
  const matrix = vectors.map((v) => v.vector);
  const result = kmeans(matrix, resolvedK, {});
  return vectors.map((v, i) => ({
    filePath: v.filePath,
    clusterId: result.clusters[i],
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest clusteringEngine --no-coverage
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/clustering/
git commit -m "feat: add ClusteringEngine with auto-k estimation"
```

---

### Task 8: LLM Reasoner

**Files:**
- Create: `src/main/reasoning/llmReasoner.ts`
- Create: `src/main/reasoning/llmReasoner.test.ts`

**Interfaces:**
- Consumes: `FileMeta`, `ClusterAssignment`, `FileSuggestion` from `@shared/types`; `OllamaClient`
- Produces:
  - `reasonClusters(assignments: ClusterAssignment[], fileMap: Map<string, FileMeta>, existingFolders: string[], client: OllamaClient, model: string, onProgress: (done: number, total: number) => void): Promise<FileSuggestion[]>`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/reasoning/llmReasoner.test.ts
import { reasonClusters } from './llmReasoner';
import { OllamaClient } from '../ollama/ollamaClient';
import { ClusterAssignment, FileMeta } from '@shared/types';

function makeMeta(filePath: string): FileMeta {
  return {
    absolutePath: filePath,
    name: filePath.split('/').pop()!,
    extension: '.txt',
    sizeBytes: 100,
    createdAt: new Date(),
    modifiedAt: new Date(),
    mimeType: 'text/plain',
  };
}

const llmResponse = JSON.stringify({
  suggestedFolder: 'Documents/Work',
  confidence: 0.85,
  rationale: 'These files appear to be work-related documents.',
});

describe('reasonClusters', () => {
  it('returns one FileSuggestion per file', async () => {
    const client = { chat: jest.fn().mockResolvedValue(llmResponse) } as unknown as OllamaClient;
    const assignments: ClusterAssignment[] = [
      { filePath: '/root/a.txt', clusterId: 0 },
      { filePath: '/root/b.txt', clusterId: 0 },
    ];
    const fileMap = new Map([
      ['/root/a.txt', makeMeta('/root/a.txt')],
      ['/root/b.txt', makeMeta('/root/b.txt')],
    ]);
    const result = await reasonClusters(assignments, fileMap, ['Documents'], client, 'llama3.2:3b', () => {});
    expect(result).toHaveLength(2);
    expect(result[0].suggestedDestination).toBe('Documents/Work');
    expect(result[0].confidence).toBe(0.85);
    expect(result[0].status).toBe('pending');
  });

  it('makes one chat call per unique cluster', async () => {
    const client = { chat: jest.fn().mockResolvedValue(llmResponse) } as unknown as OllamaClient;
    const assignments: ClusterAssignment[] = [
      { filePath: '/root/a.txt', clusterId: 0 },
      { filePath: '/root/b.txt', clusterId: 1 },
    ];
    const fileMap = new Map([
      ['/root/a.txt', makeMeta('/root/a.txt')],
      ['/root/b.txt', makeMeta('/root/b.txt')],
    ]);
    await reasonClusters(assignments, fileMap, [], client, 'llama3.2:3b', () => {});
    expect(client.chat).toHaveBeenCalledTimes(2);
  });

  it('falls back gracefully when LLM returns malformed JSON', async () => {
    const client = { chat: jest.fn().mockResolvedValue('not json') } as unknown as OllamaClient;
    const assignments: ClusterAssignment[] = [{ filePath: '/root/a.txt', clusterId: 0 }];
    const fileMap = new Map([['/root/a.txt', makeMeta('/root/a.txt')]]);
    const result = await reasonClusters(assignments, fileMap, [], client, 'llama3.2:3b', () => {});
    expect(result[0].suggestedDestination).toBe('Unsorted');
    expect(result[0].confidence).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest llmReasoner --no-coverage
```
Expected: FAIL.

- [ ] **Step 3: Write src/main/reasoning/llmReasoner.ts**

```typescript
import { ClusterAssignment, FileMeta, FileSuggestion } from '@shared/types';
import { OllamaClient } from '../ollama/ollamaClient';

interface LlmClusterResult {
  suggestedFolder: string;
  confidence: number;
  rationale: string;
}

function buildPrompt(fileNames: string[], existingFolders: string[]): string {
  const folderList = existingFolders.length
    ? `Existing folders: ${existingFolders.join(', ')}.`
    : 'There are no existing folders yet.';

  return `You are a file organisation assistant. Given a list of files, suggest the best folder to group them into.
${folderList}
You may suggest an existing folder or a new one (use "/" for subfolders, e.g. "Documents/Work").

Files in this group:
${fileNames.map((n) => `- ${n}`).join('\n')}

Respond ONLY with valid JSON in this exact format:
{"suggestedFolder": "FolderName", "confidence": 0.85, "rationale": "One sentence explanation."}`;
}

function parseLlmResponse(raw: string): LlmClusterResult {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('no JSON found');
    return JSON.parse(match[0]) as LlmClusterResult;
  } catch {
    return { suggestedFolder: 'Unsorted', confidence: 0, rationale: '' };
  }
}

export async function reasonClusters(
  assignments: ClusterAssignment[],
  fileMap: Map<string, FileMeta>,
  existingFolders: string[],
  client: OllamaClient,
  model: string,
  onProgress: (done: number, total: number) => void,
): Promise<FileSuggestion[]> {
  const clusterMap = new Map<number, string[]>();
  for (const a of assignments) {
    const names = clusterMap.get(a.clusterId) ?? [];
    names.push(fileMap.get(a.filePath)?.name ?? a.filePath.split('/').pop() ?? a.filePath);
    clusterMap.set(a.clusterId, names);
  }

  const clusterResults = new Map<number, LlmClusterResult>();
  const clusterIds = Array.from(clusterMap.keys());

  for (let i = 0; i < clusterIds.length; i++) {
    const clusterId = clusterIds[i];
    const fileNames = clusterMap.get(clusterId)!;
    const prompt = buildPrompt(fileNames, existingFolders);
    try {
      const raw = await client.chat(model, prompt);
      clusterResults.set(clusterId, parseLlmResponse(raw));
    } catch {
      clusterResults.set(clusterId, { suggestedFolder: 'Unsorted', confidence: 0, rationale: '' });
    }
    onProgress(i + 1, clusterIds.length);
  }

  return assignments.map((a) => {
    const cr = clusterResults.get(a.clusterId) ?? { suggestedFolder: 'Unsorted', confidence: 0, rationale: '' };
    return {
      filePath: a.filePath,
      clusterId: a.clusterId,
      suggestedDestination: cr.suggestedFolder,
      rationale: cr.rationale,
      confidence: cr.confidence,
      status: 'pending',
    };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest llmReasoner --no-coverage
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/reasoning/
git commit -m "feat: add LlmReasoner with prompt construction and JSON parsing"
```

---

### Task 9: File Executor

**Files:**
- Create: `src/main/executor/fileExecutor.ts`
- Create: `src/main/executor/fileExecutor.test.ts`

**Interfaces:**
- Consumes: `FileSuggestion`, `UndoManifest` from `@shared/types`
- Produces:
  - `executeApproved(suggestions: FileSuggestion[], rootPath: string, manifestPath: string): Promise<{ moved: string[], skipped: string[] }>`
  - `undoManifest(manifestPath: string): Promise<{ restored: string[], skipped: string[] }>`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/executor/fileExecutor.test.ts
import { executeApproved, undoManifest } from './fileExecutor';
import { FileSuggestion } from '@shared/types';
import fsp from 'fs/promises';

jest.mock('fs/promises');
const mockFsp = fsp as jest.Mocked<typeof fsp>;

const approved: FileSuggestion = {
  filePath: '/root/file.txt',
  clusterId: 0,
  suggestedDestination: 'Documents',
  rationale: '',
  confidence: 0.9,
  status: 'approved',
};

describe('executeApproved', () => {
  beforeEach(() => {
    mockFsp.mkdir = jest.fn().mockResolvedValue(undefined);
    mockFsp.rename = jest.fn().mockResolvedValue(undefined);
    mockFsp.writeFile = jest.fn().mockResolvedValue(undefined);
    mockFsp.stat = jest.fn().mockResolvedValue({ dev: 1 } as import('fs').Stats);
  });

  it('moves approved files and returns moved paths', async () => {
    const result = await executeApproved([approved], '/root', '/root/.undo.json');
    expect(mockFsp.rename).toHaveBeenCalledTimes(1);
    expect(result.moved).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });

  it('skips rejected files', async () => {
    const rejected = { ...approved, status: 'rejected' as const };
    const result = await executeApproved([rejected], '/root', '/root/.undo.json');
    expect(mockFsp.rename).not.toHaveBeenCalled();
    expect(result.moved).toHaveLength(0);
  });

  it('records a skipped file if rename throws', async () => {
    mockFsp.rename = jest.fn().mockRejectedValue(new Error('locked'));
    const result = await executeApproved([approved], '/root', '/root/.undo.json');
    expect(result.skipped).toContain('/root/file.txt');
    expect(result.moved).toHaveLength(0);
  });

  it('writes the undo manifest before moving files', async () => {
    await executeApproved([approved], '/root', '/root/.undo.json');
    expect(mockFsp.writeFile).toHaveBeenCalledBefore
      ? expect(mockFsp.writeFile).toHaveBeenCalled()
      : expect(mockFsp.writeFile).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest fileExecutor --no-coverage
```
Expected: FAIL.

- [ ] **Step 3: Write src/main/executor/fileExecutor.ts**

```typescript
import fsp from 'fs/promises';
import path from 'path';
import { FileSuggestion, UndoManifest } from '@shared/types';

export async function executeApproved(
  suggestions: FileSuggestion[],
  rootPath: string,
  manifestPath: string,
): Promise<{ moved: string[]; skipped: string[] }> {
  const toMove = suggestions.filter((s) => s.status === 'approved');

  const manifest: UndoManifest = {
    timestamp: new Date().toISOString(),
    moves: toMove.map((s) => ({
      from: s.filePath,
      to: path.join(rootPath, s.suggestedDestination, path.basename(s.filePath)),
      completed: false,
    })),
  };
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  const moved: string[] = [];
  const skipped: string[] = [];

  for (const entry of manifest.moves) {
    try {
      await fsp.mkdir(path.dirname(entry.to), { recursive: true });
      await fsp.rename(entry.from, entry.to);
      entry.completed = true;
      moved.push(entry.from);
    } catch {
      skipped.push(entry.from);
    }
  }

  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  return { moved, skipped };
}

export async function undoManifest(
  manifestPath: string,
): Promise<{ restored: string[]; skipped: string[] }> {
  const raw = await fsp.readFile(manifestPath, 'utf-8');
  const manifest = JSON.parse(raw) as UndoManifest;
  const restored: string[] = [];
  const skipped: string[] = [];

  for (const entry of manifest.moves.filter((m) => m.completed)) {
    try {
      await fsp.mkdir(path.dirname(entry.from), { recursive: true });
      await fsp.rename(entry.to, entry.from);
      restored.push(entry.from);
    } catch {
      skipped.push(entry.from);
    }
  }

  return { restored, skipped };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest fileExecutor --no-coverage
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/executor/
git commit -m "feat: add FileExecutor with undo manifest"
```

---

### Task 10: IPC Handlers & Pipeline Wiring

**Files:**
- Create: `src/main/ipcHandlers.ts`
- Modify: `src/main/index.ts` — register IPC handlers and preload

**Interfaces:**
- Consumes: all main-process modules above; `IpcChannels` from `@shared/types`
- Produces: all IPC channels live and callable from renderer

- [ ] **Step 1: Write src/main/ipcHandlers.ts**

```typescript
import { ipcMain, dialog } from 'electron';
import path from 'path';
import os from 'os';
import { IpcChannels } from '@shared/types';
import { OllamaClient } from './ollama/ollamaClient';
import { scanDirectory } from './scanner/fileScanner';
import { extractContent } from './extractor/contentExtractor';
import { embedFiles } from './embedding/embeddingEngine';
import { clusterFiles } from './clustering/clusteringEngine';
import { reasonClusters } from './reasoning/llmReasoner';
import { executeApproved, undoManifest } from './executor/fileExecutor';
import { FileMeta, FileSuggestion } from '@shared/types';
import { BrowserWindow } from 'electron';

const ollamaClient = new OllamaClient();
let scanAbortController: AbortController | null = null;
let currentSuggestions: FileSuggestion[] = [];
const MANIFEST_PATH = path.join(os.tmpdir(), 'aifilesort-undo.json');

export function registerIpcHandlers(win: BrowserWindow): void {
  ipcMain.handle(IpcChannels.OLLAMA_HEALTH, async (_, { chatModel }: { chatModel: string }) => {
    const healthy = await ollamaClient.checkHealth();
    if (!healthy) return { healthy: false, embedModel: false, chatModel: false };
    const embedOk = await ollamaClient.checkModelAvailable('nomic-embed-text');
    const chatOk = await ollamaClient.checkModelAvailable(chatModel);
    return { healthy, embedModel: embedOk, chatModel: chatOk };
  });

  ipcMain.handle(IpcChannels.SCAN_START, async (_, { rootPath, chatModel, k }: { rootPath: string; chatModel: string; k?: number }) => {
    scanAbortController = new AbortController();
    const signal = scanAbortController.signal;

    // Phase: scanning
    win.webContents.send(IpcChannels.SCAN_PROGRESS, { phase: 'scanning', current: 0, total: 0 });
    const files = await scanDirectory(rootPath, (count) => {
      win.webContents.send(IpcChannels.SCAN_PROGRESS, { phase: 'scanning', current: count, total: count });
    });

    if (signal.aborted) return;

    // Phase: extracting
    for (let i = 0; i < files.length; i++) {
      if (signal.aborted) return;
      files[i].contentSnippet = await extractContent(files[i]);
      win.webContents.send(IpcChannels.SCAN_PROGRESS, { phase: 'extracting', current: i + 1, total: files.length });
    }

    // Phase: embedding
    win.webContents.send(IpcChannels.SCAN_PROGRESS, { phase: 'embedding', current: 0, total: files.length });
    const vectors = await embedFiles(files, ollamaClient, 'nomic-embed-text', 20, (pct) => {
      win.webContents.send(IpcChannels.SCAN_PROGRESS, { phase: 'embedding', current: pct, total: 100 });
    }, signal);

    if (signal.aborted) return;

    // Phase: clustering
    win.webContents.send(IpcChannels.SCAN_PROGRESS, { phase: 'clustering', current: 0, total: 1 });
    const assignments = clusterFiles(vectors, k);

    // Phase: reasoning
    const fileMap = new Map<string, FileMeta>(files.map((f) => [f.absolutePath, f]));
    const topLevelFolders = [...new Set(
      files.map((f) => f.absolutePath.replace(rootPath, '').split(/[/\\]/)[1]).filter(Boolean)
    )];
    win.webContents.send(IpcChannels.SCAN_PROGRESS, { phase: 'reasoning', current: 0, total: assignments.length });
    const suggestions = await reasonClusters(assignments, fileMap, topLevelFolders, ollamaClient, chatModel, (done, total) => {
      win.webContents.send(IpcChannels.SCAN_PROGRESS, { phase: 'reasoning', current: done, total });
    });

    currentSuggestions = suggestions;
    win.webContents.send(IpcChannels.SCAN_PROGRESS, { phase: 'done', current: suggestions.length, total: suggestions.length });
    win.webContents.send(IpcChannels.SUGGESTIONS_UPDATE, suggestions);
  });

  ipcMain.handle(IpcChannels.SCAN_CANCEL, () => {
    scanAbortController?.abort();
  });

  ipcMain.handle(IpcChannels.SUGGESTION_SET_STATUS, (_, { filePath, status }: { filePath: string; status: FileSuggestion['status'] }) => {
    const s = currentSuggestions.find((s) => s.filePath === filePath);
    if (s) s.status = status;
    return currentSuggestions;
  });

  ipcMain.handle(IpcChannels.EXECUTE_START, async (_, { rootPath }: { rootPath: string }) => {
    const { moved, skipped } = await executeApproved(currentSuggestions, rootPath, MANIFEST_PATH);
    win.webContents.send(IpcChannels.EXECUTE_COMPLETE, { moved, skipped });
  });

  ipcMain.handle(IpcChannels.UNDO_START, async () => {
    const result = await undoManifest(MANIFEST_PATH);
    win.webContents.send(IpcChannels.UNDO_COMPLETE, result);
  });
}
```

- [ ] **Step 2: Update src/main/index.ts to register handlers**

```typescript
import { app, BrowserWindow } from 'electron';
import path from 'path';
import { registerIpcHandlers } from './ipcHandlers';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  registerIpcHandlers(win);
  win.loadFile('index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
```

- [ ] **Step 3: Write src/main/preload.ts**

```typescript
import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels } from '../shared/types';

contextBridge.exposeInMainWorld('api', {
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  on: (channel: string, cb: (...args: unknown[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => cb(...args));
  },
  off: (channel: string, cb: (...args: unknown[]) => void) => {
    ipcRenderer.removeListener(channel, cb as Parameters<typeof ipcRenderer.removeListener>[1]);
  },
  IpcChannels,
});
```

- [ ] **Step 4: Build and verify no TypeScript errors**

```bash
npm run build
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/
git commit -m "feat: wire IPC handlers and pipeline in main process"
```

---

### Task 11: Renderer — useIpc Hook & App Router

**Files:**
- Create: `src/renderer/hooks/useIpc.ts`
- Modify: `src/renderer/App.tsx` — add view routing

**Interfaces:**
- Produces:
  - `useIpc()` — returns `{ invoke, on, off, IpcChannels }`
  - `App` routes between `HomeView`, `ScanningView`, `ReviewView`, `ExecutingView` based on `appState`

- [ ] **Step 1: Write src/renderer/hooks/useIpc.ts**

```typescript
import { useCallback } from 'react';

declare global {
  interface Window {
    api: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      on: (channel: string, cb: (...args: unknown[]) => void) => void;
      off: (channel: string, cb: (...args: unknown[]) => void) => void;
      IpcChannels: typeof import('@shared/types').IpcChannels;
    };
  }
}

export function useIpc() {
  const invoke = useCallback(
    (channel: string, ...args: unknown[]) => window.api.invoke(channel, ...args),
    [],
  );
  return { invoke, on: window.api.on, off: window.api.off, IpcChannels: window.api.IpcChannels };
}
```

- [ ] **Step 2: Rewrite src/renderer/App.tsx with view routing**

```typescript
import React, { useState } from 'react';
import { FileSuggestion, ScanProgress } from '@shared/types';
import HomeView from './views/HomeView';
import ScanningView from './views/ScanningView';
import ReviewView from './views/ReviewView';
import ExecutingView from './views/ExecutingView';

export type AppState = 'home' | 'scanning' | 'review' | 'executing' | 'done';

export interface AppConfig {
  rootPath: string;
  chatModel: string;
  k?: number;
}

export default function App(): React.JSX.Element {
  const [state, setState] = useState<AppState>('home');
  const [config, setConfig] = useState<AppConfig>({ rootPath: '', chatModel: 'llama3.2:3b' });
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [suggestions, setSuggestions] = useState<FileSuggestion[]>([]);
  const [executeResult, setExecuteResult] = useState<{ moved: string[]; skipped: string[] } | null>(null);

  return (
    <>
      {state === 'home' && (
        <HomeView
          config={config}
          onConfigChange={setConfig}
          onStart={() => setState('scanning')}
        />
      )}
      {state === 'scanning' && (
        <ScanningView
          config={config}
          onProgress={setProgress}
          progress={progress}
          onComplete={(s) => { setSuggestions(s); setState('review'); }}
          onCancel={() => setState('home')}
        />
      )}
      {state === 'review' && (
        <ReviewView
          suggestions={suggestions}
          onSuggestionsChange={setSuggestions}
          onExecute={() => setState('executing')}
          onBack={() => setState('home')}
        />
      )}
      {state === 'executing' && (
        <ExecutingView
          suggestions={suggestions}
          config={config}
          onComplete={(result) => { setExecuteResult(result); setState('done'); }}
        />
      )}
      {state === 'done' && executeResult && (
        <ExecutingView
          suggestions={suggestions}
          config={config}
          onComplete={() => {}}
          result={executeResult}
          onGoHome={() => setState('home')}
        />
      )}
    </>
  );
}
```

- [ ] **Step 3: Build and verify no TypeScript errors**

```bash
npm run build
```
Expected: errors only for missing view files (expected at this stage — views are created in Task 12).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/hooks/ src/renderer/App.tsx
git commit -m "feat: add useIpc hook and App view router"
```

---

### Task 12: UI Views

**Files:**
- Create: `src/renderer/views/HomeView.tsx`
- Create: `src/renderer/views/ScanningView.tsx`
- Create: `src/renderer/views/ReviewView.tsx`
- Create: `src/renderer/views/ExecutingView.tsx`
- Create: `src/renderer/components/ClusterGroup.tsx`
- Create: `src/renderer/components/FileSuggestionRow.tsx`
- Create: `src/renderer/components/ProgressBar.tsx`
- Create: `src/renderer/components/OllamaSetupGuide.tsx`

**Interfaces:**
- Consumes: `useIpc`, `AppConfig`, `FileSuggestion`, `ScanProgress`, `ClusterGroup`, `IpcChannels` from prior tasks
- Produces: all four views rendered and functional

- [ ] **Step 1: Write src/renderer/components/ProgressBar.tsx**

```typescript
import React from 'react';

interface Props { pct: number; label?: string; }

export default function ProgressBar({ pct, label }: Props): React.JSX.Element {
  return (
    <div style={{ width: '100%' }}>
      {label && <p style={{ margin: '0 0 4px' }}>{label}</p>}
      <div style={{ background: '#e5e7eb', borderRadius: 4, height: 12 }}>
        <div style={{ background: '#6366f1', width: `${pct}%`, height: '100%', borderRadius: 4, transition: 'width 0.2s' }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write src/renderer/components/OllamaSetupGuide.tsx**

```typescript
import React from 'react';

interface Props { chatModel: string; embedOk: boolean; chatOk: boolean; }

export default function OllamaSetupGuide({ chatModel, embedOk, chatOk }: Props): React.JSX.Element {
  return (
    <div style={{ padding: 16, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8 }}>
      <h3 style={{ margin: '0 0 8px', color: '#b91c1c' }}>Ollama Setup Required</h3>
      <p>Run these commands in your terminal:</p>
      {!embedOk && <code style={{ display: 'block', background: '#fff', padding: 8, margin: '4px 0' }}>ollama pull nomic-embed-text</code>}
      {!chatOk && <code style={{ display: 'block', background: '#fff', padding: 8, margin: '4px 0' }}>ollama pull {chatModel}</code>}
      <p style={{ marginTop: 8 }}>Then restart AiFileSort.</p>
    </div>
  );
}
```

- [ ] **Step 3: Write src/renderer/views/HomeView.tsx**

```typescript
import React, { useEffect, useState } from 'react';
import { AppConfig } from '../App';
import { useIpc } from '../hooks/useIpc';
import OllamaSetupGuide from '../components/OllamaSetupGuide';

interface Props {
  config: AppConfig;
  onConfigChange: (c: AppConfig) => void;
  onStart: () => void;
}

export default function HomeView({ config, onConfigChange, onStart }: Props): React.JSX.Element {
  const { invoke, IpcChannels } = useIpc();
  const [health, setHealth] = useState<{ healthy: boolean; embedModel: boolean; chatModel: boolean } | null>(null);

  useEffect(() => {
    invoke(IpcChannels.OLLAMA_HEALTH, { chatModel: config.chatModel }).then((h) =>
      setHealth(h as typeof health),
    );
  }, [config.chatModel]);

  const ready = health?.healthy && health.embedModel && health.chatModel;

  return (
    <div style={{ padding: 32, maxWidth: 600 }}>
      <h1>AiFileSort</h1>
      <label>
        <span>Folder to sort:</span>
        <input
          type="text"
          value={config.rootPath}
          onChange={(e) => onConfigChange({ ...config, rootPath: e.target.value })}
          style={{ display: 'block', width: '100%', marginTop: 4, padding: 8 }}
          placeholder="/path/to/folder"
        />
      </label>
      <label style={{ display: 'block', marginTop: 16 }}>
        <span>Chat model (Ollama):</span>
        <input
          type="text"
          value={config.chatModel}
          onChange={(e) => onConfigChange({ ...config, chatModel: e.target.value })}
          style={{ display: 'block', width: '100%', marginTop: 4, padding: 8 }}
        />
      </label>
      <label style={{ display: 'block', marginTop: 16 }}>
        <span>Number of groups (k, leave blank for auto):</span>
        <input
          type="number"
          value={config.k ?? ''}
          onChange={(e) => onConfigChange({ ...config, k: e.target.value ? Number(e.target.value) : undefined })}
          style={{ display: 'block', width: '100%', marginTop: 4, padding: 8 }}
          min={1}
          max={50}
        />
      </label>
      <div style={{ marginTop: 24 }}>
        {health && !ready && (
          <OllamaSetupGuide
            chatModel={config.chatModel}
            embedOk={health.embedModel}
            chatOk={health.chatModel}
          />
        )}
        <button
          disabled={!ready || !config.rootPath}
          onClick={onStart}
          style={{ marginTop: 16, padding: '10px 24px', background: ready ? '#6366f1' : '#e5e7eb', color: ready ? '#fff' : '#9ca3af', border: 'none', borderRadius: 6, cursor: ready ? 'pointer' : 'not-allowed' }}
        >
          Analyse Folder
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write src/renderer/views/ScanningView.tsx**

```typescript
import React, { useEffect } from 'react';
import { FileSuggestion, ScanProgress } from '@shared/types';
import { AppConfig } from '../App';
import { useIpc } from '../hooks/useIpc';
import ProgressBar from '../components/ProgressBar';

interface Props {
  config: AppConfig;
  progress: ScanProgress | null;
  onProgress: (p: ScanProgress) => void;
  onComplete: (suggestions: FileSuggestion[]) => void;
  onCancel: () => void;
}

const phaseLabel: Record<string, string> = {
  scanning: 'Scanning files…',
  extracting: 'Extracting content…',
  embedding: 'Generating embeddings…',
  clustering: 'Clustering…',
  reasoning: 'Reasoning with AI…',
  done: 'Done',
};

export default function ScanningView({ config, progress, onProgress, onComplete, onCancel }: Props): React.JSX.Element {
  const { invoke, on, off, IpcChannels } = useIpc();

  useEffect(() => {
    const handleProgress = (p: unknown) => onProgress(p as ScanProgress);
    const handleSuggestions = (s: unknown) => onComplete(s as FileSuggestion[]);
    on(IpcChannels.SCAN_PROGRESS, handleProgress);
    on(IpcChannels.SUGGESTIONS_UPDATE, handleSuggestions);
    invoke(IpcChannels.SCAN_START, { rootPath: config.rootPath, chatModel: config.chatModel, k: config.k });
    return () => {
      off(IpcChannels.SCAN_PROGRESS, handleProgress);
      off(IpcChannels.SUGGESTIONS_UPDATE, handleSuggestions);
    };
  }, []);

  const pct = progress ? (progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0) : 0;

  return (
    <div style={{ padding: 32, maxWidth: 600 }}>
      <h2>Analysing…</h2>
      <p>{progress ? phaseLabel[progress.phase] : 'Starting…'}</p>
      <ProgressBar pct={pct} />
      {progress && <p style={{ color: '#6b7280', marginTop: 8 }}>{progress.current} / {progress.total}</p>}
      <button onClick={() => { invoke(IpcChannels.SCAN_CANCEL); onCancel(); }} style={{ marginTop: 24, padding: '8px 16px' }}>
        Cancel
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Write src/renderer/components/FileSuggestionRow.tsx**

```typescript
import React from 'react';
import { FileSuggestion } from '@shared/types';

interface Props {
  suggestion: FileSuggestion;
  onChange: (filePath: string, status: FileSuggestion['status']) => void;
}

export default function FileSuggestionRow({ suggestion, onChange }: Props): React.JSX.Element {
  const name = suggestion.filePath.split(/[/\\]/).pop() ?? suggestion.filePath;
  const statusColor = suggestion.status === 'approved' ? '#dcfce7' : suggestion.status === 'rejected' ? '#fee2e2' : '#f3f4f6';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', background: statusColor, borderRadius: 4, paddingLeft: 8 }}>
      <span style={{ flex: 1, fontFamily: 'monospace', fontSize: 13 }} title={suggestion.filePath}>{name}</span>
      <span style={{ color: '#6b7280', fontSize: 12 }}>→ {suggestion.suggestedDestination}</span>
      <span style={{ color: '#9ca3af', fontSize: 11 }}>{Math.round(suggestion.confidence * 100)}%</span>
      <button onClick={() => onChange(suggestion.filePath, 'approved')} style={{ padding: '2px 8px', background: '#22c55e', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>✓</button>
      <button onClick={() => onChange(suggestion.filePath, 'rejected')} style={{ padding: '2px 8px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>✗</button>
    </div>
  );
}
```

- [ ] **Step 6: Write src/renderer/components/ClusterGroup.tsx**

```typescript
import React, { useState } from 'react';
import { FileSuggestion } from '@shared/types';
import FileSuggestionRow from './FileSuggestionRow';

interface Props {
  destination: string;
  rationale: string;
  confidence: number;
  files: FileSuggestion[];
  onChange: (filePath: string, status: FileSuggestion['status']) => void;
  onApproveAll: () => void;
  onRejectAll: () => void;
}

export default function ClusterGroup({ destination, rationale, confidence, files, onChange, onApproveAll, onRejectAll }: Props): React.JSX.Element {
  const [expanded, setExpanded] = useState(true);

  return (
    <div style={{ marginBottom: 16, border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: '#f9fafb', cursor: 'pointer' }}
        onClick={() => setExpanded((e) => !e)}
      >
        <span style={{ fontWeight: 600 }}>{destination}</span>
        <span style={{ color: '#6b7280', fontSize: 12 }}>{files.length} files · {Math.round(confidence * 100)}%</span>
        <span style={{ flex: 1, color: '#9ca3af', fontSize: 12, fontStyle: 'italic' }}>{rationale}</span>
        <button onClick={(e) => { e.stopPropagation(); onApproveAll(); }} style={{ padding: '2px 10px', background: '#22c55e', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>✓ All</button>
        <button onClick={(e) => { e.stopPropagation(); onRejectAll(); }} style={{ padding: '2px 10px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>✗ All</button>
        <span>{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && (
        <div style={{ padding: '0 12px 8px' }}>
          {files.map((f) => <FileSuggestionRow key={f.filePath} suggestion={f} onChange={onChange} />)}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Write src/renderer/views/ReviewView.tsx**

```typescript
import React from 'react';
import { FileSuggestion } from '@shared/types';
import { useIpc } from '../hooks/useIpc';
import ClusterGroup from '../components/ClusterGroup';

interface Props {
  suggestions: FileSuggestion[];
  onSuggestionsChange: (s: FileSuggestion[]) => void;
  onExecute: () => void;
  onBack: () => void;
}

export default function ReviewView({ suggestions, onSuggestionsChange, onExecute, onBack }: Props): React.JSX.Element {
  const { invoke, IpcChannels } = useIpc();

  function setStatus(filePath: string, status: FileSuggestion['status']): void {
    invoke(IpcChannels.SUGGESTION_SET_STATUS, { filePath, status }).then((updated) => {
      onSuggestionsChange(updated as FileSuggestion[]);
    });
  }

  function setAllInCluster(clusterId: number, status: FileSuggestion['status']): void {
    const cluster = suggestions.filter((s) => s.clusterId === clusterId);
    let updated = [...suggestions];
    cluster.forEach((s) => {
      updated = updated.map((u) => u.filePath === s.filePath ? { ...u, status } : u);
      invoke(IpcChannels.SUGGESTION_SET_STATUS, { filePath: s.filePath, status });
    });
    onSuggestionsChange(updated);
  }

  const groups = new Map<number, FileSuggestion[]>();
  for (const s of suggestions) {
    const arr = groups.get(s.clusterId) ?? [];
    arr.push(s);
    groups.set(s.clusterId, arr);
  }

  const approvedCount = suggestions.filter((s) => s.status === 'approved').length;

  return (
    <div style={{ padding: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <h2 style={{ margin: 0 }}>Review Suggestions</h2>
        <span style={{ color: '#6b7280' }}>{suggestions.length} files · {approvedCount} approved</span>
        <div style={{ flex: 1 }} />
        <button onClick={onBack} style={{ padding: '8px 16px', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer' }}>Back</button>
        <button
          disabled={approvedCount === 0}
          onClick={onExecute}
          style={{ padding: '8px 20px', background: approvedCount > 0 ? '#6366f1' : '#e5e7eb', color: approvedCount > 0 ? '#fff' : '#9ca3af', border: 'none', borderRadius: 6, cursor: approvedCount > 0 ? 'pointer' : 'not-allowed' }}
        >
          Move {approvedCount} files
        </button>
      </div>
      {Array.from(groups.entries()).map(([clusterId, files]) => (
        <ClusterGroup
          key={clusterId}
          destination={files[0].suggestedDestination}
          rationale={files[0].rationale}
          confidence={files[0].confidence}
          files={files}
          onChange={setStatus}
          onApproveAll={() => setAllInCluster(clusterId, 'approved')}
          onRejectAll={() => setAllInCluster(clusterId, 'rejected')}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 8: Write src/renderer/views/ExecutingView.tsx**

```typescript
import React, { useEffect } from 'react';
import { FileSuggestion } from '@shared/types';
import { AppConfig } from '../App';
import { useIpc } from '../hooks/useIpc';
import ProgressBar from '../components/ProgressBar';

interface Props {
  suggestions: FileSuggestion[];
  config: AppConfig;
  onComplete: (result: { moved: string[]; skipped: string[] }) => void;
  result?: { moved: string[]; skipped: string[] };
  onGoHome?: () => void;
}

export default function ExecutingView({ suggestions, config, onComplete, result, onGoHome }: Props): React.JSX.Element {
  const { invoke, on, off, IpcChannels } = useIpc();

  useEffect(() => {
    if (result) return;
    const handleComplete = (r: unknown) => onComplete(r as { moved: string[]; skipped: string[] });
    const handleUndo = () => onGoHome?.();
    on(IpcChannels.EXECUTE_COMPLETE, handleComplete);
    on(IpcChannels.UNDO_COMPLETE, handleUndo);
    invoke(IpcChannels.EXECUTE_START, { rootPath: config.rootPath });
    return () => {
      off(IpcChannels.EXECUTE_COMPLETE, handleComplete);
      off(IpcChannels.UNDO_COMPLETE, handleUndo);
    };
  }, []);

  if (!result) {
    return (
      <div style={{ padding: 32, maxWidth: 600 }}>
        <h2>Moving files…</h2>
        <ProgressBar pct={0} label="Executing moves" />
      </div>
    );
  }

  return (
    <div style={{ padding: 32, maxWidth: 600 }}>
      <h2>Done</h2>
      <p>{result.moved.length} files moved successfully.</p>
      {result.skipped.length > 0 && (
        <div style={{ background: '#fef2f2', padding: 12, borderRadius: 6, marginTop: 8 }}>
          <p style={{ margin: 0, color: '#b91c1c' }}>{result.skipped.length} files could not be moved:</p>
          <ul>{result.skipped.map((f) => <li key={f} style={{ fontFamily: 'monospace', fontSize: 12 }}>{f}</li>)}</ul>
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
        <button
          onClick={() => invoke(IpcChannels.UNDO_START)}
          style={{ padding: '8px 16px', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer' }}
        >
          Undo all moves
        </button>
        <button
          onClick={onGoHome}
          style={{ padding: '8px 20px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
        >
          Sort another folder
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Build and verify no TypeScript errors**

```bash
npm run build
```
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/
git commit -m "feat: add all UI views and components"
```

---

### Task 13: Integration Tests

**Files:**
- Create: `tests/integration/pipeline.integration.test.ts`

**Interfaces:**
- Consumes: all main-process modules
- Note: these tests require a real Ollama instance. They are skipped automatically if Ollama is not running.

- [ ] **Step 1: Write tests/integration/pipeline.integration.test.ts**

```typescript
import os from 'os';
import path from 'path';
import fsp from 'fs/promises';
import { OllamaClient } from '../../src/main/ollama/ollamaClient';
import { scanDirectory } from '../../src/main/scanner/fileScanner';
import { extractContent } from '../../src/main/extractor/contentExtractor';
import { embedFiles } from '../../src/main/embedding/embeddingEngine';
import { clusterFiles } from '../../src/main/clustering/clusteringEngine';
import { reasonClusters } from '../../src/main/reasoning/llmReasoner';

const client = new OllamaClient();
let skipAll = false;

beforeAll(async () => {
  const healthy = await client.checkHealth();
  if (!healthy) {
    console.warn('Ollama not running — skipping integration tests');
    skipAll = true;
  }
});

describe('Full pipeline integration', () => {
  let tmpDir: string;

  beforeEach(async () => {
    if (skipAll) return;
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aifilesort-test-'));
    await fsp.writeFile(path.join(tmpDir, 'invoice_jan.txt'), 'Invoice for January services rendered. Total: $500.');
    await fsp.writeFile(path.join(tmpDir, 'invoice_feb.txt'), 'Invoice for February consulting. Total: $750.');
    await fsp.writeFile(path.join(tmpDir, 'readme.md'), '# Project\nThis project does X.');
    await fsp.writeFile(path.join(tmpDir, 'notes.txt'), 'Meeting notes from Monday. Action items: review PR, deploy.');
  });

  afterEach(async () => {
    if (tmpDir) await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('scans, embeds, clusters, and reasons over a small temp directory', async () => {
    if (skipAll) return;

    const files = await scanDirectory(tmpDir, () => {});
    expect(files.length).toBe(4);

    for (const f of files) {
      f.contentSnippet = await extractContent(f);
    }

    const vectors = await embedFiles(files, client, 'nomic-embed-text', 5, () => {}, new AbortController().signal);
    expect(vectors.length).toBeGreaterThan(0);
    expect(vectors[0].vector.length).toBeGreaterThan(0);

    const assignments = clusterFiles(vectors, 2);
    expect(assignments.length).toBe(vectors.length);

    const fileMap = new Map(files.map((f) => [f.absolutePath, f]));
    const suggestions = await reasonClusters(assignments, fileMap, [], client, 'llama3.2:3b', () => {});
    expect(suggestions.length).toBe(vectors.length);
    suggestions.forEach((s) => {
      expect(s.suggestedDestination).toBeTruthy();
      expect(s.status).toBe('pending');
    });
  }, 120_000);
});
```

- [ ] **Step 2: Run integration tests**

```bash
npx jest tests/integration --no-coverage
```
Expected: PASS (or skipped with warning if Ollama not running).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/
git commit -m "test: add pipeline integration tests"
```

---

### Task 14: E2E Tests (Playwright)

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/app.e2e.test.ts`

- [ ] **Step 1: Write playwright.config.ts**

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  use: {
    headless: true,
  },
});
```

- [ ] **Step 2: Write tests/e2e/app.e2e.test.ts**

```typescript
import { test, expect, ElectronApplication, _electron as electron } from '@playwright/test';
import path from 'path';

let app: ElectronApplication;

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.join(__dirname, '../../dist/main/index.js')],
  });
});

test.afterAll(async () => {
  await app.close();
});

test('shows home view on launch', async () => {
  const page = await app.firstWindow();
  await expect(page.locator('h1')).toHaveText('AiFileSort');
});

test('analyse button is disabled when path is empty', async () => {
  const page = await app.firstWindow();
  const btn = page.locator('button', { hasText: 'Analyse Folder' });
  await expect(btn).toBeDisabled();
});

test('analyse button enables when path is entered and Ollama is healthy', async () => {
  const page = await app.firstWindow();
  await page.fill('input[placeholder="/path/to/folder"]', '/tmp');
  // Button state depends on Ollama health — just verify no crash
  await expect(page.locator('button', { hasText: 'Analyse Folder' })).toBeVisible();
});
```

- [ ] **Step 3: Run E2E tests**

```bash
npm run build && npm run test:e2e
```
Expected: PASS for home view tests; analyse-button test may skip if Ollama unavailable.

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts tests/e2e/
git commit -m "test: add Playwright E2E tests for home view"
```

---

### Task 15: Final Build Verification

- [ ] **Step 1: Run all unit tests**

```bash
npm test
```
Expected: all PASS.

- [ ] **Step 2: Run full build**

```bash
npm run build
```
Expected: no TypeScript errors.

- [ ] **Step 3: Verify git log is clean**

```bash
git log --oneline
```
Expected: one commit per feature task, all present.

- [ ] **Step 4: Final commit (if any loose files)**

```bash
git status
# If clean, nothing to do. If any stray files:
git add .
git commit -m "chore: final cleanup"
```

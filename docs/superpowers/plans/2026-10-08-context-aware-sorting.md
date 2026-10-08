# Context-Aware Sorting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the LLM sort files the way the user already organises them, by giving it retrieved folder profiles, built-in app/naming signatures and download origins, and flag already-filed files that look misfiled.

**Architecture:** The scanner walks organised subfolders (only real app/game/code folders stay atomic) and tags each file with its `relativeFolder`. Pure modules in `src/main/context/` build folder profiles from the embeddings the pipeline already computes, match filename signatures, read Windows download origins and find misfit candidates. The reasoner injects a per-cluster context section (top-5 similar folders, folder list, signatures, origins) and confirms misfits with a second structured prompt. A new `src/main/pipeline.ts` orchestrates everything so `ipcHandlers.ts` stays thin.

**Tech Stack:** Electron 41, TypeScript 7 (typecheck only), React 19, Ollama (`nomic-embed-text` + chat model) via `OllamaClient`, `ml-kmeans`, Jest 30 with babel-jest.

**Spec:** `docs/superpowers/specs/2026-10-08-context-aware-sorting-design.md`

## Global Constraints

- Run unit tests with `npx jest <path>`; the full suite with `npm test`. Jest uses babel-jest, which strips types without checking them, so **every task also runs `npm run typecheck`**.
- No new runtime or dev dependencies.
- Chat calls keep the existing `CHAT_OPTIONS` (`temperature: 0.2`, `numCtx: 4096`) and structured `format` schemas.
- Profile depth: folders at depth 1–3 (`MAX_PROFILE_DEPTH = 3`).
- Embedding cap: **200** filed files per profile folder (`MAX_EMBEDDED_PER_FOLDER = 200`); loose files are always embedded.
- Loose-cluster prompt: top **5** similar folders; "All existing folders" capped at **60**; context section ≤ **4800 chars** (~1,200 tokens).
- Misfit: margin **0.10**, own folder ≥ **4** embedded files, ≤ **40** candidates per scan, **2** alternatives, ancestor/descendant folders excluded.
- Misfit LLM failure or invalid folder → suggestion **dropped** (never `Unsorted`).
- The embedding text (`buildDescription` in `embeddingEngine.ts`) must **not** include `relativeFolder` — that would pull files towards their own folder and blind misfit detection.
- Paths shown to the model are relative to the scan root with `/` separators.
- Windows is the primary platform; code must still run (and return "no origin") on macOS/Linux.

## Review Focus

1. **Windows Zone.Identifier files use CRLF and may start with a BOM** — origin must still parse. (Test in Task 5.)
2. **A filed file whose embedding failed** (no vector) — profiles and misfit detection must skip it, not crash or count it. (Tests in Tasks 3 and 6.)
3. **Folder names with spaces, parentheses, accents or different case** (`Work (old)`, `Café`, `finance`) — misfit confirmation must still match the model's answer to the right alternative and keep its original spelling. (Test in Task 8.)
4. **A scan root with no loose files, or an empty root** — no clusters, no crash; misfits still reported when there are filed files. (Tests in Task 9.)
5. **Very long filenames** in folder samples — the context section must stay within budget. (Test in Task 7.)

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/shared/types.ts` | modify | `FileMeta.relativeFolder/originHost`, `FileSuggestion.kind/currentFolder`, `'profiling'` phase |
| `src/main/scanner/fileScanner.ts` | rewrite | Walk with new atomic rule, tag `relativeFolder`, return `{ files, atomicFolders }` |
| `src/main/context/sampling.ts` | create | `evenSample` (moved from `llmReasoner.samplePaths`) |
| `src/main/context/vectorMath.ts` | create | `normalize` (moved from clustering), `dot`, `meanDirection` |
| `src/main/context/folderProfiles.ts` | create | Embedding selection, profiles, similarity ranking, prompt line |
| `src/main/context/signatures.ts` | create | Built-in app/naming signatures + summary lines |
| `src/main/context/fileOrigin.ts` | create | Zone.Identifier parsing and reading |
| `src/main/context/misfitDetector.ts` | create | Stage-1 misfit candidates (no LLM) |
| `src/main/reasoning/llmReasoner.ts` | modify | Context section for loose clusters; `confirmMisfits`; `kind` on suggestions |
| `src/main/pipeline.ts` | create | Orchestrates scan → extract → embed → profile → reason |
| `src/main/ipcHandlers.ts` | modify | `SCAN_START` delegates to `runPipeline` |
| `src/main/executor/fileExecutor.ts` | modify | `kind === 'folder'` instead of `isAtomicFolder` |
| `src/renderer/views/ReviewView.tsx` | modify | Sections by `kind`; "Possibly misfiled" section |
| `src/renderer/views/ScanningView.tsx` | modify | Label for `profiling` phase |
| `tests/integration/pipeline.integration.test.ts` | rewrite | Live-Ollama end-to-end fixture |

---

### Task 1: Suggestion kinds and the profiling phase

Replace the `isAtomicFolder` flag with an explicit `kind`, and add the `profiling` phase.

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/reasoning/llmReasoner.ts` (the two places that build `FileSuggestion`s)
- Modify: `src/main/executor/fileExecutor.ts:58`
- Modify: `src/renderer/views/ReviewView.tsx:32-38`
- Modify: `src/renderer/views/ScanningView.tsx:15-22`
- Test: `src/main/reasoning/llmReasoner.test.ts`, `src/main/executor/fileExecutor.test.ts`

**Interfaces:**
- Produces: `type SuggestionKind = 'loose' | 'misfiled' | 'folder'`; `FileSuggestion.kind: SuggestionKind`; `FileSuggestion.currentFolder?: string`; `ScanPhase` includes `'profiling'`.

- [ ] **Step 1: Write the failing tests**

Append to `src/main/reasoning/llmReasoner.test.ts` (and add `categorizeAtomicFolders` to the import from `./llmReasoner`):

```ts
describe('suggestion kinds', () => {
  it('tags cluster suggestions as loose', async () => {
    const client = { chat: jest.fn().mockResolvedValue(llmResponse) } as unknown as OllamaClient;
    const result = await reasonClusters(
      [{ filePath: '/root/a.txt', clusterId: 0 }],
      new Map([['/root/a.txt', makeMeta('/root/a.txt')]]),
      [], client, 'm', () => {},
    );
    expect(result[0].kind).toBe('loose');
  });

  it('tags atomic folder suggestions as folder', async () => {
    const client = { chat: jest.fn().mockResolvedValue(llmResponse) } as unknown as OllamaClient;
    const result = await categorizeAtomicFolders(
      [{ absolutePath: '/root/Hades', name: 'Hades', fileCount: 30, hasExecutable: true }],
      [], client, 'm', () => {},
    );
    expect(result[0].kind).toBe('folder');
  });
});
```

In `src/main/executor/fileExecutor.test.ts`, add `kind: 'loose',` to the `approved` fixture (after `status: 'approved',`), then add inside `describe('executeApproved', ...)`:

```ts
  it('moves a folder suggestion as a whole directory on cross-drive moves', async () => {
    mockFsp.rename = jest.fn().mockRejectedValue(Object.assign(new Error('EXDEV'), { code: 'EXDEV' }));
    mockFsp.access = jest.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    mockFsp.cp = jest.fn().mockResolvedValue(undefined);
    mockFsp.rm = jest.fn().mockResolvedValue(undefined);
    const folder: FileSuggestion = { ...approved, filePath: '/root/Hades', kind: 'folder', suggestedDestination: 'Games' };
    await executeApproved([folder], '/root', '/root/.undo.json');
    expect(mockFsp.cp).toHaveBeenCalledWith('/root/Hades', expect.stringContaining('Hades'), { recursive: true });
    expect(mockFsp.rm).toHaveBeenCalledWith('/root/Hades', { recursive: true, force: true });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/main/reasoning src/main/executor`
Expected: FAIL — `result[0].kind` is `undefined`; the folder test calls `unlink` instead of `cp`/`rm` because nothing sets `isAtomicFolder`.

- [ ] **Step 3: Implement**

In `src/shared/types.ts`, replace the `FileSuggestion` interface and extend `ScanPhase`:

```ts
/** loose = unsorted file at the scan root; misfiled = filed file that looks out of place; folder = app/game/project moved as a unit */
export type SuggestionKind = 'loose' | 'misfiled' | 'folder';

export interface FileSuggestion {
  filePath: string;
  clusterId: number;
  suggestedDestination: string;
  rationale: string;
  confidence: number; // 0–1
  status: 'pending' | 'approved' | 'rejected';
  kind: SuggestionKind;
  /** Folder the file is in now (relative to the scan root) — set for misfiled suggestions */
  currentFolder?: string;
}
```

```ts
export type ScanPhase =
  | 'scanning'
  | 'extracting'
  | 'embedding'
  | 'profiling'
  | 'clustering'
  | 'reasoning'
  | 'done';
```

In `src/main/reasoning/llmReasoner.ts`: in `categorizeAtomicFolders`'s returned objects replace `isAtomicFolder: true,` with `kind: 'folder',`; in `reasonClusters`'s returned objects add `kind: 'loose',` after `status: 'pending',`.

In `src/main/executor/fileExecutor.ts:58` replace `isFolder: s.isAtomicFolder` with `isFolder: s.kind === 'folder'`.

In `src/renderer/views/ReviewView.tsx` replace

```ts
  const atomicFolders = suggestions.filter((s) => s.isAtomicFolder);
  const fileGroups = new Map<number, FileSuggestion[]>();
  for (const s of suggestions.filter((s) => !s.isAtomicFolder)) {
```

with

```ts
  const atomicFolders = suggestions.filter((s) => s.kind === 'folder');
  const fileGroups = new Map<number, FileSuggestion[]>();
  for (const s of suggestions.filter((s) => s.kind === 'loose')) {
```

In `src/renderer/views/ScanningView.tsx` add to `phaseLabel` after `embedding`:

```ts
  profiling: 'Learning how your folders are organised…',
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx jest src/main/reasoning src/main/executor && npm run typecheck`
Expected: all PASS; typecheck prints no errors.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/main/reasoning src/main/executor src/renderer/views
git commit -m "refactor: replace isAtomicFolder with suggestion kind; add profiling phase"
```

---

### Task 2: Scanner — atomic rule, relativeFolder tagging

**Files:**
- Modify: `src/shared/types.ts` (`FileMeta`)
- Rewrite: `src/main/scanner/fileScanner.ts`
- Rewrite: `src/main/scanner/fileScanner.test.ts` (real temp directories instead of mocked `fs`)
- Modify: `src/main/ipcHandlers.ts` (use new `scanDirectory` result; interim)
- Modify fixtures: `src/main/embedding/embeddingEngine.test.ts`, `src/main/extractor/contentExtractor.test.ts`, `src/main/reasoning/llmReasoner.test.ts`
- Modify: `tests/integration/pipeline.integration.test.ts` (new `scanDirectory` return shape)

**Interfaces:**
- Consumes: `AtomicFolder` (unchanged).
- Produces:
  - `FileMeta.relativeFolder: string` (`''` = loose) and `FileMeta.originHost?: string`
  - `interface ScanResult { files: FileMeta[]; atomicFolders: AtomicFolder[] }`
  - `scanDirectory(rootPath: string, onProgress: (count: number) => void): Promise<ScanResult>` — `atomicFolders` holds **top-level** atomic folders only.
  - `detectAtomicFolders` is **removed**.

- [ ] **Step 1: Add the FileMeta fields**

In `src/shared/types.ts`, inside `FileMeta` after `contentSnippet`:

```ts
  /** Folder relative to the scan root, '/'-separated; '' for loose files at the root */
  relativeFolder: string;
  /** Website the file was downloaded from (Windows Zone.Identifier), e.g. 'github.com' */
  originHost?: string;
```

Add `relativeFolder: '',` to the object literal in each test fixture helper: `makeFile` in `embeddingEngine.test.ts`, `makeMeta` in `contentExtractor.test.ts`, `makeMeta` in `llmReasoner.test.ts`.

- [ ] **Step 2: Write the failing scanner tests**

Replace `src/main/scanner/fileScanner.test.ts` entirely:

```ts
import os from 'os';
import path from 'path';
import fsp from 'fs/promises';
import { scanDirectory } from './fileScanner';

let root: string;

// Paths ending in '/' create empty directories; everything else is a file with dummy content
async function makeTree(entries: string[]): Promise<void> {
  for (const rel of entries) {
    const full = path.join(root, rel);
    if (rel.endsWith('/')) {
      await fsp.mkdir(full, { recursive: true });
    } else {
      await fsp.mkdir(path.dirname(full), { recursive: true });
      await fsp.writeFile(full, 'x');
    }
  }
}

const rels = (files: { relativeFolder: string; name: string }[]) =>
  files.map((f) => (f.relativeFolder ? `${f.relativeFolder}/${f.name}` : f.name)).sort();

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aifs-scan-'));
});
afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

describe('scanDirectory', () => {
  it('tags loose and filed files with their relative folder', async () => {
    await makeTree(['loose.txt', 'Finance/Bank/statement.pdf', 'Finance/a/b/c/deep.txt']);
    const { files } = await scanDirectory(root, () => {});
    const byName = new Map(files.map((f) => [f.name, f]));
    expect(byName.get('loose.txt')!.relativeFolder).toBe('');
    expect(byName.get('statement.pdf')!.relativeFolder).toBe('Finance/Bank');
    expect(byName.get('deep.txt')!.relativeFolder).toBe('Finance/a/b/c');
    expect(byName.get('statement.pdf')!.extension).toBe('.pdf');
  });

  it('skips hidden entries and node_modules', async () => {
    await makeTree(['.hidden', 'node_modules/x.js', 'keep.txt']);
    const { files } = await scanDirectory(root, () => {});
    expect(rels(files)).toEqual(['keep.txt']);
  });

  it('reports progress for each file', async () => {
    await makeTree(['a.txt', 'b.txt']);
    const counts: number[] = [];
    await scanDirectory(root, (n) => counts.push(n));
    expect(counts).toEqual([1, 2]);
  });

  it('treats an installed app (exe next to dll) as an atomic top-level folder', async () => {
    await makeTree(['Hades/Hades.exe', 'Hades/fmod.dll', 'Hades/Content/a.pak']);
    const { files, atomicFolders } = await scanDirectory(root, () => {});
    expect(files).toHaveLength(0);
    expect(atomicFolders).toEqual([
      expect.objectContaining({ name: 'Hades', hasExecutable: true, absolutePath: path.join(root, 'Hades') }),
    ]);
  });

  it('finds app binaries inside bin-style subfolders', async () => {
    await makeTree(['Game/Binaries/Win64/Game.exe', 'Game/Binaries/Win64/engine.dll', 'Game/Content/data.pak']);
    const { atomicFolders } = await scanDirectory(root, () => {});
    expect(atomicFolders.map((f) => f.name)).toEqual(['Game']);
  });

  it('does not treat a folder of installers as an app', async () => {
    await makeTree(['Software/Installers/setup.exe', 'Software/Installers/tool.msi']);
    const { files, atomicFolders } = await scanDirectory(root, () => {});
    expect(atomicFolders).toEqual([]);
    expect(rels(files)).toEqual(['Software/Installers/setup.exe', 'Software/Installers/tool.msi']);
  });

  it('keeps an organising parent like Games/ walkable and skips the nested app silently', async () => {
    await makeTree(['Games/Hades/Hades.exe', 'Games/Hades/fmod.dll', 'Games/notes.txt']);
    const { files, atomicFolders } = await scanDirectory(root, () => {});
    expect(atomicFolders).toEqual([]);
    expect(rels(files)).toEqual(['Games/notes.txt']);
  });

  it('treats code projects as atomic: top-level reported, nested skipped', async () => {
    await makeTree(['myapp/package.json', 'myapp/src/index.ts', 'Projects/repo/.git/HEAD', 'Projects/repo/main.go', 'Projects/readme.txt', 'Tools/build.sln']);
    const { files, atomicFolders } = await scanDirectory(root, () => {});
    expect(atomicFolders.map((f) => [f.name, f.hasExecutable]).sort()).toEqual([['Tools', false], ['myapp', false]]);
    expect(rels(files)).toEqual(['Projects/readme.txt']);
  });

  it('treats .app bundles as atomic', async () => {
    await makeTree(['Tool.app/Contents/Info.plist']);
    const { atomicFolders } = await scanDirectory(root, () => {});
    expect(atomicFolders.map((f) => f.name)).toEqual(['Tool.app']);
  });

  it('caps the reported file count of an atomic folder at 30', async () => {
    const many = Array.from({ length: 40 }, (_, i) => `App/data${i}.pak`);
    await makeTree(['App/app.exe', 'App/core.dll', ...many]);
    const { atomicFolders } = await scanDirectory(root, () => {});
    expect(atomicFolders[0].fileCount).toBe(30);
  });

  it('returns nothing for a missing root', async () => {
    const result = await scanDirectory(path.join(root, 'nope'), () => {});
    expect(result).toEqual({ files: [], atomicFolders: [] });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest src/main/scanner`
Expected: FAIL — `scanDirectory` returns an array, so destructuring `{ files }` gives `undefined`.

- [ ] **Step 4: Rewrite the scanner**

Replace everything in `src/main/scanner/fileScanner.ts` **above** `function extToMime` (keep `extToMime` and everything below it unchanged) with:

```ts
import fsp from 'fs/promises';
import path from 'path';
import type { Dirent } from 'fs';
import { FileMeta, AtomicFolder } from '@shared/types';

const SKIP_DIRS = new Set([
  'node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information',
  '.Trash', '__pycache__', '.cache',
]);

// An .exe only marks an installed app when it sits next to the app's own support files;
// a lone setup.exe or .msi is just an installer someone filed
const APP_SUPPORT_EXTS = ['.dll', '.pak', '.asar', '.so', '.dylib'];
// Binaries are often one or two levels down (Hades/x64, Game/Binaries/Win64); only these
// folder names are followed, so an organising parent like Games/ never inherits a child app
const BINARY_DIR_NAMES = new Set(['bin', 'x64', 'x86', 'win64', 'win32', 'binaries', 'app', 'program']);
const PROJECT_MARKERS = new Set(['.git', 'package.json']);
const ATOMIC_FILE_COUNT_CAP = 30;

export interface ScanResult {
  files: FileMeta[];
  /** Top-level atomic folders only — nested ones sit inside the user's organisation and are left alone */
  atomicFolders: AtomicFolder[];
}

type ReadDir = (dir: string) => Promise<Dirent[]>;
type AtomicReason = 'app' | 'project' | null;

// Atomic checks look ahead into subfolders the walk visits next; caching avoids reading them twice
function cachedReaddir(): ReadDir {
  const cache = new Map<string, Promise<Dirent[]>>();
  return (dir) => {
    let entries = cache.get(dir);
    if (!entries) {
      entries = fsp.readdir(dir, { withFileTypes: true }).catch(() => [] as Dirent[]);
      cache.set(dir, entries);
    }
    return entries;
  };
}

async function hasAppBinaries(dir: string, entries: Dirent[], depth: number, readdir: ReadDir): Promise<boolean> {
  const exts = new Set(entries.filter((e) => e.isFile()).map((e) => path.extname(e.name).toLowerCase()));
  if (exts.has('.exe') && APP_SUPPORT_EXTS.some((x) => exts.has(x))) return true;
  if (depth >= 2) return false;
  for (const e of entries) {
    if (!e.isDirectory() || !BINARY_DIR_NAMES.has(e.name.toLowerCase())) continue;
    const sub = path.join(dir, e.name);
    if (await hasAppBinaries(sub, await readdir(sub), depth + 1, readdir)) return true;
  }
  return false;
}

async function atomicReason(dir: string, readdir: ReadDir): Promise<AtomicReason> {
  if (dir.toLowerCase().endsWith('.app')) return 'app';
  const entries = await readdir(dir);
  if (entries.some((e) => PROJECT_MARKERS.has(e.name) || (e.isFile() && e.name.toLowerCase().endsWith('.sln')))) {
    return 'project';
  }
  return (await hasAppBinaries(dir, entries, 0, readdir)) ? 'app' : null;
}

async function countFiles(dir: string, readdir: ReadDir, cap: number): Promise<number> {
  let count = 0;
  const visit = async (d: string): Promise<void> => {
    for (const e of await readdir(d)) {
      if (count >= cap) return;
      if (e.isFile()) count++;
      else if (e.isDirectory()) await visit(path.join(d, e.name));
    }
  };
  await visit(dir);
  return Math.min(count, cap);
}

export async function scanDirectory(
  rootPath: string,
  onProgress: (count: number) => void,
): Promise<ScanResult> {
  const readdir = cachedReaddir();
  const files: FileMeta[] = [];
  const atomicFolders: AtomicFolder[] = [];

  const walk = async (dir: string, relativeFolder: string): Promise<void> => {
    for (const entry of await readdir(dir)) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const reason = await atomicReason(fullPath, readdir);
        if (reason) {
          if (relativeFolder === '') {
            atomicFolders.push({
              absolutePath: fullPath,
              name: entry.name,
              fileCount: await countFiles(fullPath, readdir, ATOMIC_FILE_COUNT_CAP),
              hasExecutable: reason === 'app',
            });
          }
          continue;
        }
        await walk(fullPath, relativeFolder ? `${relativeFolder}/${entry.name}` : entry.name);
      } else if (entry.isFile()) {
        try {
          const stat = await fsp.stat(fullPath);
          const ext = path.extname(entry.name).toLowerCase();
          files.push({
            absolutePath: fullPath,
            name: entry.name,
            extension: ext,
            sizeBytes: stat.size,
            createdAt: stat.birthtime,
            modifiedAt: stat.mtime,
            mimeType: extToMime(ext),
            relativeFolder,
          });
          onProgress(files.length);
        } catch {
          // unreadable — skip
        }
      }
    }
  };

  await walk(rootPath, '');
  return { files, atomicFolders };
}

```

- [ ] **Step 5: Update callers of the old API**

In `src/main/ipcHandlers.ts`:
- Change the import to `import { scanDirectory } from './scanner/fileScanner';`
- Replace

```ts
    const atomicFolders = await detectAtomicFolders(rootPath);
    const atomicPaths = new Set(atomicFolders.map((f) => f.absolutePath));
    const files = await scanDirectory(rootPath, (count) => {
      win.webContents.send(IpcChannels.SCAN_PROGRESS, { phase: 'scanning', current: count, total: count });
    }, atomicPaths);
```

with (interim until Task 9 — keeps sorting loose files only so organised folders aren't re-sorted):

```ts
    const scan = await scanDirectory(rootPath, (count) => {
      win.webContents.send(IpcChannels.SCAN_PROGRESS, { phase: 'scanning', current: count, total: count });
    });
    const atomicFolders = scan.atomicFolders;
    const files = scan.files.filter((f) => f.relativeFolder === '');
```

In `tests/integration/pipeline.integration.test.ts` change `const files = await scanDirectory(tmpDir, () => {});` to `const { files } = await scanDirectory(tmpDir, () => {});`.

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS; no type errors.

- [ ] **Step 7: Commit**

```bash
git add src tests
git commit -m "feat: scanner walks organised folders, tags relativeFolder, narrower atomic rule"
```

---

### Task 3: Folder profiles (with sampling and vector helpers)

**Files:**
- Create: `src/main/context/sampling.ts`, `src/main/context/sampling.test.ts`
- Create: `src/main/context/vectorMath.ts`, `src/main/context/vectorMath.test.ts`
- Create: `src/main/context/folderProfiles.ts`, `src/main/context/folderProfiles.test.ts`
- Modify: `src/main/clustering/clusteringEngine.ts` + test (import `normalize` from `vectorMath`)
- Modify: `src/main/reasoning/llmReasoner.ts` + test (use `evenSample` instead of `samplePaths`)

**Interfaces:**
- Consumes: `FileMeta.relativeFolder` (Task 2).
- Produces:
  - `evenSample<T>(items: T[], max: number): T[]`
  - `normalize(v: number[]): number[]`, `dot(a: number[], b: number[]): number`, `meanDirection(vectors: number[][]): number[]`
  - `MAX_PROFILE_DEPTH = 3`, `MAX_EMBEDDED_PER_FOLDER = 200`
  - `interface FolderProfile { path: string; fileCount: number; topExtensions: Array<[string, number]>; sampleNames: string[]; centroid: number[]; vectorSum: number[]; embeddedCount: number }`
  - `profileFolderOf(relativeFolder: string): string`
  - `isRelatedFolder(a: string, b: string): boolean` — same, ancestor or descendant
  - `selectForEmbedding(files: FileMeta[], perFolder?: number): FileMeta[]`
  - `buildFolderProfiles(files: FileMeta[], vectors: Map<string, number[]>): FolderProfile[]`
  - `topFolders(profiles: FolderProfile[], vector: number[], n: number, exclude?: (p: FolderProfile) => boolean): Array<{ profile: FolderProfile; similarity: number }>`
  - `describeProfile(p: FolderProfile, withSamples?: boolean): string`

- [ ] **Step 1: Write the failing tests**

`src/main/context/sampling.test.ts`:

```ts
import { evenSample } from './sampling';

describe('evenSample', () => {
  it('returns everything when under the limit', () => {
    expect(evenSample(['a', 'b'], 5)).toEqual(['a', 'b']);
  });
  it('spreads the sample across the whole list', () => {
    const items = Array.from({ length: 100 }, (_, i) => String(i));
    expect(evenSample(items, 4)).toEqual(['0', '25', '50', '75']);
  });
});
```

`src/main/context/vectorMath.test.ts`:

```ts
import { normalize, dot, meanDirection } from './vectorMath';

describe('vectorMath', () => {
  it('normalize scales to unit length and leaves zero vectors alone', () => {
    expect(normalize([3, 4])).toEqual([0.6, 0.8]);
    expect(normalize([0, 0])).toEqual([0, 0]);
  });
  it('dot multiplies component-wise and sums', () => {
    expect(dot([1, 2], [3, 4])).toBe(11);
  });
  it('meanDirection averages directions, not magnitudes', () => {
    const m = meanDirection([[10, 0], [0, 1]]);
    expect(m[0]).toBeCloseTo(Math.SQRT1_2);
    expect(m[1]).toBeCloseTo(Math.SQRT1_2);
  });
  it('meanDirection of nothing is an empty vector', () => {
    expect(meanDirection([])).toEqual([]);
  });
});
```

`src/main/context/folderProfiles.test.ts`:

```ts
import { FileMeta } from '@shared/types';
import {
  buildFolderProfiles, describeProfile, isRelatedFolder, profileFolderOf, selectForEmbedding, topFolders,
} from './folderProfiles';

function file(relativeFolder: string, name: string): FileMeta {
  const dir = relativeFolder ? `/root/${relativeFolder}` : '/root';
  return {
    absolutePath: `${dir}/${name}`, name, extension: name.includes('.') ? `.${name.split('.').pop()}` : '',
    sizeBytes: 1, createdAt: new Date(), modifiedAt: new Date(), mimeType: 'x', relativeFolder,
  };
}

describe('profileFolderOf / isRelatedFolder', () => {
  it('truncates to depth 3', () => {
    expect(profileFolderOf('a/b/c/d/e')).toBe('a/b/c');
    expect(profileFolderOf('a')).toBe('a');
    expect(profileFolderOf('')).toBe('');
  });
  it('relates a folder to itself, its ancestors and descendants only', () => {
    expect(isRelatedFolder('Media', 'Media/Photos')).toBe(true);
    expect(isRelatedFolder('Media/Photos', 'Media')).toBe(true);
    expect(isRelatedFolder('Media', 'Media')).toBe(true);
    expect(isRelatedFolder('Media', 'MediaArchive')).toBe(false);
    expect(isRelatedFolder('Media/Photos', 'Media/Video')).toBe(false);
  });
});

describe('selectForEmbedding', () => {
  it('keeps all loose files and caps filed files per profile folder', () => {
    const loose = Array.from({ length: 5 }, (_, i) => file('', `l${i}.txt`));
    const filed = Array.from({ length: 10 }, (_, i) => file('Docs/a/b/c', `f${i}.txt`));
    const other = [file('Music', 'song.mp3')];
    const selected = selectForEmbedding([...loose, ...filed, ...other], 4);
    expect(selected.filter((f) => f.relativeFolder === '')).toHaveLength(5);
    expect(selected.filter((f) => f.relativeFolder === 'Docs/a/b/c')).toHaveLength(4);
    expect(selected.filter((f) => f.relativeFolder === 'Music')).toHaveLength(1);
  });
});

describe('buildFolderProfiles', () => {
  const files = [
    file('Finance/Bank', 'statement1.pdf'),
    file('Finance/Bank', 'statement2.pdf'),
    file('Finance/Bank', 'export.csv'),
    file('Media/Photos', 'IMG_1.jpg'),
    file('', 'loose.txt'),
  ];
  const vectors = new Map<string, number[]>([
    ['/root/Finance/Bank/statement1.pdf', [2, 0]],
    ['/root/Finance/Bank/statement2.pdf', [1, 0]],
    ['/root/Finance/Bank/export.csv', [1, 0]],
    ['/root/Media/Photos/IMG_1.jpg', [0, 5]],
    ['/root/loose.txt', [1, 1]],
  ]);

  it('profiles each folder and its ancestors, ignoring loose files', () => {
    const profiles = buildFolderProfiles(files, vectors);
    expect(profiles.map((p) => p.path)).toEqual(['Finance', 'Finance/Bank', 'Media', 'Media/Photos']);
  });

  it('counts files, ranks extensions and samples names', () => {
    const bank = buildFolderProfiles(files, vectors).find((p) => p.path === 'Finance/Bank')!;
    expect(bank.fileCount).toBe(3);
    expect(bank.topExtensions).toEqual([['.pdf', 2], ['.csv', 1]]);
    expect(bank.sampleNames).toEqual(['export.csv', 'statement1.pdf', 'statement2.pdf']);
  });

  it('builds a unit centroid from unit member vectors and keeps their sum', () => {
    const bank = buildFolderProfiles(files, vectors).find((p) => p.path === 'Finance/Bank')!;
    expect(bank.centroid).toEqual([1, 0]);
    expect(bank.vectorSum).toEqual([3, 0]);
    expect(bank.embeddedCount).toBe(3);
  });

  it('skips files without a vector when building centroids but still counts them', () => {
    const withMissing = [...files, file('Media/Photos', 'broken.jpg')];
    const photos = buildFolderProfiles(withMissing, vectors).find((p) => p.path === 'Media/Photos')!;
    expect(photos.fileCount).toBe(2);
    expect(photos.embeddedCount).toBe(1);
    expect(photos.centroid).toEqual([0, 1]);
  });

  it('omits folders with no embedded files', () => {
    const profiles = buildFolderProfiles([file('Empty', 'x.txt')], new Map());
    expect(profiles).toEqual([]);
  });
});

describe('topFolders', () => {
  const files = [file('A', 'a.txt'), file('B', 'b.txt'), file('C', 'c.txt')];
  const vectors = new Map([
    ['/root/A/a.txt', [1, 0]],
    ['/root/B/b.txt', [0.7, 0.7]],
    ['/root/C/c.txt', [0, 1]],
  ]);
  const profiles = buildFolderProfiles(files, vectors);

  it('ranks folders by cosine similarity', () => {
    const ranked = topFolders(profiles, [1, 0.1], 2);
    expect(ranked.map((r) => r.profile.path)).toEqual(['A', 'B']);
    expect(ranked[0].similarity).toBeGreaterThan(ranked[1].similarity);
  });

  it('honours the exclude filter', () => {
    const ranked = topFolders(profiles, [1, 0], 1, (p) => p.path === 'A');
    expect(ranked.map((r) => r.profile.path)).toEqual(['B']);
  });
});

describe('describeProfile', () => {
  const profile = {
    path: 'Finance/Bank', fileCount: 42, topExtensions: [['.pdf', 38], ['.csv', 4]] as Array<[string, number]>,
    sampleNames: ['Statement_2026-03.pdf', 'x'.repeat(100) + '.csv'], centroid: [], vectorSum: [], embeddedCount: 42,
  };
  it('formats one prompt line and shortens long names', () => {
    const line = describeProfile(profile);
    expect(line).toMatch(/^Finance\/Bank \(42 files: \.pdf ×38, \.csv ×4\) e\.g\. "Statement_2026-03\.pdf", "x+…"$/);
    expect(line.length).toBeLessThan(140);
  });
  it('can omit the samples', () => {
    expect(describeProfile(profile, false)).toBe('Finance/Bank (42 files: .pdf ×38, .csv ×4)');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/main/context`
Expected: FAIL — `Cannot find module './sampling'` (and the other two modules).

- [ ] **Step 3: Implement the helpers**

`src/main/context/sampling.ts`:

```ts
/** Evenly spaced sample so a long list is represented end to end, not just its first items */
export function evenSample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const step = items.length / max;
  return Array.from({ length: max }, (_, i) => items[Math.floor(i * step)]);
}
```

`src/main/context/vectorMath.ts`:

```ts
// Unit-length vectors make euclidean distance and dot product rank like cosine similarity,
// which is how text embeddings are meant to be compared
export function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
  return norm === 0 ? vector : vector.map((x) => x / norm);
}

export function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/** Unit vector pointing in the average direction of the inputs (each input counts equally, whatever its length) */
export function meanDirection(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const sum = new Array(vectors[0].length).fill(0);
  for (const v of vectors) normalize(v).forEach((x, i) => { sum[i] += x; });
  return normalize(sum);
}
```

In `src/main/clustering/clusteringEngine.ts` delete the local `normalize` function and its comment, and add `import { normalize } from '../context/vectorMath';` below the `@shared/types` import. In `src/main/clustering/clusteringEngine.test.ts` change the import to `import { clusterFiles, estimateK } from './clusteringEngine';` and delete the `describe('normalize', ...)` block (now covered by `vectorMath.test.ts`).

In `src/main/reasoning/llmReasoner.ts` delete the exported `samplePaths` function and its comment, add `import { evenSample } from '../context/sampling';`, and change `samplePaths(displayPaths, MAX_PATHS_IN_PROMPT)` to `evenSample(displayPaths, MAX_PATHS_IN_PROMPT)`. In `src/main/reasoning/llmReasoner.test.ts` remove `samplePaths` from the import and delete the `describe('samplePaths', ...)` block (now covered by `sampling.test.ts`).

- [ ] **Step 4: Implement folder profiles**

`src/main/context/folderProfiles.ts`:

```ts
import { FileMeta } from '@shared/types';
import { evenSample } from './sampling';
import { dot, normalize } from './vectorMath';

export const MAX_PROFILE_DEPTH = 3;
export const MAX_EMBEDDED_PER_FOLDER = 200;
const TOP_EXTENSIONS = 4;
const SAMPLE_NAMES = 5;
const MAX_NAME_CHARS = 40;

export interface FolderProfile {
  /** Relative to the scan root, '/'-separated, e.g. 'Finance/Bank' */
  path: string;
  /** Files scanned in this folder and all its subfolders */
  fileCount: number;
  topExtensions: Array<[string, number]>;
  sampleNames: string[];
  /** Unit vector: the average direction of the members' embeddings */
  centroid: number[];
  /** Sum of the members' unit vectors — lets callers compute a centroid with one file left out */
  vectorSum: number[];
  /** Members that have an embedding (the centroid is built from these) */
  embeddedCount: number;
}

/** The profiled folder a file belongs to: its folder truncated to MAX_PROFILE_DEPTH ('' for loose files) */
export function profileFolderOf(relativeFolder: string): string {
  return relativeFolder.split('/').filter(Boolean).slice(0, MAX_PROFILE_DEPTH).join('/');
}

/** True when a and b are the same folder or one contains the other */
export function isRelatedFolder(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function ancestorsAndSelf(folder: string): string[] {
  const parts = folder.split('/');
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}

/** All loose files, plus an even sample of at most `perFolder` filed files per profiled folder */
export function selectForEmbedding(files: FileMeta[], perFolder = MAX_EMBEDDED_PER_FOLDER): FileMeta[] {
  const loose: FileMeta[] = [];
  const byFolder = new Map<string, FileMeta[]>();
  for (const f of files) {
    if (f.relativeFolder === '') {
      loose.push(f);
      continue;
    }
    const key = profileFolderOf(f.relativeFolder);
    const group = byFolder.get(key) ?? [];
    group.push(f);
    byFolder.set(key, group);
  }
  const filed = Array.from(byFolder.values()).flatMap((group) =>
    evenSample([...group].sort((a, b) => a.absolutePath.localeCompare(b.absolutePath)), perFolder),
  );
  return [...loose, ...filed];
}

export function buildFolderProfiles(files: FileMeta[], vectors: Map<string, number[]>): FolderProfile[] {
  const members = new Map<string, FileMeta[]>();
  for (const f of files) {
    if (f.relativeFolder === '') continue;
    for (const folder of ancestorsAndSelf(profileFolderOf(f.relativeFolder))) {
      const list = members.get(folder) ?? [];
      list.push(f);
      members.set(folder, list);
    }
  }

  const profiles: FolderProfile[] = [];
  for (const [folderPath, folderFiles] of members) {
    let vectorSum: number[] | null = null;
    let embeddedCount = 0;
    for (const f of folderFiles) {
      const v = vectors.get(f.absolutePath);
      if (!v) continue;
      const unit = normalize(v);
      vectorSum = vectorSum ? vectorSum.map((x, i) => x + unit[i]) : [...unit];
      embeddedCount++;
    }
    if (!vectorSum) continue;

    const extCounts = new Map<string, number>();
    for (const f of folderFiles) {
      const ext = f.extension || '(none)';
      extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
    }
    const names = Array.from(new Set(folderFiles.map((f) => f.name))).sort();

    profiles.push({
      path: folderPath,
      fileCount: folderFiles.length,
      topExtensions: Array.from(extCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, TOP_EXTENSIONS),
      sampleNames: evenSample(names, SAMPLE_NAMES),
      centroid: normalize(vectorSum),
      vectorSum,
      embeddedCount,
    });
  }
  return profiles.sort((a, b) => a.path.localeCompare(b.path));
}

export function topFolders(
  profiles: FolderProfile[],
  vector: number[],
  n: number,
  exclude?: (p: FolderProfile) => boolean,
): Array<{ profile: FolderProfile; similarity: number }> {
  const unit = normalize(vector);
  return profiles
    .filter((p) => !exclude?.(p))
    .map((profile) => ({ profile, similarity: dot(unit, profile.centroid) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, n);
}

function shorten(name: string): string {
  return name.length > MAX_NAME_CHARS ? `${name.slice(0, MAX_NAME_CHARS - 1)}…` : name;
}

/** One prompt line, e.g. `Finance/Bank (42 files: .pdf ×38, .csv ×4) e.g. "Statement_2026-03.pdf"` */
export function describeProfile(p: FolderProfile, withSamples = true): string {
  const exts = p.topExtensions.map(([ext, n]) => `${ext} ×${n}`).join(', ');
  const base = `${p.path} (${p.fileCount} files: ${exts})`;
  if (!withSamples || p.sampleNames.length === 0) return base;
  return `${base} e.g. ${p.sampleNames.map((n) => `"${shorten(n)}"`).join(', ')}`;
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS; no type errors.

- [ ] **Step 6: Commit**

```bash
git add src
git commit -m "feat: folder profiles built from existing embeddings"
```

---

### Task 4: Built-in signatures

**Files:**
- Create: `src/main/context/signatures.ts`
- Test: `src/main/context/signatures.test.ts`

**Interfaces:**
- Produces:
  - `interface Signature { pattern: RegExp; app: string; category: string; folderHint?: string }`
  - `SIGNATURES: Signature[]`
  - `matchSignature(fileName: string): Signature | null`
  - `summarizeSignatures(fileNames: string[], max?: number): string[]`

- [ ] **Step 1: Write the failing tests**

`src/main/context/signatures.test.ts`:

```ts
import { matchSignature, summarizeSignatures } from './signatures';

describe('matchSignature', () => {
  it.each([
    ['IMG_20260312_101500.jpg', 'Phone camera'],
    ['PXL_20260101_120000123.jpg', 'Google Pixel camera'],
    ['DSC01234.ARW', 'Digital camera'],
    ['20260412_183005.jpg', 'Samsung camera'],
    ['Screenshot 2026-03-01 101500.png', 'Screenshot'],
    ['Screen Shot 2026-03-01 at 10.15.00.png', 'macOS screenshot'],
    ['WhatsApp Image 2026-03-01 at 10.15.00.jpeg', 'WhatsApp'],
    ['photo_2026-03-01_10-15-00.jpg', 'Telegram'],
    ['unknown.png', 'Discord'],
    ['2026-03-01 10-15-00.mkv', 'OBS recording'],
    ['Valorant 2026-03-01 10-15-00.mp4', 'Xbox Game Bar clip'],
    ['zoom_0.mp4', 'Zoom recording'],
    ['SteamSetup.exe', 'Steam'],
    ['EpicInstaller-15.17.1.msi', 'Epic Games'],
    ['setup_cyberpunk_2077_2.1_(64bit)_(70283).exe', 'GOG'],
    ['VSCodeUserSetup-x64-1.95.0.exe', 'Software installer'],
    ['python-3.13.0-amd64.exe', 'Software installer'],
    ['ubuntu-24.04-desktop-amd64.iso', 'Disk image'],
    ['Invoice_0042.pdf', 'Invoice'],
    ['INV-2026-001.pdf', 'Invoice'],
    ['Statement_2026-03.pdf', 'Bank statement'],
    ['P60_2025.pdf', 'Tax document'],
    ['John_Smith_CV.pdf', 'CV / résumé'],
    ['BoardingPass_LHR.pdf', 'Travel document'],
    ['takeout-20260301T101500Z-001.zip', 'Google Takeout'],
    ['scene.blend', 'Blender'],
    ['poster.psd', 'Photoshop'],
    ['Roboto-Regular.ttf', 'Font'],
    ['book.epub', 'E-book'],
  ])('%s → %s', (name, app) => {
    expect(matchSignature(name)?.app).toBe(app);
  });

  it.each(['notes.txt', 'syntax.md', 'image.png', 'report.docx', 'agenda.pdf'])('%s matches nothing', (name) => {
    expect(matchSignature(name)).toBeNull();
  });
});

describe('summarizeSignatures', () => {
  it('groups matches by app, most frequent first, with folder hints', () => {
    const lines = summarizeSignatures(['IMG_0001.jpg', 'IMG_0002.jpg', 'Invoice_1.pdf', 'notes.txt']);
    expect(lines).toEqual([
      'Phone camera — Photos, usually in "Photos" (2 files)',
      'Invoice — Finance, usually in "Finance/Invoices" (1 file)',
    ]);
  });

  it('returns nothing when no file matches', () => {
    expect(summarizeSignatures(['notes.txt'])).toEqual([]);
  });

  it('keeps only the top entries', () => {
    const names = ['a.ttf', 'b.epub', 'c.blend', 'd.psd', 'e.iso', 'f.torrent'];
    expect(summarizeSignatures(names, 3)).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/main/context/signatures`
Expected: FAIL — `Cannot find module './signatures'`.

- [ ] **Step 3: Implement**

`src/main/context/signatures.ts` (order matters: first match wins, so specific patterns come before generic ones):

```ts
export interface Signature {
  pattern: RegExp;
  app: string;
  category: string;
  /** Advisory only — the user's existing folders always take priority */
  folderHint?: string;
}

// Word-ish boundary for names like "P60_2025.pdf" or "my-tax-return.pdf" without matching "syntax.md"
const B = '(?:^|[-_ .()])';
const E = '(?:[-_ .()]|$)';

export const SIGNATURES: Signature[] = [
  // Screenshots
  { pattern: /^Screenshot[ _(-]/i, app: 'Screenshot', category: 'Screenshots', folderHint: 'Screenshots' },
  { pattern: /^Screen ?Shot \d{4}-\d{2}-\d{2}/i, app: 'macOS screenshot', category: 'Screenshots', folderHint: 'Screenshots' },
  { pattern: /^(Snip|Snagit|Lightshot|ShareX_)/i, app: 'Screen capture tool', category: 'Screenshots', folderHint: 'Screenshots' },
  { pattern: /^(Capture|Annotation) \d{4}-\d{2}-\d{2}/i, app: 'Windows capture', category: 'Screenshots', folderHint: 'Screenshots' },

  // Messaging apps
  { pattern: /^WhatsApp (Image|Video|Audio|Document)/i, app: 'WhatsApp', category: 'Media', folderHint: 'WhatsApp' },
  { pattern: /^PTT-\d{8}-WA/i, app: 'WhatsApp', category: 'Voice notes', folderHint: 'WhatsApp' },
  { pattern: /^(photo|video)_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/i, app: 'Telegram', category: 'Media', folderHint: 'Telegram' },
  { pattern: /^unknown(-\d+)?\.(png|jpe?g|gif|webp)$/i, app: 'Discord', category: 'Images', folderHint: 'Discord' },
  { pattern: /^signal-\d{4}-\d{2}-\d{2}/i, app: 'Signal', category: 'Media', folderHint: 'Signal' },
  { pattern: /^received_\d{10,}/i, app: 'Facebook Messenger', category: 'Media' },

  // Recordings (OBS has no prefix; Game Bar puts the game title first)
  { pattern: /^\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.(mkv|mp4|flv|mov)$/i, app: 'OBS recording', category: 'Videos', folderHint: 'Videos/Recordings' },
  { pattern: /^.+ \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.mp4$/i, app: 'Xbox Game Bar clip', category: 'Videos', folderHint: 'Videos/Captures' },
  { pattern: /\.DVR\.mp4$|^.+ \d{4}\.\d{2}\.\d{2} - \d{2}\.\d{2}\.\d{2}\.\d{2}/i, app: 'NVIDIA ShadowPlay clip', category: 'Videos', folderHint: 'Videos/Captures' },
  { pattern: /^(zoom_\d+\.mp4|GMT\d{8}-\d{6}_Recording)/i, app: 'Zoom recording', category: 'Meeting recordings', folderHint: 'Videos/Meetings' },
  { pattern: /Meeting Recording|^Recording-\d|Meet Recording/i, app: 'Teams/Meet recording', category: 'Meeting recordings', folderHint: 'Videos/Meetings' },
  { pattern: /^(New Recording( \d+)?|Voice \d+)\.m4a$/i, app: 'Voice memo', category: 'Audio', folderHint: 'Audio' },

  // Cameras
  { pattern: /^IMG_\d{4,}/i, app: 'Phone camera', category: 'Photos', folderHint: 'Photos' },
  { pattern: /^PXL_\d{8}_/i, app: 'Google Pixel camera', category: 'Photos', folderHint: 'Photos' },
  { pattern: /^\d{8}_\d{6}\.(jpe?g|heic|mp4)$/i, app: 'Samsung camera', category: 'Photos', folderHint: 'Photos' },
  { pattern: /^DSC[_F]?\d{4,}/i, app: 'Digital camera', category: 'Photos', folderHint: 'Photos' },
  { pattern: /^DJI_\d{4}/i, app: 'DJI drone', category: 'Photos', folderHint: 'Photos' },
  { pattern: /^(GOPR\d{4}|GH\d{6})/i, app: 'GoPro', category: 'Videos', folderHint: 'Videos' },
  { pattern: /\.(heic|heif)$/i, app: 'iPhone photo', category: 'Photos', folderHint: 'Photos' },
  { pattern: /\.(cr2|cr3|nef|arw|dng|raf|orf|rw2)$/i, app: 'Camera RAW', category: 'Photos', folderHint: 'Photos/RAW' },

  // Game launchers and games (before generic installers)
  { pattern: /^(SteamSetup|steam_)/i, app: 'Steam', category: 'Games', folderHint: 'Games' },
  { pattern: /^(EpicInstaller|EpicGamesLauncher)/i, app: 'Epic Games', category: 'Games', folderHint: 'Games' },
  { pattern: /^setup_.+_\(\d+\)\.exe$|^GOG/i, app: 'GOG', category: 'Games', folderHint: 'Games' },
  { pattern: /^Battle\.net-Setup/i, app: 'Battle.net', category: 'Games', folderHint: 'Games' },
  { pattern: /^(EAapp|EA ?Desktop|Origin)Installer|^EAappInstaller/i, app: 'EA app', category: 'Games', folderHint: 'Games' },
  { pattern: /^(UbisoftConnect|UplayInstaller)/i, app: 'Ubisoft Connect', category: 'Games', folderHint: 'Games' },
  { pattern: /\.(mcworld|mcpack|mcaddon)$|^MinecraftInstaller/i, app: 'Minecraft', category: 'Games', folderHint: 'Games' },
  { pattern: /\.(sav|savegame)$/i, app: 'Game save', category: 'Games', folderHint: 'Games/Saves' },

  // Software
  { pattern: /(setup|install(er)?).*\.(exe|msi)$/i, app: 'Software installer', category: 'Software', folderHint: 'Software/Installers' },
  { pattern: /[-_.](x64|x86|amd64|arm64|win64|win32)[-_.].*\.(exe|msi|zip)$|[-_.](x64|x86|amd64|arm64|win64|win32)\.(exe|msi|zip)$/i, app: 'Software installer', category: 'Software', folderHint: 'Software/Installers' },
  { pattern: /\.(msi|msix|appx|appxbundle)$/i, app: 'Windows installer package', category: 'Software', folderHint: 'Software/Installers' },
  { pattern: /\.(dmg|pkg)$/i, app: 'macOS installer', category: 'Software', folderHint: 'Software/Installers' },
  { pattern: /\.(deb|rpm|appimage)$/i, app: 'Linux package', category: 'Software', folderHint: 'Software/Installers' },
  { pattern: /\.apk$/i, app: 'Android app', category: 'Software', folderHint: 'Software/Android' },
  { pattern: /\.(iso|img)$/i, app: 'Disk image', category: 'Software', folderHint: 'Software/Disk images' },
  { pattern: /\.vsix$/i, app: 'VS Code extension', category: 'Development', folderHint: 'Development' },
  { pattern: /\.whl$/i, app: 'Python wheel', category: 'Development', folderHint: 'Development' },
  { pattern: /\.jar$/i, app: 'Java archive', category: 'Development', folderHint: 'Development' },
  { pattern: /\.torrent$/i, app: 'Torrent', category: 'Downloads' },

  // Finance and admin documents
  { pattern: new RegExp(`invoice|^inv[-_ ]?\\d+`, 'i'), app: 'Invoice', category: 'Finance', folderHint: 'Finance/Invoices' },
  { pattern: /statement/i, app: 'Bank statement', category: 'Finance', folderHint: 'Finance/Bank' },
  { pattern: /receipt/i, app: 'Receipt', category: 'Finance', folderHint: 'Finance/Receipts' },
  { pattern: /payslip|pay[-_ ]?stub|salary/i, app: 'Payslip', category: 'Finance', folderHint: 'Finance/Payslips' },
  { pattern: new RegExp(`${B}(tax|p60|p45|p11d|w-?2|1099|hmrc|self[-_ ]assessment)${E}`, 'i'), app: 'Tax document', category: 'Finance', folderHint: 'Finance/Tax' },
  { pattern: new RegExp(`contract|agreement|${B}nda${E}`, 'i'), app: 'Contract', category: 'Documents', folderHint: 'Documents/Contracts' },
  { pattern: new RegExp(`${B}(cv|resume|résumé|curriculum[-_ ]vitae)${E}`, 'i'), app: 'CV / résumé', category: 'Documents', folderHint: 'Documents/Career' },
  { pattern: /passport|driving[-_ ]?licen[cs]e|birth[-_ ]?certificate/i, app: 'ID document', category: 'Documents', folderHint: 'Documents/Personal' },
  { pattern: /boarding[-_ ]?pass|e-?ticket|itinerary|booking[-_ ]?confirmation/i, app: 'Travel document', category: 'Travel', folderHint: 'Documents/Travel' },

  // Data exports and other apps
  { pattern: /^takeout-\d/i, app: 'Google Takeout', category: 'Backups', folderHint: 'Backups' },
  { pattern: /^(facebook|instagram|twitter)-[\w-]*\d/i, app: 'Social media export', category: 'Backups', folderHint: 'Backups' },
  { pattern: /\.ics$/i, app: 'Calendar invite', category: 'Documents' },
  { pattern: /\.(eml|msg)$/i, app: 'Email', category: 'Documents', folderHint: 'Documents/Email' },
  { pattern: /\.kdbx$/i, app: 'KeePass database', category: 'Security' },
  { pattern: /\.(blend|blend1)$/i, app: 'Blender', category: '3D', folderHint: 'Projects/3D' },
  { pattern: /\.(stl|3mf|gcode)$/i, app: '3D printing', category: '3D', folderHint: 'Projects/3D printing' },
  { pattern: /\.(psd|psb)$/i, app: 'Photoshop', category: 'Design', folderHint: 'Design' },
  { pattern: /\.(ai|indd)$/i, app: 'Illustrator / InDesign', category: 'Design', folderHint: 'Design' },
  { pattern: /\.(fig|sketch|xd)$/i, app: 'UI design file', category: 'Design', folderHint: 'Design' },
  { pattern: /\.(prproj|aep|drp)$/i, app: 'Video editing project', category: 'Videos', folderHint: 'Videos/Projects' },
  { pattern: /\.(als|flp|logicx|ptx)$/i, app: 'Music production project', category: 'Music', folderHint: 'Music/Projects' },
  { pattern: /\.(ttf|otf|woff2?)$/i, app: 'Font', category: 'Fonts', folderHint: 'Fonts' },
  { pattern: /\.(epub|mobi|azw3)$/i, app: 'E-book', category: 'Books', folderHint: 'Books' },
  { pattern: /\.(srt|vtt|ass)$/i, app: 'Subtitles', category: 'Videos', folderHint: 'Videos' },
];

export function matchSignature(fileName: string): Signature | null {
  return SIGNATURES.find((s) => s.pattern.test(fileName)) ?? null;
}

/** Prompt lines like `Phone camera — Photos, usually in "Photos" (12 files)`, most frequent first */
export function summarizeSignatures(fileNames: string[], max = 5): string[] {
  const counts = new Map<Signature, number>();
  for (const name of fileNames) {
    const sig = matchSignature(name);
    if (sig) counts.set(sig, (counts.get(sig) ?? 0) + 1);
  }
  // Several entries can share an app name (e.g. installers); merge them into one line
  const byLabel = new Map<string, number>();
  for (const [sig, n] of counts) {
    const hint = sig.folderHint ? `, usually in "${sig.folderHint}"` : '';
    const label = `${sig.app} — ${sig.category}${hint}`;
    byLabel.set(label, (byLabel.get(label) ?? 0) + n);
  }
  return Array.from(byLabel.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([label, n]) => `${label} (${n} file${n === 1 ? '' : 's'})`);
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest src/main/context/signatures && npm run typecheck`
Expected: PASS. If a table row fails, fix the **pattern or its order** (not the test) — the table is the specification of what users' real files look like.

- [ ] **Step 5: Commit**

```bash
git add src/main/context/signatures.ts src/main/context/signatures.test.ts
git commit -m "feat: built-in app and file-naming signatures"
```

---

### Task 5: Download origin

**Files:**
- Create: `src/main/context/fileOrigin.ts`
- Test: `src/main/context/fileOrigin.test.ts`

**Interfaces:**
- Produces:
  - `parseZoneIdentifier(content: string): string | undefined`
  - `readOriginHost(absolutePath: string, platform?: NodeJS.Platform): Promise<string | undefined>`
  - `summarizeOrigins(files: FileMeta[], max?: number): string | null` — e.g. `hsbc.co.uk (6), mail.google.com (2)`

- [ ] **Step 1: Write the failing tests**

`src/main/context/fileOrigin.test.ts`:

```ts
import fsp from 'fs/promises';
import { FileMeta } from '@shared/types';
import { parseZoneIdentifier, readOriginHost, summarizeOrigins } from './fileOrigin';

jest.mock('fs/promises');
const mockFsp = fsp as jest.Mocked<typeof fsp>;

describe('parseZoneIdentifier', () => {
  it('returns the HostUrl hostname without www', () => {
    expect(parseZoneIdentifier('[ZoneTransfer]\nZoneId=3\nHostUrl=https://www.GitHub.com/x/y.zip\n')).toBe('github.com');
  });

  it('handles CRLF line endings and a BOM', () => {
    const content = '\uFEFF[ZoneTransfer]\r\nZoneId=3\r\nReferrerUrl=https://discord.com/channels/1\r\nHostUrl=https://cdn.discordapp.com/a.png\r\n';
    expect(parseZoneIdentifier(content)).toBe('cdn.discordapp.com');
  });

  it('falls back to ReferrerUrl when HostUrl is not a web URL', () => {
    const content = '[ZoneTransfer]\nZoneId=3\nReferrerUrl=https://mail.google.com/mail/u/0\nHostUrl=blob:https://mail.google.com/abc\n';
    expect(parseZoneIdentifier(content)).toBe('mail.google.com');
  });

  it.each([
    '[ZoneTransfer]\nZoneId=3\nHostUrl=about:internet\n',
    '[ZoneTransfer]\nZoneId=3\n',
    'garbage',
    '',
  ])('returns undefined for %p', (content) => {
    expect(parseZoneIdentifier(content)).toBeUndefined();
  });
});

describe('readOriginHost', () => {
  it('reads the Zone.Identifier stream on Windows', async () => {
    mockFsp.readFile = jest.fn().mockResolvedValue('[ZoneTransfer]\nHostUrl=https://example.org/f.pdf\n');
    expect(await readOriginHost('C:\\d\\f.pdf', 'win32')).toBe('example.org');
    expect(mockFsp.readFile).toHaveBeenCalledWith('C:\\d\\f.pdf:Zone.Identifier', 'utf8');
  });

  it('returns undefined when the stream is missing', async () => {
    mockFsp.readFile = jest.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    expect(await readOriginHost('C:\\d\\f.pdf', 'win32')).toBeUndefined();
  });

  it('does nothing on other platforms', async () => {
    mockFsp.readFile = jest.fn();
    expect(await readOriginHost('/d/f.pdf', 'linux')).toBeUndefined();
    expect(mockFsp.readFile).not.toHaveBeenCalled();
  });
});

describe('summarizeOrigins', () => {
  const f = (originHost?: string) => ({ originHost } as FileMeta);
  it('counts hosts, most frequent first', () => {
    expect(summarizeOrigins([f('a.com'), f('b.com'), f('a.com'), f()])).toBe('a.com (2), b.com (1)');
  });
  it('returns null when no file has an origin', () => {
    expect(summarizeOrigins([f(), f()])).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/main/context/fileOrigin`
Expected: FAIL — `Cannot find module './fileOrigin'`.

- [ ] **Step 3: Implement**

`src/main/context/fileOrigin.ts`:

```ts
import fsp from 'fs/promises';
import { FileMeta } from '@shared/types';

function webHost(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
    return u.hostname.toLowerCase().replace(/^www\./, '') || undefined;
  } catch {
    return undefined;
  }
}

/** Hostname a file was downloaded from, given the text of its Zone.Identifier stream */
export function parseZoneIdentifier(content: string): string | undefined {
  const fields = new Map<string, string>();
  for (const line of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*(HostUrl|ReferrerUrl)\s*=\s*(.+?)\s*$/i);
    if (m) fields.set(m[1].toLowerCase(), m[2]);
  }
  return webHost(fields.get('hosturl')) ?? webHost(fields.get('referrerurl'));
}

/**
 * Browsers on Windows tag downloads with an NTFS alternate data stream (Mark of the Web)
 * that records the source URL. Other platforms, and files without the stream, have no origin.
 */
export async function readOriginHost(
  absolutePath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  if (platform !== 'win32') return undefined;
  try {
    return parseZoneIdentifier(await fsp.readFile(`${absolutePath}:Zone.Identifier`, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Prompt line like `hsbc.co.uk (6), mail.google.com (2)`, or null when nothing has an origin */
export function summarizeOrigins(files: FileMeta[], max = 4): string | null {
  const counts = new Map<string, number>();
  for (const f of files) {
    if (f.originHost) counts.set(f.originHost, (counts.get(f.originHost) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([host, n]) => `${host} (${n})`)
    .join(', ');
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest src/main/context/fileOrigin && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Verify against a real download (Windows only)**

Pick any file in your Downloads folder that came from a browser and run:

```bash
node -e "require('fs').promises.readFile(process.argv[1] + ':Zone.Identifier', 'utf8').then(console.log, e => console.log('no stream:', e.code))" "C:/Users/<you>/Downloads/<file>"
```

Expected: a `[ZoneTransfer]` block with `HostUrl=` — confirms Node can read the ADS path form used above.

- [ ] **Step 6: Commit**

```bash
git add src/main/context/fileOrigin.ts src/main/context/fileOrigin.test.ts
git commit -m "feat: read download origin from Windows Zone.Identifier"
```

---

### Task 6: Misfit candidates

**Files:**
- Create: `src/main/context/misfitDetector.ts`
- Test: `src/main/context/misfitDetector.test.ts`

**Interfaces:**
- Consumes: `FolderProfile`, `profileFolderOf`, `isRelatedFolder`, `topFolders`, `buildFolderProfiles` (Task 3); `normalize`, `dot` (Task 3).
- Produces:
  - `MISFIT_MARGIN = 0.1`, `MIN_FOLDER_SIZE = 4`, `MAX_MISFIT_CANDIDATES = 40`
  - `interface MisfitCandidate { file: FileMeta; current: FolderProfile; alternatives: FolderProfile[]; margin: number }`
  - `findMisfitCandidates(files: FileMeta[], vectors: Map<string, number[]>, profiles: FolderProfile[], opts?: { margin?: number; minFolderSize?: number; maxCandidates?: number }): MisfitCandidate[]`

- [ ] **Step 1: Write the failing tests**

`src/main/context/misfitDetector.test.ts`:

```ts
import { FileMeta } from '@shared/types';
import { buildFolderProfiles } from './folderProfiles';
import { findMisfitCandidates } from './misfitDetector';

function file(relativeFolder: string, name: string): FileMeta {
  return {
    absolutePath: `/root/${relativeFolder}/${name}`, name, extension: '.x', sizeBytes: 1,
    createdAt: new Date(), modifiedAt: new Date(), mimeType: 'x', relativeFolder,
  };
}

// Photos: 4 photo-like files + 1 invoice-like outlier; Finance: 4 invoice-like files
function fixture() {
  const files: FileMeta[] = [];
  const vectors = new Map<string, number[]>();
  const add = (folder: string, name: string, v: number[]) => {
    const f = file(folder, name);
    files.push(f);
    vectors.set(f.absolutePath, v);
    return f;
  };
  for (let i = 0; i < 4; i++) add('Photos', `IMG_${i}.jpg`, [0, 1, 0]);
  const invoice = add('Photos', 'invoice.pdf', [1, 0, 0]);
  for (let i = 0; i < 4; i++) add('Finance', `inv${i}.pdf`, [1, 0.05, 0]);
  return { files, vectors, invoice };
}

describe('findMisfitCandidates', () => {
  it('flags a file much closer to another folder than to its own', () => {
    const { files, vectors, invoice } = fixture();
    const result = findMisfitCandidates(files, vectors, buildFolderProfiles(files, vectors));
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe(invoice);
    expect(result[0].current.path).toBe('Photos');
    expect(result[0].alternatives.map((p) => p.path)).toEqual(['Finance']);
    expect(result[0].margin).toBeGreaterThan(0.9);
  });

  it('leaves the file out of its own folder centroid (leave-one-out)', () => {
    // With only 4 files in Photos the outlier is 1/4 of the centroid; leave-one-out keeps ownSim at 0
    const { files, vectors } = fixture();
    const result = findMisfitCandidates(files, vectors, buildFolderProfiles(files, vectors));
    expect(result[0].margin).toBeCloseTo(1 - 0, 1);
  });

  it('ignores folders with fewer than the minimum embedded files', () => {
    const { files, vectors } = fixture();
    const result = findMisfitCandidates(files, vectors, buildFolderProfiles(files, vectors), { minFolderSize: 6 });
    expect(result).toEqual([]);
  });

  it('respects the margin threshold', () => {
    const { files, vectors } = fixture();
    const result = findMisfitCandidates(files, vectors, buildFolderProfiles(files, vectors), { margin: 1.5 });
    expect(result).toEqual([]);
  });

  it('never proposes an ancestor or descendant folder', () => {
    const files: FileMeta[] = [];
    const vectors = new Map<string, number[]>();
    for (let i = 0; i < 4; i++) {
      const f = file('Media', `m${i}.jpg`);
      files.push(f);
      vectors.set(f.absolutePath, [0, 1]);
    }
    for (let i = 0; i < 4; i++) {
      const f = file('Media/Photos', `p${i}.jpg`);
      files.push(f);
      vectors.set(f.absolutePath, [1, 0]);
    }
    const odd = file('Media', 'odd.jpg');
    files.push(odd);
    vectors.set(odd.absolutePath, [1, 0]);
    expect(findMisfitCandidates(files, vectors, buildFolderProfiles(files, vectors))).toEqual([]);
  });

  it('skips files without an embedding and loose files', () => {
    const { files, vectors, invoice } = fixture();
    vectors.delete(invoice.absolutePath);
    const loose = { ...file('', 'x.pdf'), absolutePath: '/root/x.pdf' };
    vectors.set(loose.absolutePath, [1, 0, 0]);
    const all = [...files, loose];
    expect(findMisfitCandidates(all, vectors, buildFolderProfiles(all, vectors))).toEqual([]);
  });

  it('orders by margin and caps the count', () => {
    const files: FileMeta[] = [];
    const vectors = new Map<string, number[]>();
    const add = (folder: string, name: string, v: number[]) => {
      const f = file(folder, name);
      files.push(f);
      vectors.set(f.absolutePath, v);
    };
    for (let i = 0; i < 6; i++) add('A', `a${i}`, [0, 1]);
    add('A', 'strong', [1, 0]);
    add('A', 'weaker', [1, 0.6]);
    for (let i = 0; i < 4; i++) add('B', `b${i}`, [1, 0]);
    const result = findMisfitCandidates(files, vectors, buildFolderProfiles(files, vectors), { maxCandidates: 1 });
    expect(result.map((c) => c.file.name)).toEqual(['strong']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/main/context/misfitDetector`
Expected: FAIL — `Cannot find module './misfitDetector'`.

- [ ] **Step 3: Implement**

`src/main/context/misfitDetector.ts`:

```ts
import { FileMeta } from '@shared/types';
import { FolderProfile, isRelatedFolder, profileFolderOf, topFolders } from './folderProfiles';
import { dot, normalize } from './vectorMath';

export const MISFIT_MARGIN = 0.1;
export const MIN_FOLDER_SIZE = 4;
export const MAX_MISFIT_CANDIDATES = 40;
const ALTERNATIVES = 2;

export interface MisfitCandidate {
  file: FileMeta;
  current: FolderProfile;
  /** Best other folders, most similar first; never the current folder's ancestors or descendants */
  alternatives: FolderProfile[];
  /** How much closer the best alternative is than the current folder */
  margin: number;
}

export interface MisfitOptions {
  margin?: number;
  minFolderSize?: number;
  maxCandidates?: number;
}

/**
 * Stage 1 of misfit detection — embedding outliers only, no LLM.
 * A filed file is a candidate when another (unrelated) folder is clearly closer to it than its own.
 */
export function findMisfitCandidates(
  files: FileMeta[],
  vectors: Map<string, number[]>,
  profiles: FolderProfile[],
  opts: MisfitOptions = {},
): MisfitCandidate[] {
  const margin = opts.margin ?? MISFIT_MARGIN;
  const minFolderSize = opts.minFolderSize ?? MIN_FOLDER_SIZE;
  const maxCandidates = opts.maxCandidates ?? MAX_MISFIT_CANDIDATES;
  const byPath = new Map(profiles.map((p) => [p.path, p]));
  const candidates: MisfitCandidate[] = [];

  for (const file of files) {
    if (file.relativeFolder === '') continue;
    const vector = vectors.get(file.absolutePath);
    if (!vector) continue;
    const current = byPath.get(profileFolderOf(file.relativeFolder));
    if (!current || current.embeddedCount < minFolderSize) continue;

    const unit = normalize(vector);
    // Leave the file out of its own folder's centroid, or it would always look like it fits
    const ownCentroid = normalize(current.vectorSum.map((x, i) => x - unit[i]));
    const ownSimilarity = dot(unit, ownCentroid);

    const ranked = topFolders(profiles, unit, ALTERNATIVES, (p) => isRelatedFolder(p.path, current.path));
    if (ranked.length === 0) continue;
    const gap = ranked[0].similarity - ownSimilarity;
    if (gap < margin) continue;

    candidates.push({ file, current, alternatives: ranked.map((r) => r.profile), margin: gap });
  }

  return candidates.sort((a, b) => b.margin - a.margin).slice(0, maxCandidates);
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest src/main/context/misfitDetector && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/context/misfitDetector.ts src/main/context/misfitDetector.test.ts
git commit -m "feat: embedding-based misfit candidate detection"
```

---

### Task 7: Context section in loose-cluster prompts

**Files:**
- Modify: `src/main/reasoning/llmReasoner.ts`
- Test: `src/main/reasoning/llmReasoner.test.ts`

**Interfaces:**
- Consumes: `FolderProfile`, `topFolders`, `describeProfile` (Task 3); `meanDirection` (Task 3); `summarizeSignatures` (Task 4); `summarizeOrigins` (Task 5).
- Produces:
  - `ReasonOptions` gains `profiles?: FolderProfile[]` and `vectors?: Map<string, number[]>`
  - `CONTEXT_CHAR_BUDGET = 4800`, `MAX_FOLDER_LIST = 60`, `SIMILAR_FOLDER_COUNT = 5`
  - `interface ContextInput { similar: FolderProfile[]; allFolders: string[]; signatureLines: string[]; originLine: string | null }`
  - `buildContextSection(input: ContextInput, budget?: number): string`
  - `reasonClusters(...)` signature unchanged; `existingFolders` now receives the full depth-≤3 folder list.

- [ ] **Step 1: Write the failing tests**

Append to `src/main/reasoning/llmReasoner.test.ts` (add `buildContextSection` to the import from `./llmReasoner`, and `import { FolderProfile } from '../context/folderProfiles';`):

```ts
function profile(path: string, centroid: number[], sampleNames = ['a.pdf']): FolderProfile {
  return { path, fileCount: 10, topExtensions: [['.pdf', 10]], sampleNames, centroid, vectorSum: centroid, embeddedCount: 10 };
}

describe('buildContextSection', () => {
  it('includes every section that has content', () => {
    const text = buildContextSection({
      similar: [profile('Finance/Bank', [1, 0])],
      allFolders: ['Finance', 'Finance/Bank'],
      signatureLines: ['Bank statement — Finance (2 files)'],
      originLine: 'hsbc.co.uk (2)',
    });
    expect(text).toContain('Most similar existing folders:\n  - Finance/Bank (10 files: .pdf ×10) e.g. "a.pdf"');
    expect(text).toContain('All existing folders: Finance, Finance/Bank');
    expect(text).toContain('Known patterns in this group:\n  - Bank statement — Finance (2 files)');
    expect(text).toContain('Downloaded from: hsbc.co.uk (2)');
  });

  it('omits empty sections', () => {
    const text = buildContextSection({ similar: [], allFolders: ['Docs'], signatureLines: [], originLine: null });
    expect(text).toBe('All existing folders: Docs');
  });

  it('stays within budget with very long folder and file names', () => {
    const longName = 'x'.repeat(250);
    const text = buildContextSection({
      similar: Array.from({ length: 5 }, (_, i) => profile(`Folder${i}/${longName}`, [1, 0], [longName, longName, longName, longName, longName])),
      allFolders: Array.from({ length: 60 }, (_, i) => `Folder${i}/${longName}`),
      signatureLines: ['Font — Fonts (1 file)'],
      originLine: 'a.com (1)',
    });
    expect(text.length).toBeLessThanOrEqual(4800);
    expect(text).toContain('Most similar existing folders:');
  });
});

describe('reasonClusters with context', () => {
  it('puts the most similar folders, signatures and origins in the prompt', async () => {
    const client = { chat: jest.fn().mockResolvedValue(llmResponse) } as unknown as OllamaClient;
    const meta = { ...makeMeta('/root/IMG_0001.jpg'), originHost: 'drive.google.com' };
    await reasonClusters(
      [{ filePath: meta.absolutePath, clusterId: 0 }],
      new Map([[meta.absolutePath, meta]]),
      ['Media', 'Media/Photos', 'Finance'],
      client, 'm', () => {},
      {
        rootPath: '/root',
        profiles: [profile('Media/Photos', [0, 1]), profile('Finance', [1, 0])],
        vectors: new Map([[meta.absolutePath, [0.1, 1]]]),
      },
    );
    const prompt: string = (client.chat as jest.Mock).mock.calls[0][1];
    const similar = prompt.slice(prompt.indexOf('Most similar existing folders:'));
    expect(similar.indexOf('Media/Photos')).toBeLessThan(similar.indexOf('Finance ('));
    expect(prompt).toContain('All existing folders: Media, Media/Photos, Finance');
    expect(prompt).toContain('Phone camera — Photos');
    expect(prompt).toContain('Downloaded from: drive.google.com (1)');
    expect(prompt).toContain('Prefer the most similar existing folder');
  });

  it('says there are no folders when there is nothing to reuse', async () => {
    const client = { chat: jest.fn().mockResolvedValue(llmResponse) } as unknown as OllamaClient;
    await reasonClusters(
      [{ filePath: '/root/a.txt', clusterId: 0 }],
      new Map([['/root/a.txt', makeMeta('/root/a.txt')]]),
      [], client, 'm', () => {},
    );
    expect((client.chat as jest.Mock).mock.calls[0][1]).toContain('No existing folders yet — you may create one.');
  });

  it('returns no suggestions when there are no clusters', async () => {
    const client = { chat: jest.fn() } as unknown as OllamaClient;
    expect(await reasonClusters([], new Map(), ['A'], client, 'm', () => {})).toEqual([]);
    expect(client.chat).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/main/reasoning`
Expected: FAIL — `buildContextSection is not a function`; prompt lacks `Most similar existing folders:`.

- [ ] **Step 3: Implement**

In `src/main/reasoning/llmReasoner.ts`:

Add imports:

```ts
import { FolderProfile, describeProfile, topFolders } from '../context/folderProfiles';
import { meanDirection } from '../context/vectorMath';
import { summarizeSignatures } from '../context/signatures';
import { summarizeOrigins } from '../context/fileOrigin';
```

Extend `ReasonOptions`:

```ts
export interface ReasonOptions {
  /** Scan root — file paths in prompts are shown relative to it */
  rootPath?: string;
  /** Number of chat requests in flight at once */
  concurrency?: number;
  signal?: AbortSignal;
  /** Profiles of the user's existing folders, for retrieving the most similar ones per cluster */
  profiles?: FolderProfile[];
  /** Embeddings by absolute file path */
  vectors?: Map<string, number[]>;
}
```

Add constants and the context builder below `CATEGORY_HINTS`:

```ts
// ~1,200 tokens at ~4 chars/token — leaves room for hints, files and the answer in a 4096 context
export const CONTEXT_CHAR_BUDGET = 4800;
export const MAX_FOLDER_LIST = 60;
export const SIMILAR_FOLDER_COUNT = 5;

export interface ContextInput {
  similar: FolderProfile[];
  allFolders: string[];
  signatureLines: string[];
  originLine: string | null;
}

/** Evidence about the user's organisation for one prompt, shrunk until it fits the budget */
export function buildContextSection(input: ContextInput, budget = CONTEXT_CHAR_BUDGET): string {
  const render = (withSamples: boolean, folderCap: number): string => {
    const parts: string[] = [];
    if (input.similar.length) {
      parts.push(`Most similar existing folders:\n${input.similar.map((p) => `  - ${describeProfile(p, withSamples)}`).join('\n')}`);
    }
    if (input.allFolders.length && folderCap > 0) {
      parts.push(`All existing folders: ${input.allFolders.slice(0, folderCap).join(', ')}`);
    }
    if (input.signatureLines.length) {
      parts.push(`Known patterns in this group:\n${input.signatureLines.map((l) => `  - ${l}`).join('\n')}`);
    }
    if (input.originLine) parts.push(`Downloaded from: ${input.originLine}`);
    return parts.join('\n');
  };

  let cap = MAX_FOLDER_LIST;
  let text = render(true, cap);
  if (text.length > budget) text = render(false, cap);
  while (text.length > budget && cap > 0) {
    cap = Math.floor(cap / 2);
    text = render(false, cap);
  }
  return text.length > budget ? text.slice(0, budget) : text;
}
```

Replace `buildPrompt` with:

```ts
function buildPrompt(displayPaths: string[], metas: FileMeta[], context: string): string {
  const shown = evenSample(displayPaths, MAX_PATHS_IN_PROMPT);
  const sizeLine = shown.length < displayPaths.length
    ? `This group has ${displayPaths.length} files; a representative sample of ${shown.length} is shown.`
    : `This group has ${displayPaths.length} files.`;
  const extLine = metas.length ? `\nFile types: ${summarizeExtensions(metas)}` : '';

  return `You are a file organisation assistant. Given a group of related files, suggest the single best folder to move them into.

${context || 'No existing folders yet — you may create one.'}

${CATEGORY_HINTS}

${sizeLine}${extLine}
Files (relative paths — the path gives context about where they came from):
${shown.map((p) => `- ${p}`).join('\n')}

Rules:
1. If an existing folder fits well, use it — do not create a new one unnecessarily.
2. Prefer the most similar existing folder unless the evidence clearly points elsewhere.
3. Use "/" for subfolders only when genuinely needed (e.g. "Documents/Work").
4. Be specific: "Games" is better than "Misc", "Drivers" is better than "Software".
5. confidence is between 0 and 1: high when the files clearly share one purpose, low when they are mixed.

Respond with JSON: {"rationale": "One sentence explanation.", "suggestedFolder": "FolderName", "confidence": 0.85}`;
}
```

In `buildAtomicPrompt`, cap the folder list: change `existingFolders.map(` to `existingFolders.slice(0, MAX_FOLDER_LIST).map(`.

In `reasonClusters`, replace the task passed to `mapWithConcurrency` with:

```ts
    (clusterId) => {
      const filePaths = clusterMap.get(clusterId)!;
      const metas = filePaths.map((p) => fileMap.get(p)).filter((m): m is FileMeta => !!m);
      const displayPaths = filePaths.map((p) => toDisplayPath(p, options.rootPath));
      const profiles = options.profiles ?? [];
      const clusterVectors = filePaths.map((p) => options.vectors?.get(p)).filter((v): v is number[] => !!v);
      const similar = profiles.length > 0 && clusterVectors.length > 0
        ? topFolders(profiles, meanDirection(clusterVectors), SIMILAR_FOLDER_COUNT).map((r) => r.profile)
        : [];
      const context = buildContextSection({
        similar,
        allFolders: existingFolders,
        signatureLines: summarizeSignatures(metas.map((m) => m.name)),
        originLine: summarizeOrigins(metas),
      });
      return ask(client, model, buildPrompt(displayPaths, metas, context), existingFolders);
    },
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx jest src/main/reasoning && npm run typecheck`
Expected: PASS. (Existing tests that asserted `Existing folders (STRONGLY prefer…` text no longer apply — none do at present; if one does, update its expectation to `All existing folders:`.)

- [ ] **Step 5: Commit**

```bash
git add src/main/reasoning
git commit -m "feat: retrieve similar folders, signatures and origins into cluster prompts"
```

---

### Task 8: LLM confirmation of misfits

**Files:**
- Modify: `src/main/reasoning/llmReasoner.ts`
- Test: `src/main/reasoning/llmReasoner.test.ts`

**Interfaces:**
- Consumes: `MisfitCandidate` (Task 6); `describeProfile` (Task 3); `matchSignature` (Task 4); `clampConfidence`, `mapWithConcurrency`, `toDisplayPath`, `ReasonOptions` (existing in `llmReasoner.ts`).
- Produces:
  - `parseMisfitResponse(raw: string, alternatives: string[]): { folder: string; confidence: number; rationale: string } | null`
  - `confirmMisfits(candidates: MisfitCandidate[], client: OllamaClient, model: string, onProgress: (done: number, total: number) => void, options?: ReasonOptions): Promise<FileSuggestion[]>` — every result has `kind: 'misfiled'`, `currentFolder` = the file's `relativeFolder`, `clusterId: -1`, `status: 'pending'`.

- [ ] **Step 1: Write the failing tests**

Append to `src/main/reasoning/llmReasoner.test.ts` (add `confirmMisfits, parseMisfitResponse` to the import, and `import { MisfitCandidate } from '../context/misfitDetector';`):

```ts
describe('parseMisfitResponse', () => {
  const alts = ['Finance/Receipts', 'Work (old)', 'Café'];
  const json = (o: object) => JSON.stringify(o);

  it('accepts a move to one of the alternatives, keeping its spelling', () => {
    expect(parseMisfitResponse(json({ rationale: 'r', move: true, suggestedFolder: 'finance\\receipts/', confidence: 80 }), alts))
      .toEqual({ folder: 'Finance/Receipts', confidence: 0.8, rationale: 'r' });
  });

  it('matches names with spaces, parentheses and accents', () => {
    expect(parseMisfitResponse(json({ rationale: '', move: true, suggestedFolder: 'work (OLD)', confidence: 0.6 }), alts)?.folder).toBe('Work (old)');
    expect(parseMisfitResponse(json({ rationale: '', move: true, suggestedFolder: 'café', confidence: 0.6 }), alts)?.folder).toBe('Café');
  });

  it.each([
    ['move false', { rationale: 'fits', move: false, suggestedFolder: 'Café', confidence: 0.9 }],
    ['move missing', { rationale: '', suggestedFolder: 'Café', confidence: 0.9 }],
    ['folder not offered', { rationale: '', move: true, suggestedFolder: 'Photos', confidence: 0.9 }],
  ])('drops %s', (_label, obj) => {
    expect(parseMisfitResponse(json(obj), alts)).toBeNull();
  });

  it('drops malformed output', () => {
    expect(parseMisfitResponse('not json', alts)).toBeNull();
  });
});

describe('confirmMisfits', () => {
  function candidate(name: string): MisfitCandidate {
    const p = (path: string): FolderProfile => ({ path, fileCount: 5, topExtensions: [['.jpg', 5]], sampleNames: ['IMG_1.jpg'], centroid: [1], vectorSum: [5], embeddedCount: 5 });
    return {
      file: { ...makeMeta(`/root/Photos/${name}`), relativeFolder: 'Photos', contentSnippet: 'Invoice total £40', originHost: 'amazon.co.uk' },
      current: p('Photos'),
      alternatives: [p('Finance/Receipts'), p('Documents')],
      margin: 0.3,
    };
  }

  it('turns confirmed moves into misfiled suggestions and drops the rest', async () => {
    const client = {
      chat: jest.fn(async (_m: string, prompt: string) => prompt.includes('receipt_a.pdf')
        ? JSON.stringify({ rationale: 'A receipt.', move: true, suggestedFolder: 'Finance/Receipts', confidence: 0.9 })
        : JSON.stringify({ rationale: 'Fits.', move: false, suggestedFolder: '', confidence: 0.4 })),
    } as unknown as OllamaClient;
    const progress: number[] = [];
    const result = await confirmMisfits([candidate('receipt_a.pdf'), candidate('holiday.jpg')], client, 'm', (d) => progress.push(d), { rootPath: '/root' });
    expect(result).toEqual([{
      filePath: '/root/Photos/receipt_a.pdf', clusterId: -1, suggestedDestination: 'Finance/Receipts',
      rationale: 'A receipt.', confidence: 0.9, status: 'pending', kind: 'misfiled', currentFolder: 'Photos',
    }]);
    expect(progress).toEqual([1, 2]);
  });

  it('shows the model the file evidence, the current folder and only the alternatives', async () => {
    const client = { chat: jest.fn().mockResolvedValue('{}') } as unknown as OllamaClient;
    await confirmMisfits([candidate('receipt_a.pdf')], client, 'm', () => {}, { rootPath: '/root' });
    const [, prompt, options] = (client.chat as jest.Mock).mock.calls[0];
    expect(prompt).toContain('File: Photos/receipt_a.pdf');
    expect(prompt).toContain('Invoice total £40');
    expect(prompt).toContain('Known pattern: Receipt — Finance');
    expect(prompt).toContain('Downloaded from: amazon.co.uk');
    expect(prompt).toContain('It is currently in:\n  - Photos (5 files');
    expect(prompt).toContain('exactly one of: "Finance/Receipts", "Documents"');
    expect(options.format.required).toContain('move');
  });

  it('drops a candidate when the chat call fails', async () => {
    const client = { chat: jest.fn().mockRejectedValue(new Error('down')) } as unknown as OllamaClient;
    expect(await confirmMisfits([candidate('a.pdf')], client, 'm', () => {})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/main/reasoning`
Expected: FAIL — `confirmMisfits is not a function`.

- [ ] **Step 3: Implement**

In `src/main/reasoning/llmReasoner.ts` add imports:

```ts
import { MisfitCandidate } from '../context/misfitDetector';
import { matchSignature } from '../context/signatures';
```

Add after `CHAT_OPTIONS`:

```ts
const MISFIT_SCHEMA = {
  type: 'object',
  properties: {
    rationale: { type: 'string' },
    move: { type: 'boolean' },
    suggestedFolder: { type: 'string' },
    confidence: { type: 'number' },
  },
  required: ['rationale', 'move', 'suggestedFolder', 'confidence'],
};

const MISFIT_CHAT_OPTIONS: ChatOptions = { ...CHAT_OPTIONS, format: MISFIT_SCHEMA };
const MISFIT_SNIPPET_CHARS = 300;
```

Add at the end of the file:

```ts
function normalizeFolderAnswer(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase() : '';
}

/** Result of a misfit check, or null when the file should stay where it is */
export function parseMisfitResponse(
  raw: string,
  alternatives: string[],
): { folder: string; confidence: number; rationale: string } | null {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    if (parsed.move !== true) return null;
    const wanted = normalizeFolderAnswer(parsed.suggestedFolder);
    // Only folders we offered are acceptable — misfit fixes never invent new folders
    const folder = alternatives.find((a) => a.toLowerCase() === wanted);
    if (!folder) return null;
    return {
      folder,
      confidence: clampConfidence(parsed.confidence),
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale.trim() : '',
    };
  } catch {
    return null;
  }
}

function buildMisfitPrompt(c: MisfitCandidate, rootPath?: string): string {
  const sig = matchSignature(c.file.name);
  const evidence = [
    `File: ${toDisplayPath(c.file.absolutePath, rootPath)}`,
    c.file.contentSnippet ? `Content starts: ${c.file.contentSnippet.slice(0, MISFIT_SNIPPET_CHARS).replace(/\s+/g, ' ').trim()}` : null,
    sig ? `Known pattern: ${sig.app} — ${sig.category}` : null,
    c.file.originHost ? `Downloaded from: ${c.file.originHost}` : null,
  ].filter(Boolean).join('\n');
  const options = c.alternatives.map((p) => `"${p.path}"`).join(', ');

  return `You are a file organisation assistant. The user has already organised their files into folders. This file may have been filed in the wrong folder.

${evidence}

It is currently in:
  - ${describeProfile(c.current)}

Alternative folders:
${c.alternatives.map((p) => `  - ${describeProfile(p)}`).join('\n')}

Decide whether the file clearly belongs in one of the alternative folders instead. People often file things deliberately — answer "move": true only when the evidence is clear. If you move it, suggestedFolder must be exactly one of: ${options}.

Respond with JSON: {"rationale": "One sentence explanation.", "move": false, "suggestedFolder": "", "confidence": 0.5}`;
}

/** Stage 2 of misfit detection: the LLM confirms or rejects each embedding outlier */
export async function confirmMisfits(
  candidates: MisfitCandidate[],
  client: OllamaClient,
  model: string,
  onProgress: (done: number, total: number) => void,
  options: ReasonOptions = {},
): Promise<FileSuggestion[]> {
  const results = await mapWithConcurrency(
    candidates,
    options.concurrency ?? DEFAULT_CONCURRENCY,
    async (c) => {
      try {
        const raw = await client.chat(model, buildMisfitPrompt(c, options.rootPath), MISFIT_CHAT_OPTIONS);
        return parseMisfitResponse(raw, c.alternatives.map((p) => p.path));
      } catch {
        return null;
      }
    },
    null,
    (done) => onProgress(done, candidates.length),
    options.signal,
  );

  return candidates.flatMap((c, i): FileSuggestion[] => {
    const r = results[i];
    if (!r) return [];
    return [{
      filePath: c.file.absolutePath,
      clusterId: -1,
      suggestedDestination: r.folder,
      rationale: r.rationale,
      confidence: r.confidence,
      status: 'pending',
      kind: 'misfiled',
      currentFolder: c.file.relativeFolder,
    }];
  });
}
```

`mapWithConcurrency`'s `fallback` parameter is typed `R`; with `null` passed TypeScript infers `R` as the parser's return type `… | null`, which is what we want. If inference complains, annotate the call: `mapWithConcurrency<MisfitCandidate, ReturnType<typeof parseMisfitResponse>>(…)`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx jest src/main/reasoning && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/reasoning
git commit -m "feat: LLM confirmation of misfiled-file candidates"
```

---

### Task 9: Pipeline orchestration

**Files:**
- Create: `src/main/pipeline.ts`
- Test: `src/main/pipeline.test.ts`
- Modify: `src/main/ipcHandlers.ts` (`SCAN_START` handler)

**Interfaces:**
- Consumes: `scanDirectory` (Task 2); `selectForEmbedding`, `buildFolderProfiles` (Task 3); `readOriginHost` (Task 5); `findMisfitCandidates` (Task 6); `reasonClusters` with `profiles`/`vectors` (Task 7); `confirmMisfits` (Task 8); `categorizeAtomicFolders`, `embedFiles`, `extractContent`, `clusterFiles`, `EMBED_MODEL` (existing).
- Produces:
  - `interface PipelineOptions { client: OllamaClient; chatModel: string; k?: number; signal: AbortSignal; emit: (p: ScanProgress) => void }`
  - `runPipeline(rootPath: string, opts: PipelineOptions): Promise<FileSuggestion[] | null>` — `null` when cancelled.

- [ ] **Step 1: Write the failing tests**

`src/main/pipeline.test.ts` (runs against real temp directories with a fake Ollama client; `ml-kmeans` is already mocked globally by `tests/setup.ts`):

```ts
import os from 'os';
import path from 'path';
import fsp from 'fs/promises';
import { OllamaClient } from './ollama/ollamaClient';
import { runPipeline } from './pipeline';
import { ScanProgress } from '@shared/types';

let root: string;

async function write(rel: string, content = 'x'): Promise<void> {
  const full = path.join(root, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, content);
}

// Deterministic "embeddings": finance-ish text → x axis, photos → y axis, everything else → z axis
function fakeClient(): OllamaClient {
  const embed = (text: string) => (/invoice|statement/i.test(text) ? [1, 0, 0] : /IMG_/.test(text) ? [0, 1, 0] : [0, 0, 1]);
  return {
    embedBatch: jest.fn(async (_m: string, texts: string[]) => texts.map(embed)),
    chat: jest.fn(async (_m: string, prompt: string) => {
      if (prompt.includes('may have been filed in the wrong folder')) {
        return JSON.stringify({ rationale: 'It is an invoice.', move: true, suggestedFolder: 'Finance', confidence: 0.9 });
      }
      if (prompt.includes('entire folder')) {
        return JSON.stringify({ rationale: 'An app.', suggestedFolder: 'Software', confidence: 0.8 });
      }
      return JSON.stringify({ rationale: 'Loose files.', suggestedFolder: 'Finance', confidence: 0.7 });
    }),
  } as unknown as OllamaClient;
}

function run(opts: Partial<{ signal: AbortSignal; client: OllamaClient }> = {}) {
  const phases: string[] = [];
  const emit = (p: ScanProgress) => { if (phases[phases.length - 1] !== p.phase) phases.push(p.phase); };
  const promise = runPipeline(root, {
    client: opts.client ?? fakeClient(), chatModel: 'm', signal: opts.signal ?? new AbortController().signal, emit,
  });
  return { promise, phases };
}

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aifs-pipe-'));
});
afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

describe('runPipeline', () => {
  it('produces folder, loose and misfiled suggestions', async () => {
    for (let i = 1; i <= 4; i++) await write(`Finance/statement_${i}.txt`, 'Bank statement for account');
    for (let i = 1; i <= 4; i++) await write(`Photos/IMG_000${i}.jpg`);
    await write('Photos/invoice_march.txt', 'Invoice total due');
    await write('statement_may.txt', 'Bank statement May');
    await write('Tool/tool.exe');
    await write('Tool/lib.dll');

    const { promise, phases } = run();
    const suggestions = (await promise)!;

    expect(suggestions.filter((s) => s.kind === 'folder').map((s) => path.basename(s.filePath))).toEqual(['Tool']);
    expect(suggestions.filter((s) => s.kind === 'loose').map((s) => path.basename(s.filePath))).toEqual(['statement_may.txt']);
    const misfiled = suggestions.filter((s) => s.kind === 'misfiled');
    expect(misfiled).toHaveLength(1);
    expect(misfiled[0]).toMatchObject({ suggestedDestination: 'Finance', currentFolder: 'Photos' });
    expect(path.basename(misfiled[0].filePath)).toBe('invoice_march.txt');
    expect(phases).toEqual(['scanning', 'extracting', 'embedding', 'profiling', 'clustering', 'reasoning']);
  });

  it('handles a root with only organised folders (no loose files)', async () => {
    for (let i = 1; i <= 4; i++) await write(`Finance/statement_${i}.txt`, 'Bank statement');
    const { promise } = run();
    expect(await promise).toEqual([]);
  });

  it('handles an empty root', async () => {
    const client = fakeClient();
    const { promise } = run({ client });
    expect(await promise).toEqual([]);
    expect(client.chat).not.toHaveBeenCalled();
  });

  it('returns null when cancelled', async () => {
    await write('a.txt');
    const controller = new AbortController();
    controller.abort();
    const { promise } = run({ signal: controller.signal });
    expect(await promise).toBeNull();
  });

  it('reports reasoning progress across loose, folder and misfit calls in one counter', async () => {
    for (let i = 1; i <= 4; i++) await write(`Finance/statement_${i}.txt`, 'Bank statement');
    for (let i = 1; i <= 4; i++) await write(`Photos/IMG_000${i}.jpg`);
    await write('Photos/invoice.txt', 'Invoice');
    await write('loose.txt');
    await write('Tool/tool.exe');
    await write('Tool/lib.dll');
    const reasoning: ScanProgress[] = [];
    await runPipeline(root, {
      client: fakeClient(), chatModel: 'm', signal: new AbortController().signal,
      emit: (p) => { if (p.phase === 'reasoning') reasoning.push(p); },
    });
    const last = reasoning[reasoning.length - 1];
    expect(last.total).toBe(3); // 1 loose cluster + 1 atomic folder + 1 misfit candidate
    expect(last.current).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/main/pipeline`
Expected: FAIL — `Cannot find module './pipeline'`.

- [ ] **Step 3: Implement**

`src/main/pipeline.ts`:

```ts
import { EMBED_MODEL, FileMeta, FileSuggestion, ScanProgress } from '@shared/types';
import { OllamaClient } from './ollama/ollamaClient';
import { scanDirectory } from './scanner/fileScanner';
import { extractContent } from './extractor/contentExtractor';
import { embedFiles } from './embedding/embeddingEngine';
import { clusterFiles } from './clustering/clusteringEngine';
import { categorizeAtomicFolders, confirmMisfits, reasonClusters } from './reasoning/llmReasoner';
import { buildFolderProfiles, selectForEmbedding } from './context/folderProfiles';
import { readOriginHost } from './context/fileOrigin';
import { findMisfitCandidates } from './context/misfitDetector';

const EMBED_BATCH_SIZE = 32;

export interface PipelineOptions {
  client: OllamaClient;
  chatModel: string;
  /** Number of loose-file clusters; estimated from the file count when omitted */
  k?: number;
  signal: AbortSignal;
  emit: (progress: ScanProgress) => void;
}

/** Runs scan → extract → embed → profile → cluster → reason. Returns null if cancelled. */
export async function runPipeline(rootPath: string, opts: PipelineOptions): Promise<FileSuggestion[] | null> {
  const { client, chatModel, k, signal, emit } = opts;

  emit({ phase: 'scanning', current: 0, total: 0 });
  const { files: scanned, atomicFolders } = await scanDirectory(rootPath, (count) => {
    emit({ phase: 'scanning', current: count, total: count });
  });
  if (signal.aborted) return null;

  // All loose files, plus a bounded sample of each organised folder for profiling and misfit checks
  const files = selectForEmbedding(scanned);
  for (let i = 0; i < files.length; i++) {
    if (signal.aborted) return null;
    files[i].contentSnippet = await extractContent(files[i]);
    files[i].originHost = await readOriginHost(files[i].absolutePath);
    emit({ phase: 'extracting', current: i + 1, total: files.length });
  }

  emit({ phase: 'embedding', current: 0, total: 100 });
  const fileVectors = await embedFiles(files, client, EMBED_MODEL, EMBED_BATCH_SIZE, (pct) => {
    emit({ phase: 'embedding', current: pct, total: 100 });
  }, signal);
  if (signal.aborted) return null;
  const vectors = new Map(fileVectors.map((v) => [v.filePath, v.vector]));

  emit({ phase: 'profiling', current: 0, total: 1 });
  const profiles = buildFolderProfiles(scanned, vectors);
  const candidates = findMisfitCandidates(files, vectors, profiles);
  const existingFolders = profiles.map((p) => p.path);
  emit({ phase: 'profiling', current: 1, total: 1 });

  emit({ phase: 'clustering', current: 0, total: 1 });
  const fileMap = new Map<string, FileMeta>(files.map((f) => [f.absolutePath, f]));
  const looseVectors = fileVectors.filter((v) => fileMap.get(v.filePath)?.relativeFolder === '');
  const assignments = clusterFiles(looseVectors, k);
  const clusterCount = new Set(assignments.map((a) => a.clusterId)).size;

  // One progress counter across the three kinds of LLM calls
  const total = clusterCount + atomicFolders.length + candidates.length;
  let offset = 0;
  const report = (done: number): void => emit({ phase: 'reasoning', current: offset + done, total });
  emit({ phase: 'reasoning', current: 0, total });

  const reasonOptions = { rootPath, signal };
  const loose = await reasonClusters(assignments, fileMap, existingFolders, client, chatModel, report, {
    ...reasonOptions, profiles, vectors,
  });
  if (signal.aborted) return null;
  offset += clusterCount;

  const folders = await categorizeAtomicFolders(atomicFolders, existingFolders, client, chatModel, report, reasonOptions);
  if (signal.aborted) return null;
  offset += atomicFolders.length;

  const misfiled = await confirmMisfits(candidates, client, chatModel, report, reasonOptions);
  if (signal.aborted) return null;

  return [...folders, ...loose, ...misfiled];
}
```

In `src/main/ipcHandlers.ts`, replace the whole `SCAN_START` handler body with:

```ts
  ipcMain.handle(IpcChannels.SCAN_START, async (_, { rootPath, chatModel, k }: { rootPath: string; chatModel: string; k?: number }) => {
    scanAbortController = new AbortController();
    const suggestions = await runPipeline(rootPath, {
      client: ollamaClient,
      chatModel,
      k,
      signal: scanAbortController.signal,
      emit: (progress) => win.webContents.send(IpcChannels.SCAN_PROGRESS, progress),
    });
    if (!suggestions) return;

    currentSuggestions = suggestions;
    win.webContents.send(IpcChannels.SCAN_PROGRESS, { phase: 'done', current: suggestions.length, total: suggestions.length });
    win.webContents.send(IpcChannels.SUGGESTIONS_UPDATE, suggestions);
  });
```

Add `import { runPipeline } from './pipeline';` and remove the imports that are now unused in `ipcHandlers.ts`: `fsp`, `scanDirectory`, `extractContent`, `embedFiles`, `clusterFiles`, `reasonClusters`, `categorizeAtomicFolders`, and `FileMeta` (keep `FileSuggestion`, `EMBED_MODEL`, `OllamaHealth`, `PullProgress`).

- [ ] **Step 4: Run tests, typecheck and build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all PASS; `Build complete.`

- [ ] **Step 5: Commit**

```bash
git add src/main/pipeline.ts src/main/pipeline.test.ts src/main/ipcHandlers.ts
git commit -m "feat: context-aware scan pipeline with folder profiles and misfit checks"
```

---

### Task 10: "Possibly misfiled" section in the review screen

**Files:**
- Modify: `src/renderer/views/ReviewView.tsx`

**Interfaces:**
- Consumes: `FileSuggestion.kind`, `FileSuggestion.currentFolder` (Task 1).

There are no renderer unit tests in this project (Jest runs in a Node environment with no React testing library), so this task is verified by typecheck, build and a manual run.

- [ ] **Step 1: Implement**

In `src/renderer/views/ReviewView.tsx`:

Add this component above `export default function ReviewView`:

```tsx
function DecisionButtons({ status, onChange }: { status: FileSuggestion['status']; onChange: (s: FileSuggestion['status']) => void }): React.JSX.Element {
  const style = (active: boolean, color: string): React.CSSProperties => ({
    padding: '4px 12px', borderRadius: 4, border: 'none', cursor: 'pointer',
    background: active ? color : '#e5e7eb', color: active ? '#fff' : '#374151',
  });
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <button onClick={() => onChange('approved')} style={style(status === 'approved', '#6366f1')}>Approve</button>
      <button onClick={() => onChange('rejected')} style={style(status === 'rejected', '#ef4444')}>Reject</button>
    </div>
  );
}

const sectionHeading: React.CSSProperties = {
  margin: '0 0 12px', color: '#374151', fontSize: 14, textTransform: 'uppercase', letterSpacing: 1,
};
```

After the `fileGroups` loop add:

```ts
  const misfiled = suggestions.filter((s) => s.kind === 'misfiled');
```

In the atomic folders block, replace the `<h3 style={{ margin: '0 0 12px', … }}>` opening tag with `<h3 style={sectionHeading}>`, and replace its inner `<div style={{ display: 'flex', gap: 6 }}> … </div>` (the two buttons) with:

```tsx
              <DecisionButtons status={s.status} onChange={(status) => setStatus(s.filePath, status)} />
```

After the `{Array.from(fileGroups.entries()).map(...)}` block, before the closing `</div>` of the view, add:

```tsx
      {misfiled.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <h3 style={sectionHeading}>Possibly misfiled</h3>
          <p style={{ margin: '0 0 12px', color: '#6b7280', fontSize: 13 }}>
            These files are already in a folder but look like they belong elsewhere. Review each one — nothing moves unless you approve it.
          </p>
          {misfiled.map((s) => (
            <div key={s.filePath} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', marginBottom: 8, border: '1px solid #fde68a', borderRadius: 8, background: '#fffbeb' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.filePath.split(/[\\/]/).pop()}
                </div>
                <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
                  {s.currentFolder} → <strong>{s.suggestedDestination}</strong> &nbsp;·&nbsp; {Math.round(s.confidence * 100)}% &nbsp;·&nbsp; {s.rationale}
                </div>
              </div>
              <DecisionButtons status={s.status} onChange={(status) => setStatus(s.filePath, status)} />
            </div>
          ))}
        </div>
      )}
```

- [ ] **Step 2: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: no errors; `Build complete.`

- [ ] **Step 3: Manual check**

Create a test folder, e.g. `C:\Temp\aifs-demo`, containing `Finance\` with 4+ bank-statement PDFs or text files, `Photos\` with 4+ `IMG_*.jpg` files plus one `invoice_*.pdf`, and a couple of loose statements at the top. Run `npx electron .`, pick the folder and analyse.
Expected: the review screen shows the loose files grouped under a destination, and a **Possibly misfiled** section with the invoice (`Photos → Finance…`). Approving it and pressing **Move** moves only that file; **Undo** puts it back.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/views/ReviewView.tsx
git commit -m "feat: review section for possibly misfiled files"
```

---

### Task 11: Live integration test and margin check

**Files:**
- Rewrite: `tests/integration/pipeline.integration.test.ts`

**Interfaces:**
- Consumes: `runPipeline` (Task 9), `OllamaClient`.

- [ ] **Step 1: Write the integration test**

Replace `tests/integration/pipeline.integration.test.ts` with:

```ts
import os from 'os';
import path from 'path';
import fsp from 'fs/promises';
import { OllamaClient } from '../../src/main/ollama/ollamaClient';
import { runPipeline } from '../../src/main/pipeline';

// Uses whatever chat model is installed for tests; override with AIFS_TEST_MODEL
const CHAT_MODEL = process.env.AIFS_TEST_MODEL ?? 'llama3.2:3b';
const client = new OllamaClient();
let skipAll = false;
let root: string;

jest.setTimeout(300_000);

async function write(rel: string, content: string): Promise<void> {
  const full = path.join(root, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, content);
}

beforeAll(async () => {
  const healthy = await client.checkHealth();
  const hasModel = healthy && await client.checkModelAvailable(CHAT_MODEL);
  if (!hasModel) {
    console.warn(`Ollama or ${CHAT_MODEL} unavailable — skipping integration tests`);
    skipAll = true;
  }
});

beforeEach(async () => {
  if (skipAll) return;
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aifs-int-'));
  const months = ['January', 'February', 'March', 'April', 'May'];
  for (const m of months) {
    await write(`Finance/Statement_${m}_2026.txt`, `HSBC current account statement for ${m} 2026. Opening balance £1,240. Closing balance £980. Direct debits, card payments, salary credit.`);
  }
  for (let i = 1; i <= 5; i++) await write(`Photos/IMG_20260${i}01_120000.jpg`, '');
  await write('Photos/Invoice_0042.txt', 'INVOICE #0042. Bill to: Sam. Web design services, 10 hours at £50. Total due: £500. Payment within 30 days.');
  await write('Statement_June_2026.txt', 'HSBC current account statement for June 2026. Opening balance £980. Closing balance £1,105.');
});

afterEach(async () => {
  if (root) await fsp.rm(root, { recursive: true, force: true });
});

describe('Context-aware pipeline (live Ollama)', () => {
  it('files loose statements with the existing Finance folder and flags the invoice in Photos', async () => {
    if (skipAll) return;
    const suggestions = (await runPipeline(root, {
      client, chatModel: CHAT_MODEL, signal: new AbortController().signal, emit: () => {},
    }))!;

    const loose = suggestions.find((s) => s.kind === 'loose' && s.filePath.endsWith('Statement_June_2026.txt'));
    expect(loose?.suggestedDestination.toLowerCase()).toMatch(/^finance/);

    const misfiled = suggestions.filter((s) => s.kind === 'misfiled');
    expect(misfiled.map((s) => path.basename(s.filePath))).toContain('Invoice_0042.txt');
    expect(misfiled.every((s) => s.currentFolder === 'Photos' || s.currentFolder === 'Finance')).toBe(true);
  });
});
```

- [ ] **Step 2: Run against live Ollama**

Run: `npx jest tests/integration`
Expected: PASS (or the skip warning if Ollama/model is missing — in that case install with `ollama pull llama3.2:3b` and re-run; a skip does **not** count as done).

- [ ] **Step 3: If the invoice is not flagged, measure the real margins**

Create a throwaway script in your scratch directory (not in the repo), e.g. `margins.test.ts` copied into `tests/integration/` temporarily:

```ts
import os from 'os';
import path from 'path';
import fsp from 'fs/promises';
import { OllamaClient } from '../../src/main/ollama/ollamaClient';
import { scanDirectory } from '../../src/main/scanner/fileScanner';
import { extractContent } from '../../src/main/extractor/contentExtractor';
import { embedFiles } from '../../src/main/embedding/embeddingEngine';
import { buildFolderProfiles, selectForEmbedding } from '../../src/main/context/folderProfiles';
import { findMisfitCandidates } from '../../src/main/context/misfitDetector';

it('prints misfit margins', async () => {
  const root = process.env.AIFS_DIR!; // a folder like the fixture above, or a real organised folder
  const { files: scanned } = await scanDirectory(root, () => {});
  const files = selectForEmbedding(scanned);
  for (const f of files) f.contentSnippet = await extractContent(f);
  const vecs = await embedFiles(files, new OllamaClient(), 'nomic-embed-text', 32, () => {}, new AbortController().signal);
  const vectors = new Map(vecs.map((v) => [v.filePath, v.vector]));
  const profiles = buildFolderProfiles(scanned, vectors);
  const all = findMisfitCandidates(files, vectors, profiles, { margin: -1, maxCandidates: 1000 });
  console.table(all.slice(0, 30).map((c) => ({ file: c.file.name, in: c.current.path, best: c.alternatives[0].path, margin: c.margin.toFixed(3) })));
}, 300_000);
```

Run with `AIFS_DIR=<folder> npx jest tests/integration/margins`. Pick `MISFIT_MARGIN` in `src/main/context/misfitDetector.ts` so that genuinely misfiled files sit above it and correctly filed ones below (expect a value between 0.05 and 0.15). Update the spec's "initial `0.10`" line if the value changes. **Delete the throwaway script** before committing.

- [ ] **Step 4: Full verification**

Run: `npm test && npm run typecheck && npm run build`
Expected: all PASS; `Build complete.`

- [ ] **Step 5: Commit**

```bash
git add tests/integration/pipeline.integration.test.ts src/main/context/misfitDetector.ts docs/superpowers/specs/2026-10-08-context-aware-sorting-design.md
git commit -m "test: live integration test for context-aware sorting"
```

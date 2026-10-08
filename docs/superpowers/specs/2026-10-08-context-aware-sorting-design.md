# Context-Aware Sorting — Design Spec

**Date:** 2026-10-08
**Status:** Draft — awaiting review

---

## Goal

Give the LLM evidence to reason from instead of folder names alone, so suggestions follow how the user already organises files:

1. **The user's existing organisation** — which folders exist and what kind of files live in each.
2. **General knowledge** — common app names and app-specific file naming conventions.
3. **Source signals** — where a file came from (download origin, current location).

Additionally, detect files already inside organised folders that look misfiled.

## Decisions

| Question | Decision |
|---|---|
| Where does the existing organisation live? | Inside the scanned root (subfolders of the folder being sorted). |
| What happens to files already in subfolders? | Subfolders are the reference and destinations. Loose top-level files are sorted; filed files are checked for misfiling and surfaced as separate suggestions. |
| Can the user extend the app knowledge? | No — built-in signature list only for now. |
| How does context reach the model? | Retrieval per cluster/file (top-N relevant folders), not the whole tree — the chat context is 4096 tokens and small models degrade with long prompts. |

### Out of scope

User-editable rules, learning from approve/reject history, persisting profiles between scans.

---

## Pipeline

```
scan ──► extract (+ download origin) ──► embed ALL files ──► build folder profiles
                                                              │
                     ┌────────────────────────────────────────┴───────────────┐
                     ▼                                                        ▼
       loose files → cluster → retrieve top-5             filed files → misfit check
       similar folders → LLM (with profiles,              (embedding outlier) → LLM
       app signatures, origins)                           confirms → "misfiled"
                     └──────────────────────┬─────────────────────────────────┘
                                            ▼
                         suggestions: loose │ misfiled │ folder (app/game)
```

Progress phases: `scanning → extracting → embedding → profiling → reasoning → done`. `reasoning` counts loose clusters, atomic folders, and misfit candidates in one total.

---

## 1. Scanning changes (`src/main/scanner/fileScanner.ts`)

### Atomic folder rule

A directory is **atomic** (moved as one unit, never descended into) if any of:

- **Installed app/game:** within 2 levels, some single directory contains an executable (`.exe`) **alongside** application support files (`.dll .pak .asar .so .dylib`). Installers on their own (`setup.exe`, `.msi`) do not count — a folder like `Software/Installers` full of setup files is ordinary organisation.
- **macOS bundle:** the directory name ends in `.app`.
- **Code project:** contains `.git`, `package.json`, or `*.sln` at its top level.

The previous triggers — 30+ files, having any subdirectory, or any executable — are removed: they would make organised folders atomic.

The check runs at every depth during the walk, so nested projects are never destructured. Only **top-level** atomic folders produce `kind: 'folder'` suggestions; nested atomic folders are skipped silently (they sit inside the user's organisation).

### File location tagging

Each `FileMeta` gains `relativeFolder`: the folder path relative to the scan root using `/` separators — `''` for loose files at the root, e.g. `'Finance/Bank'` for filed ones.

### Profiling cap

Every loose file is embedded. Filed files are embedded up to **200 per folder** (deterministic even sample by sorted path) to bound embedding time on large trees. Only embedded files take part in profiles and the misfit check.

---

## 2. Context modules (`src/main/context/`)

Each module is pure (no Electron, no Ollama) and unit-tested in isolation.

### 2.1 `folderProfiles.ts`

```ts
interface FolderProfile {
  path: string;              // relative, '/'-separated, e.g. 'Finance/Bank'
  fileCount: number;         // direct + descendant files actually scanned
  topExtensions: Array<[string, number]>; // top 4
  sampleNames: string[];     // up to 5
  centroid: number[];        // mean of member unit vectors, re-normalised
}

buildFolderProfiles(files: FileMeta[], vectors: Map<string, number[]>, maxDepth = 3): FolderProfile[]
topFolders(profiles: FolderProfile[], vector: number[], n: number, exclude?: (p: FolderProfile) => boolean): Array<{ profile: FolderProfile; similarity: number }>
describeProfile(p: FolderProfile): string   // one prompt line
```

- Profiles exist for folders at depth 1–3. A folder's profile aggregates its own files **and all descendants**, so parents like `Media` (only subfolders) are profiled and the model can choose between a broad parent and a specific child.
- Similarity is cosine on unit vectors (dot product), consistent with clustering.
- `describeProfile` output: `Finance/Bank (42 files: .pdf ×38, .csv ×4) e.g. "Statement_2026-03.pdf", "HSBC_export.csv"`.

### 2.2 `signatures.ts`

```ts
interface Signature { pattern: RegExp; app: string; category: string; folderHint?: string }
matchSignature(fileName: string): Signature | null
summarizeSignatures(fileNames: string[]): string[]  // e.g. ['"Statement_*" → bank statement (8 files)']
```

~60 built-in entries, first match wins, case-insensitive. Coverage: phone cameras (`IMG_\d+`, `PXL_`, `DSC_`, `DCIM`), screenshots (`Screenshot 20\d\d-`, `Snip`), messengers (`WhatsApp (Image|Video)`, Telegram, Discord `unknown.png`), recordings (OBS `\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.(mkv|mp4)`, `zoom_\d+\.mp4`), installers (`setup.*\.exe`, `_x64\.msi`), game launchers (Steam, Epic, GOG), office exports (`Invoice`, `Statement`, `Receipt`, `Payslip`), dev artifacts (`.vsix`, `.whl`, `.iso`, `.jar`).

`folderHint` is advisory; the prompt states that existing folders take priority.

### 2.3 `fileOrigin.ts`

```ts
readOriginHost(absolutePath: string): Promise<string | undefined>
parseZoneIdentifier(content: string): string | undefined   // pure, tested
```

On Windows, reads the `<path>:Zone.Identifier` NTFS stream and returns the hostname from `HostUrl` (falling back to `ReferrerUrl`), lower-cased, `www.` stripped. Returns `undefined` on other platforms, a missing stream, an unparseable URL, or `about:internet`. Called in the extract phase; result stored in `FileMeta.originHost`.

---

## 3. Loose-file reasoning (`llmReasoner.ts`)

For each loose cluster, the prompt gains (in this order, before the file list):

```
Most similar existing folders:
  - <describeProfile> ×5  (topFolders by cluster centroid)
All existing folders: Finance, Finance/Bank, Media/Photos, …   (capped at 60, depth ≤ 3)
Known patterns in this group: "Statement_*" → bank statement (8 files)
Downloaded from: hsbc.co.uk (6), mail.google.com (2)
```

Sections with no content are omitted. Added rule: *"Prefer the most similar existing folder unless the evidence clearly points elsewhere."* The previous top-level-only `existingFolders` list is replaced by the depth-≤3 list; `sanitizeFolder` case-matching uses it too.

Cluster centroid = re-normalised mean of member vectors (passed in from the pipeline).

Budget: the context sections must stay under ~1,200 tokens; profile lines and the folder list are truncated to guarantee it (unit-tested by character count, ~4 chars/token).

---

## 4. Misfit detection (`src/main/context/misfitDetector.ts` + `llmReasoner.ts`)

### Stage 1 — candidates (no LLM)

For each embedded filed file `f`, let `F` be its folder truncated to depth 3 (the deepest profiled folder containing it):

- `ownSim` = similarity of `f` to `F`'s centroid **recomputed without `f`**.
- `best` = top folder by similarity, excluding `F` and any ancestor/descendant of `F`.
- Candidate if `best.similarity − ownSim ≥ MARGIN` (initial `0.10`, tuned on real data during implementation) **and** `F` has ≥ 4 embedded files.

Candidates are sorted by margin descending and capped at **40 per scan**.

```ts
findMisfitCandidates(files, vectors, profiles, opts?): Array<{ file: FileMeta; current: FolderProfile; alternatives: FolderProfile[] /* top 2 */; margin: number }>
```

### Stage 2 — LLM confirmation

Prompt contains the file (relative path, content snippet, signature match, origin host), the current folder's profile, and the 2 alternatives. Schema:

```json
{ "rationale": "string", "move": "boolean", "suggestedFolder": "string", "confidence": "number" }
```

- Only `move: true` produces a suggestion.
- `suggestedFolder` must equal one of the two alternatives (case-insensitive) — otherwise the result is dropped. No new folders are invented for misfiled files.
- Uses the same concurrency, temperature, and abort handling as loose reasoning.
- LLM error or malformed output → **drop** (file stays put), unlike loose files which fall back to `Unsorted`.

Misfiled suggestions execute through the existing executor path (same overwrite guard and undo).

---

## 5. Data model (`src/shared/types.ts`)

```ts
interface FileMeta {
  // …existing
  relativeFolder: string;     // '' = loose
  originHost?: string;
}

interface FileSuggestion {
  // …existing, minus isAtomicFolder
  kind: 'loose' | 'misfiled' | 'folder';
  currentFolder?: string;     // set for 'misfiled'
}
```

`isAtomicFolder` is removed; `fileExecutor.ts` and `ReviewView.tsx` switch to `kind === 'folder'`. `FolderProfile` stays main-process-only (in `src/main/context`).

---

## 6. Review UI (`ReviewView.tsx`)

Three sections, in order:

1. **Folders** — atomic app/game folders (unchanged behaviour).
2. **Loose files** — grouped by destination with per-group "Approve all" (unchanged).
3. **Possibly misfiled** — one row per file: `Photos → Finance/Receipts`, rationale, confidence, individual Approve/Reject. **No bulk approve** — these move files the user filed deliberately.

All suggestions start `pending` as today. The section is hidden when empty.

---

## 7. Error handling summary

| Situation | Behaviour |
|---|---|
| No Zone.Identifier / non-Windows / bad URL | `originHost` undefined; line omitted from prompt |
| No subfolders (flat Downloads) | No profiles; prompt sections omitted; misfit detection skipped — behaves as today |
| Folder with < 4 embedded files | Profiled, but its files are never misfit candidates |
| Misfit LLM failure / invalid folder | Suggestion dropped |
| Scan cancelled | Checked between phases and before each LLM request, including profiling and misfit stages |

---

## 8. Testing

**Unit (Jest):**
- `folderProfiles`: centroid maths, ancestor aggregation, depth cap, `topFolders` ranking + exclude, `describeProfile` format.
- `signatures`: table of real-world filenames → expected app/category; no-match cases.
- `fileOrigin.parseZoneIdentifier`: HostUrl, ReferrerUrl fallback, `about:internet`, garbage.
- `misfitDetector`: leave-one-out centroid, margin threshold, min folder size, ancestor/descendant exclusion, cap and ordering.
- `llmReasoner`: context sections present/omitted, budget truncation, misfit schema handling (`move: false`, folder not in alternatives, malformed → dropped).
- `fileScanner`: new atomic rule (executable, `.git`, `package.json`, nested project), `relativeFolder` tagging, 200-per-folder sampling.

**Integration (live Ollama, skipped if unavailable):** fixture with `Finance/` (bank statements), `Photos/` (images + one planted invoice PDF), and loose statements at the root. Expect loose statements → `Finance` (or a child) and the planted invoice flagged `misfiled`.

# AiFileSort — Design Spec

**Date:** 2026-10-06

---

## Overview

AiFileSort is a fully on-device Electron + TypeScript desktop application that recursively scans a directory, uses local AI (Ollama) to semantically analyse file content and metadata, and presents grouping suggestions to the user. The user reviews suggestions, approves or rejects them individually or by cluster, and the app executes the approved moves. No data leaves the device.

---

## Tech Stack

| Layer | Choice |
|---|---|
| UI shell | Electron |
| UI framework | React + TypeScript |
| AI engine | Ollama (local) |
| Embedding model | `nomic-embed-text` |
| Chat model | `llama3.2:3b` (default, user-configurable) |
| Clustering | k-means via `ml-kmeans` |
| PDF extraction | `pdf-parse` |
| DOCX extraction | `mammoth` |
| XLSX extraction | `xlsx` |
| Testing | Jest + ts-jest, Playwright |

---

## Architecture

Standard Electron two-process architecture:

- **Main process (Node.js):** owns all filesystem access, Ollama API calls, clustering, and file execution. Streams progress events to the renderer over IPC.
- **Renderer process (React):** UI only. Sends commands (start scan, approve, execute, undo) and receives progress/results via IPC.

### Pipeline

```
User picks folder
       ↓
[Main] File Scanner        → stream progress → [UI] live file count
       ↓
[Main] Content Extractor   → text snippets from supported formats
       ↓
[Main] Embedding Engine    → batch calls to Ollama nomic-embed-text
       ↓ (stream progress %)
[Main] Clustering Engine   → k-means on all vectors → cluster assignments
       ↓
[Main] LLM Reasoner        → one chat call per cluster → folder suggestions
       ↓
[Main] Suggestion Store    → IPC push to renderer
       ↓
[UI]   Review screen       → user approves/rejects per file or per cluster
       ↓
[UI]   Execute             → IPC call to Main
       ↓
[Main] File Executor       → move files, write undo manifest
       ↓
[UI]   Completion summary  → undo button available
```

---

## Components

### File Scanner
- Recursively walks the target directory using Node's `fs` API
- Collects per file: absolute path, name, extension, size, creation date, modified date, MIME type
- Skips hidden files and system directories: `.git`, `node_modules`, `$RECYCLE.BIN`, `System Volume Information`, etc.
- Emits progress events (file count) as it traverses

### Content Extractor
Reads a text snippet (up to ~500 chars) from supported formats:

| Category | Formats | Method |
|---|---|---|
| Plain text | `.txt`, `.md`, `.csv`, `.json`, `.xml`, code files | Read directly |
| Documents | `.pdf` | `pdf-parse` |
| Documents | `.docx` | `mammoth` |
| Documents | `.xlsx` | `xlsx` |
| Media / unsupported | images, video, audio, etc. | Metadata only |

Falls back to metadata-only if extraction fails for any file.

### Embedding Engine
- Builds a description string per file: `"filename: X | type: Y | date: Z | content: ..."`
- Calls Ollama `/api/embeddings` with `nomic-embed-text`
- Processes in configurable batches (default: 20 concurrent)
- Retries failed calls once before falling back to metadata-only
- Streams progress percentage to UI

### Clustering Engine
- Runs k-means on all embedding vectors using `ml-kmeans`
- Auto-estimates k as `√n` (file count), capped at 50 clusters
- k is user-adjustable via a slider in the UI before/after analysis
- Returns cluster assignments keyed by file path

### LLM Reasoner
- One Ollama chat call per cluster
- Prompt includes: file list for the cluster + existing top-level folder names in the target directory
- LLM returns per cluster: suggested folder path (existing or new), confidence score, short rationale
- Typically 10–50 total calls — fast at this scale

### Suggestion Store
In-memory state per file:
```typescript
interface FileSuggestion {
  filePath: string;
  suggestedDestination: string;
  rationale: string;
  confidence: number;       // 0–1
  status: 'pending' | 'approved' | 'rejected';
}
```

### File Executor
- Moves approved files using `fs.rename` (same drive) or copy + delete (cross-drive)
- Creates destination folders if they don't exist
- Writes an undo manifest (JSON log of every move: from → to) before executing
- Skips and logs files that fail (e.g. locked); does not roll back already-completed moves
- Undo reads the manifest and reverses all completed moves

### UI — Four Views

1. **Home** — folder picker, Ollama model configuration, start button
2. **Scanning** — live progress bar, file count, current phase (scanning / extracting / embedding / clustering / reasoning)
3. **Review** — grouped suggestion list; approve/reject per file or per entire cluster; rationale visible on expand; confidence indicator
4. **Executing** — move progress, completion summary listing any skipped files, undo button

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Ollama not running | Health check at startup against `localhost:11434`; UI shows setup guide |
| Model not pulled | Detected before pipeline starts; UI shows `ollama pull <model>` command |
| File permission error | File skipped, flagged with warning icon in UI |
| Content extraction failure | File falls back to metadata-only analysis |
| Embedding call failure | Retry once, then metadata-only |
| File move failure | Logged, skipped, reported in completion summary |
| User cancels mid-scan | Pipeline stops; partial results shown if clustering is complete |

---

## Testing Strategy

### Unit Tests (Jest + ts-jest)
- **File Scanner:** mock `fs`, verify recursive traversal, hidden file exclusion, correct metadata shape
- **Content Extractor:** fixture files for each format, verify correct text extraction and graceful fallback
- **Clustering Engine:** known vectors with expected cluster assignments; auto-k estimation
- **LLM Reasoner:** mock Ollama responses, verify prompt construction and response parsing
- **File Executor:** mock `fs.rename`/`fs.cp`, verify undo manifest correctness, cross-drive detection

### Integration Tests
- **Embedding Engine:** real Ollama instance (skipped in CI if unavailable); verify vector shape
- **End-to-end pipeline:** temp directory with known files → full pipeline → verify suggestions reference real paths

### UI Tests (Playwright)
- Folder picker → scan starts
- Approve individual file, approve entire cluster, reject
- Execute flow: files move, undo restores
- Error states: Ollama not running, unreadable file

### Manual Test Checklist
- [ ] Scan ~50 files, verify suggestions are semantically sensible
- [ ] Scan ~5,000 files, verify acceptable performance
- [ ] Test undo after partial execution
- [ ] Test with mixed media, documents, and code files
- [ ] Test Ollama-not-running error state

import path from 'path';
import { ClusterAssignment, FileMeta, FileSuggestion, AtomicFolder } from '@shared/types';
import { OllamaClient, ChatOptions } from '../ollama/ollamaClient';
import { evenSample } from '../context/sampling';
import { FolderProfile, describeProfile, topFolders } from '../context/folderProfiles';
import { meanDirection } from '../context/vectorMath';
import { summarizeSignatures } from '../context/signatures';
import { summarizeOrigins } from '../context/fileOrigin';

interface LlmClusterResult {
  suggestedFolder: string;
  confidence: number;
  rationale: string;
}

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

const FALLBACK: LlmClusterResult = { suggestedFolder: 'Unsorted', confidence: 0, rationale: '' };

// Enough to show the pattern of a cluster without overflowing the context window
const MAX_PATHS_IN_PROMPT = 30;
const DEFAULT_CONCURRENCY = 3;
const MAX_FOLDER_DEPTH = 3;

// Rationale comes first so the model explains itself before committing to a folder
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    rationale: { type: 'string' },
    suggestedFolder: { type: 'string' },
    confidence: { type: 'number' },
  },
  required: ['rationale', 'suggestedFolder', 'confidence'],
};

const CHAT_OPTIONS: ChatOptions = { format: RESPONSE_SCHEMA, temperature: 0.2, numCtx: 4096 };

const CATEGORY_HINTS = `
Common category patterns (use these as guidance):
- Games: Steam, Epic, GOG, Ubisoft, EA, game installers, .pak files, game data folders
- Software/Apps: setup wizards, .exe/.msi installers, application packages
- Development: IDEs, SDKs, source code, node_modules, repositories, compilers
- Documents: PDFs, Word/Excel/PowerPoint files, text files, spreadsheets
- Media/Photos: images (.jpg, .png, .raw), screenshots, wallpapers
- Video: .mp4, .mkv, .avi, .mov files, recorded content
- Music/Audio: .mp3, .flac, .wav, music libraries
- Archives: .zip, .rar, .7z, .tar files, compressed downloads
- Drivers/Firmware: hardware drivers, BIOS updates, firmware files
- Fonts: .ttf, .otf, .woff font files
`.trim();

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

function toDisplayPath(filePath: string, rootPath?: string): string {
  const rel = rootPath ? path.relative(rootPath, filePath) : filePath;
  return rel.replace(/\\/g, '/');
}

function summarizeExtensions(files: FileMeta[]): string {
  const counts = new Map<string, number>();
  for (const f of files) {
    const ext = f.extension || '(none)';
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([ext, n]) => `${ext} ×${n}`)
    .join(', ');
}

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

function buildAtomicPrompt(folder: AtomicFolder, existingFolders: string[], rootPath?: string): string {
  const folderList = existingFolders.length
    ? `Existing folders (STRONGLY prefer these):\n${existingFolders.slice(0, MAX_FOLDER_LIST).map((f) => `  - ${f}`).join('\n')}`
    : 'No existing folders yet.';
  const hints = [
    folder.hasExecutable ? 'contains executables (likely software or a game)' : null,
    `${folder.fileCount}+ files`,
  ].filter(Boolean).join(', ');

  return `You are a file organisation assistant. Suggest where to move this entire folder as a single unit (do not move individual files inside it).

${folderList}

${CATEGORY_HINTS}

Folder: "${toDisplayPath(folder.absolutePath, rootPath)}"
Characteristics: ${hints}

Rules:
1. Prefer an existing folder if one fits.
2. Be specific: "Games" beats "Misc", "Software" beats "Files".
3. confidence is between 0 and 1.

Respond with JSON: {"rationale": "One sentence explanation.", "suggestedFolder": "FolderName", "confidence": 0.85}`;
}

/**
 * Turns model output into a safe relative folder path: no traversal, no drive letters,
 * no characters Windows rejects, limited depth. Matches existing folders case-insensitively
 * so "documents" reuses "Documents" instead of creating a near-duplicate.
 */
export function sanitizeFolder(raw: unknown, existingFolders: string[] = []): string {
  if (typeof raw !== 'string') return FALLBACK.suggestedFolder;
  const segments = raw
    .replace(/\\/g, '/')
    .replace(/^[a-zA-Z]:/, '') // absolute Windows path → treat as relative
    .split('/')
    .map((s) => s.replace(/[<>:"|?*\x00-\x1f]/g, '').trim().replace(/[. ]+$/, ''))
    .filter((s) => s && s !== '.' && s !== '..')
    .slice(0, MAX_FOLDER_DEPTH);
  if (segments.length === 0) return FALLBACK.suggestedFolder;

  const existing = existingFolders.find((f) => f.toLowerCase() === segments[0].toLowerCase());
  if (existing) segments[0] = existing;
  return segments.join('/');
}

export function clampConfidence(raw: unknown): number {
  let n = typeof raw === 'string' ? parseFloat(raw) : typeof raw === 'number' ? raw : NaN;
  if (!Number.isFinite(n)) return 0;
  if (n > 1 && n <= 100) n /= 100; // model answered as a percentage
  return Math.min(1, Math.max(0, n));
}

export function parseLlmResponse(raw: string, existingFolders: string[] = []): LlmClusterResult {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('no JSON found');
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    return {
      suggestedFolder: sanitizeFolder(parsed.suggestedFolder, existingFolders),
      confidence: clampConfidence(parsed.confidence),
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale.trim() : '',
    };
  } catch {
    return { ...FALLBACK };
  }
}

/** Runs tasks with at most `limit` in flight, preserving result order. Stops starting new tasks once aborted. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  fallback: R,
  onDone: (done: number) => void,
  signal?: AbortSignal,
): Promise<R[]> {
  const results: R[] = new Array(items.length).fill(fallback);
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length && !signal?.aborted) {
      const i = next++;
      results[i] = await fn(items[i]);
      onDone(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

async function ask(client: OllamaClient, model: string, prompt: string, existingFolders: string[]): Promise<LlmClusterResult> {
  try {
    return parseLlmResponse(await client.chat(model, prompt, CHAT_OPTIONS), existingFolders);
  } catch {
    return { ...FALLBACK };
  }
}

export async function categorizeAtomicFolders(
  folders: AtomicFolder[],
  existingFolders: string[],
  client: OllamaClient,
  model: string,
  onProgress: (done: number, total: number) => void,
  options: ReasonOptions = {},
): Promise<FileSuggestion[]> {
  const results = await mapWithConcurrency(
    folders,
    options.concurrency ?? DEFAULT_CONCURRENCY,
    (folder) => ask(client, model, buildAtomicPrompt(folder, existingFolders, options.rootPath), existingFolders),
    FALLBACK,
    (done) => onProgress(done, folders.length),
    options.signal,
  );

  return folders.map((folder, i) => ({
    filePath: folder.absolutePath,
    clusterId: -1,
    suggestedDestination: results[i].suggestedFolder,
    rationale: results[i].rationale,
    confidence: results[i].confidence,
    status: 'pending',
    kind: 'folder',
  }));
}

export async function reasonClusters(
  assignments: ClusterAssignment[],
  fileMap: Map<string, FileMeta>,
  existingFolders: string[],
  client: OllamaClient,
  model: string,
  onProgress: (done: number, total: number) => void,
  options: ReasonOptions = {},
): Promise<FileSuggestion[]> {
  const clusterMap = new Map<number, string[]>();
  for (const a of assignments) {
    const paths = clusterMap.get(a.clusterId) ?? [];
    paths.push(a.filePath);
    clusterMap.set(a.clusterId, paths);
  }

  const clusterIds = Array.from(clusterMap.keys());
  const results = await mapWithConcurrency(
    clusterIds,
    options.concurrency ?? DEFAULT_CONCURRENCY,
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
    FALLBACK,
    (done) => onProgress(done, clusterIds.length),
    options.signal,
  );
  const clusterResults = new Map(clusterIds.map((id, i) => [id, results[i]]));

  return assignments.map((a) => {
    const cr = clusterResults.get(a.clusterId) ?? FALLBACK;
    return {
      filePath: a.filePath,
      clusterId: a.clusterId,
      suggestedDestination: cr.suggestedFolder,
      rationale: cr.rationale,
      confidence: cr.confidence,
      status: 'pending',
      kind: 'loose',
    };
  });
}

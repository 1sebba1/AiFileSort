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

/**
 * Existing folders for the prompts: every scanned folder (plus any profiled one), deduplicated and
 * ordered shallowest first, then by name — so a list cap drops deep subfolders, never top-level ones.
 */
export function orderExistingFolders(scannedFolders: string[], profiledFolders: string[] = []): string[] {
  const depth = (f: string): number => f.split('/').length;
  return Array.from(new Set([...scannedFolders, ...profiledFolders])).sort(
    (a, b) => depth(a) - depth(b) || (a < b ? -1 : a > b ? 1 : 0),
  );
}

/** Runs scan → extract → embed → profile → cluster → reason. Returns null if cancelled. */
export async function runPipeline(rootPath: string, opts: PipelineOptions): Promise<FileSuggestion[] | null> {
  const { client, chatModel, k, signal, emit } = opts;

  emit({ phase: 'scanning', current: 0, total: 0 });
  const { files: scanned, atomicFolders, folders: scannedFolders } = await scanDirectory(rootPath, (count) => {
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
  const existingFolders = orderExistingFolders(scannedFolders, profiles.map((p) => p.path));
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

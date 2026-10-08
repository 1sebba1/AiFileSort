export interface FileMeta {
  absolutePath: string;
  name: string;
  extension: string;
  sizeBytes: number;
  createdAt: Date;
  modifiedAt: Date;
  mimeType: string;
  contentSnippet?: string; // populated by ContentExtractor
  /** Folder relative to the scan root, '/'-separated; '' for loose files at the root */
  relativeFolder: string;
  /** Website the file was downloaded from (Windows Zone.Identifier), e.g. 'github.com' */
  originHost?: string;
}

export interface FileVector {
  filePath: string;
  vector: number[];
}

export interface ClusterAssignment {
  filePath: string;
  clusterId: number;
}

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

export interface AtomicFolder {
  absolutePath: string;
  name: string;
  fileCount: number;
  hasExecutable: boolean;
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
  | 'profiling'
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
  moves: Array<{ from: string; to: string; completed: boolean; isFolder?: boolean }>;
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
  SELECT_FOLDER: 'folder:select',
  OLLAMA_PULL: 'ollama:pull',
  OLLAMA_PULL_PROGRESS: 'ollama:pullProgress',
  FILE_REVEAL: 'file:reveal',
  FILE_TRASH: 'file:trash',
} as const;

export const EMBED_MODEL = 'nomic-embed-text';

export interface OllamaHealth {
  healthy: boolean;
  embedModel: boolean;
  chatModel: boolean;
}

export interface PullProgress {
  model: string;
  status: string;
  /** 0–100 while layers download; null for steps without a size (manifest, verify) */
  percent: number | null;
}

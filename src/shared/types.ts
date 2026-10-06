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

import { FileSuggestion } from '@shared/types';

export interface TrashResult {
  status: 'trashed' | 'cancelled' | 'unknown' | 'failed';
  /** The suggestion list after the action — the trashed item is removed only on success */
  suggestions: FileSuggestion[];
  error?: string;
}

export interface TrashDeps {
  confirm: (s: FileSuggestion) => Promise<boolean>;
  trash: (absolutePath: string) => Promise<void>;
}

/** Only paths the scan suggested may be acted on, so the renderer can't target arbitrary files */
export function findSuggestion(suggestions: FileSuggestion[], filePath: string): FileSuggestion | undefined {
  return suggestions.find((s) => s.filePath === filePath);
}

/** Asks the user, then moves the file or folder to the Recycle Bin / Trash */
export async function trashSuggestion(
  suggestions: FileSuggestion[],
  filePath: string,
  deps: TrashDeps,
): Promise<TrashResult> {
  const target = findSuggestion(suggestions, filePath);
  if (!target) return { status: 'unknown', suggestions };
  if (!(await deps.confirm(target))) return { status: 'cancelled', suggestions };
  try {
    await deps.trash(target.filePath);
  } catch (err) {
    return { status: 'failed', suggestions, error: (err as Error).message };
  }
  return { status: 'trashed', suggestions: suggestions.filter((s) => s !== target) };
}

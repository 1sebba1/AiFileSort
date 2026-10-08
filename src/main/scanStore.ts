import fsp from 'fs/promises';
import path from 'path';
import { FileSuggestion, SavedScan } from '@shared/types';

export type { SavedScan };

const FORMAT_VERSION = 1;

interface StoredFile extends SavedScan {
  version: number;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.lstat(p);
    return true;
  } catch {
    return false;
  }
}

function isStoredScan(value: unknown): value is StoredFile {
  const v = value as StoredFile;
  return !!v && v.version === FORMAT_VERSION && typeof v.rootPath === 'string'
    && typeof v.scannedAt === 'string' && Array.isArray(v.suggestions);
}

/** Moved files leave the review list; skipped and unapproved ones stay */
export function withoutMoved(suggestions: FileSuggestion[], moved: string[]): FileSuggestion[] {
  const movedSet = new Set(moved);
  return suggestions.filter((s) => !movedSet.has(s.filePath));
}

export function createScanStore(filePath: string) {
  return {
    /** The saved scan, minus suggestions for files moved or deleted outside the app; null if none or unreadable */
    async load(): Promise<SavedScan | null> {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await fsp.readFile(filePath, 'utf8'));
      } catch {
        return null;
      }
      if (!isStoredScan(parsed)) return null;
      const present = await Promise.all(parsed.suggestions.map((s) => exists(s.filePath)));
      const { version: _version, ...scan } = parsed;
      return { ...scan, suggestions: scan.suggestions.filter((_, i) => present[i]) };
    },

    async save(scan: SavedScan): Promise<void> {
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      // Write then rename, so a crash mid-write never leaves a half-written scan behind
      const tmp = `${filePath}.tmp`;
      const stored: StoredFile = { version: FORMAT_VERSION, ...scan };
      await fsp.writeFile(tmp, JSON.stringify(stored), 'utf8');
      await fsp.rename(tmp, filePath);
    },

    async clear(): Promise<void> {
      await fsp.rm(filePath, { force: true });
    },
  };
}

export type ScanStore = ReturnType<typeof createScanStore>;

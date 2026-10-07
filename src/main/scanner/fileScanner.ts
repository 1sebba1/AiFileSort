import fsp from 'fs/promises';
import path from 'path';
import { FileMeta, AtomicFolder } from '@shared/types';

const SKIP_DIRS = new Set([
  'node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information',
  '.Trash', '__pycache__', '.cache',
]);

const EXECUTABLE_EXTS = new Set(['.exe', '.msi', '.app', '.bat', '.cmd', '.sh', '.dmg', '.pkg']);
const ATOMIC_FILE_THRESHOLD = 30;

export async function detectAtomicFolders(rootPath: string): Promise<AtomicFolder[]> {
  const atomic: AtomicFolder[] = [];
  let entries: import('fs').Dirent[];
  try {
    entries = await fsp.readdir(rootPath, { withFileTypes: true });
  } catch {
    return atomic;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;

    const folderPath = path.join(rootPath, entry.name);
    const { fileCount, hasExecutable, hasSubdirs } = await shallowInspect(folderPath);

    if (hasExecutable || fileCount >= ATOMIC_FILE_THRESHOLD || hasSubdirs) {
      atomic.push({ absolutePath: folderPath, name: entry.name, fileCount, hasExecutable });
    }
  }
  return atomic;
}

async function shallowInspect(
  dir: string,
): Promise<{ fileCount: number; hasExecutable: boolean; hasSubdirs: boolean }> {
  let fileCount = 0;
  let hasExecutable = false;
  let hasSubdirs = false;

  async function countRecursive(d: string, depth: number): Promise<void> {
    if (fileCount >= ATOMIC_FILE_THRESHOLD) return; // early exit
    let ents: import('fs').Dirent[];
    try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isDirectory()) {
        hasSubdirs = true;
        if (depth < 2) await countRecursive(path.join(d, e.name), depth + 1);
      } else if (e.isFile()) {
        fileCount++;
        if (!hasExecutable && EXECUTABLE_EXTS.has(path.extname(e.name).toLowerCase())) {
          hasExecutable = true;
        }
      }
    }
  }

  await countRecursive(dir, 0);
  return { fileCount, hasExecutable, hasSubdirs };
}

export async function scanDirectory(
  rootPath: string,
  onProgress: (count: number) => void,
  atomicFolderPaths?: Set<string>,
): Promise<FileMeta[]> {
  const results: FileMeta[] = [];
  await walk(rootPath, results, onProgress, atomicFolderPaths ?? new Set());
  return results;
}

async function walk(
  dir: string,
  results: FileMeta[],
  onProgress: (count: number) => void,
  atomicPaths: Set<string>,
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
      const fullDir = path.join(dir, entry.name);
      if (atomicPaths.has(fullDir)) continue; // skip — handled as atomic unit
      await walk(fullDir, results, onProgress, atomicPaths);
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

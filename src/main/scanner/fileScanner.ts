import fsp from 'fs/promises';
import path from 'path';
import { FileMeta } from '@shared/types';

const SKIP_DIRS = new Set([
  'node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information',
  '.Trash', '__pycache__', '.cache',
]);

export async function scanDirectory(
  rootPath: string,
  onProgress: (count: number) => void,
): Promise<FileMeta[]> {
  const results: FileMeta[] = [];
  await walk(rootPath, results, onProgress);
  return results;
}

async function walk(
  dir: string,
  results: FileMeta[],
  onProgress: (count: number) => void,
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
      await walk(path.join(dir, entry.name), results, onProgress);
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

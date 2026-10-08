import fsp from 'fs/promises';
import path from 'path';
import type { Dirent } from 'fs';
import { FileMeta, AtomicFolder } from '@shared/types';

const SKIP_DIRS = new Set([
  'node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information',
  '.Trash', '__pycache__', '.cache',
]);

// An .exe only marks an installed app when it sits next to the app's own support files;
// a lone setup.exe or .msi is just an installer someone filed
const APP_SUPPORT_EXTS = ['.dll', '.pak', '.asar', '.so', '.dylib'];
// Binaries are often one or two levels down (Hades/x64, Game/Binaries/Win64); only these
// folder names are followed, so an organising parent like Games/ never inherits a child app
const BINARY_DIR_NAMES = new Set(['bin', 'x64', 'x86', 'win64', 'win32', 'binaries', 'app', 'program']);
const PROJECT_MARKERS = new Set(['.git', 'package.json']);
const ATOMIC_FILE_COUNT_CAP = 30;

export interface ScanResult {
  files: FileMeta[];
  /** Top-level atomic folders only — nested ones sit inside the user's organisation and are left alone */
  atomicFolders: AtomicFolder[];
}

type ReadDir = (dir: string) => Promise<Dirent[]>;
type AtomicReason = 'app' | 'project' | null;

// Atomic checks look ahead into subfolders the walk visits next; caching avoids reading them twice
function cachedReaddir(): ReadDir {
  const cache = new Map<string, Promise<Dirent[]>>();
  return (dir) => {
    let entries = cache.get(dir);
    if (!entries) {
      entries = fsp.readdir(dir, { withFileTypes: true }).catch(() => [] as Dirent[]);
      cache.set(dir, entries);
    }
    return entries;
  };
}

async function hasAppBinaries(dir: string, entries: Dirent[], depth: number, readdir: ReadDir): Promise<boolean> {
  const exts = new Set(entries.filter((e) => e.isFile()).map((e) => path.extname(e.name).toLowerCase()));
  if (exts.has('.exe') && APP_SUPPORT_EXTS.some((x) => exts.has(x))) return true;
  if (depth >= 2) return false;
  for (const e of entries) {
    if (!e.isDirectory() || !BINARY_DIR_NAMES.has(e.name.toLowerCase())) continue;
    const sub = path.join(dir, e.name);
    if (await hasAppBinaries(sub, await readdir(sub), depth + 1, readdir)) return true;
  }
  return false;
}

async function atomicReason(dir: string, readdir: ReadDir): Promise<AtomicReason> {
  if (dir.toLowerCase().endsWith('.app')) return 'app';
  const entries = await readdir(dir);
  if (entries.some((e) => PROJECT_MARKERS.has(e.name) || (e.isFile() && e.name.toLowerCase().endsWith('.sln')))) {
    return 'project';
  }
  return (await hasAppBinaries(dir, entries, 0, readdir)) ? 'app' : null;
}

async function countFiles(dir: string, readdir: ReadDir, cap: number): Promise<number> {
  let count = 0;
  const visit = async (d: string): Promise<void> => {
    for (const e of await readdir(d)) {
      if (count >= cap) return;
      if (e.isFile()) count++;
      else if (e.isDirectory()) await visit(path.join(d, e.name));
    }
  };
  await visit(dir);
  return Math.min(count, cap);
}

export async function scanDirectory(
  rootPath: string,
  onProgress: (count: number) => void,
): Promise<ScanResult> {
  const readdir = cachedReaddir();
  const files: FileMeta[] = [];
  const atomicFolders: AtomicFolder[] = [];

  const walk = async (dir: string, relativeFolder: string): Promise<void> => {
    for (const entry of await readdir(dir)) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const reason = await atomicReason(fullPath, readdir);
        if (reason) {
          if (relativeFolder === '') {
            atomicFolders.push({
              absolutePath: fullPath,
              name: entry.name,
              fileCount: await countFiles(fullPath, readdir, ATOMIC_FILE_COUNT_CAP),
              hasExecutable: reason === 'app',
            });
          }
          continue;
        }
        await walk(fullPath, relativeFolder ? `${relativeFolder}/${entry.name}` : entry.name);
      } else if (entry.isFile()) {
        try {
          const stat = await fsp.stat(fullPath);
          const ext = path.extname(entry.name).toLowerCase();
          files.push({
            absolutePath: fullPath,
            name: entry.name,
            extension: ext,
            sizeBytes: stat.size,
            createdAt: stat.birthtime,
            modifiedAt: stat.mtime,
            mimeType: extToMime(ext),
            relativeFolder,
          });
          onProgress(files.length);
        } catch {
          // unreadable — skip
        }
      }
    }
  };

  await walk(rootPath, '');
  return { files, atomicFolders };
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

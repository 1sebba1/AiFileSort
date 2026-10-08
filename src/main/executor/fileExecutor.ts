import fsp from 'fs/promises';
import path from 'path';
import { FileSuggestion, UndoManifest } from '@shared/types';

/**
 * Throws EEXIST unless nothing (not even a dangling symlink) exists at `target`.
 * `fsp.rename` silently replaces an existing file on Windows and POSIX, so every move —
 * same-volume or cross-drive, forward or undo — must pass this guard first.
 */
async function assertAbsent(target: string): Promise<void> {
  try {
    await fsp.lstat(target);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  throw Object.assign(new Error(`Destination already exists: ${target}`), { code: 'EEXIST' });
}

async function moveDir(from: string, to: string): Promise<void> {
  await assertAbsent(to);
  try {
    await fsp.rename(from, to);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      await fsp.cp(from, to, { recursive: true, force: false, errorOnExist: true });
      await fsp.rm(from, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}

async function moveFile(from: string, to: string): Promise<void> {
  await assertAbsent(to);
  try {
    await fsp.rename(from, to);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      await fsp.cp(from, to, { force: false, errorOnExist: true });
      await fsp.unlink(from);
    } else {
      throw err;
    }
  }
}

// Windows (and default macOS) filesystems are case-insensitive: "Docs/a.txt" and "docs/A.txt" collide.
function destinationKey(dest: string): string {
  return process.platform === 'win32' || process.platform === 'darwin' ? dest.toLowerCase() : dest;
}

export async function executeApproved(
  suggestions: FileSuggestion[],
  rootPath: string,
  manifestPath: string,
): Promise<{ moved: string[]; skipped: string[] }> {
  const toMove = suggestions.filter((s) => s.status === 'approved');

  const resolvedRoot = path.resolve(rootPath);
  const moved: string[] = [];
  const skipped: string[] = [];
  const claimed = new Set<string>();

  const manifest: UndoManifest = {
    timestamp: new Date().toISOString(),
    moves: toMove
      .map((s) => {
        const dest = path.resolve(resolvedRoot, s.suggestedDestination, path.basename(s.filePath));
        // Reject LLM-suggested paths that escape the root
        if (!dest.startsWith(resolvedRoot + path.sep) && dest !== resolvedRoot) return null;
        // Two approved items bound for the same path: only the first may move, or it would be overwritten.
        const key = destinationKey(dest);
        if (claimed.has(key)) {
          skipped.push(s.filePath);
          return null;
        }
        claimed.add(key);
        return { from: s.filePath, to: dest, completed: false, isFolder: s.kind === 'folder' };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null),
  };
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  for (const entry of manifest.moves) {
    try {
      await fsp.mkdir(path.dirname(entry.to), { recursive: true });
      if (entry.isFolder) {
        await moveDir(entry.from, entry.to);
      } else {
        await moveFile(entry.from, entry.to);
      }
      entry.completed = true;
      moved.push(entry.from);
    } catch {
      skipped.push(entry.from);
    }
  }

  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  return { moved, skipped };
}

export async function undoManifest(
  manifestPath: string,
): Promise<{ restored: string[]; skipped: string[] }> {
  const raw = await fsp.readFile(manifestPath, 'utf-8');
  const manifest = JSON.parse(raw) as UndoManifest;
  const restored: string[] = [];
  const skipped: string[] = [];

  for (const entry of manifest.moves.filter((m) => m.completed)) {
    try {
      await fsp.mkdir(path.dirname(entry.from), { recursive: true });
      if (entry.isFolder) {
        await moveDir(entry.to, entry.from);
      } else {
        await moveFile(entry.to, entry.from);
      }
      restored.push(entry.from);
    } catch {
      skipped.push(entry.from);
    }
  }

  return { restored, skipped };
}

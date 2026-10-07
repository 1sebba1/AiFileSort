import fsp from 'fs/promises';
import path from 'path';
import { FileSuggestion, UndoManifest } from '@shared/types';

async function moveDir(from: string, to: string): Promise<void> {
  try {
    await fsp.rename(from, to);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      try {
        await fsp.access(to);
        throw Object.assign(new Error(`Destination already exists: ${to}`), { code: 'EEXIST' });
      } catch (accessErr: unknown) {
        if ((accessErr as NodeJS.ErrnoException).code !== 'ENOENT') throw accessErr;
      }
      await fsp.cp(from, to, { recursive: true });
      await fsp.rm(from, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}

async function moveFile(from: string, to: string): Promise<void> {
  try {
    await fsp.rename(from, to);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      try {
        await fsp.access(to);
        throw Object.assign(new Error(`Destination already exists: ${to}`), { code: 'EEXIST' });
      } catch (accessErr: unknown) {
        if ((accessErr as NodeJS.ErrnoException).code !== 'ENOENT') throw accessErr;
      }
      await fsp.cp(from, to);
      await fsp.unlink(from);
    } else {
      throw err;
    }
  }
}

export async function executeApproved(
  suggestions: FileSuggestion[],
  rootPath: string,
  manifestPath: string,
): Promise<{ moved: string[]; skipped: string[] }> {
  const toMove = suggestions.filter((s) => s.status === 'approved');

  const resolvedRoot = path.resolve(rootPath);
  const manifest: UndoManifest = {
    timestamp: new Date().toISOString(),
    moves: toMove
      .map((s) => {
        const dest = path.resolve(resolvedRoot, s.suggestedDestination, path.basename(s.filePath));
        // Reject LLM-suggested paths that escape the root
        if (!dest.startsWith(resolvedRoot + path.sep) && dest !== resolvedRoot) return null;
        return { from: s.filePath, to: dest, completed: false, isFolder: s.isAtomicFolder };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null),
  };
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  const moved: string[] = [];
  const skipped: string[] = [];

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

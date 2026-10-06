import fsp from 'fs/promises';
import path from 'path';
import { FileSuggestion, UndoManifest } from '@shared/types';

async function moveFile(from: string, to: string): Promise<void> {
  try {
    await fsp.rename(from, to);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
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

  const manifest: UndoManifest = {
    timestamp: new Date().toISOString(),
    moves: toMove.map((s) => ({
      from: s.filePath,
      to: path.join(rootPath, s.suggestedDestination, path.basename(s.filePath)),
      completed: false,
    })),
  };
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  const moved: string[] = [];
  const skipped: string[] = [];

  for (const entry of manifest.moves) {
    try {
      await fsp.mkdir(path.dirname(entry.to), { recursive: true });
      await moveFile(entry.from, entry.to);
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
      await fsp.rename(entry.to, entry.from);
      restored.push(entry.from);
    } catch {
      skipped.push(entry.from);
    }
  }

  return { restored, skipped };
}

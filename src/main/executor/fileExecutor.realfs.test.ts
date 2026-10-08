import fs from 'fs';
import os from 'os';
import path from 'path';
import { executeApproved, undoManifest } from './fileExecutor';
import { FileSuggestion } from '@shared/types';

// Real temp directories: these tests guard against data loss, so they exercise the real filesystem.

let root: string;
let manifestPath: string;

function write(rel: string, content: string): string {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

function suggestion(filePath: string, dest: string, kind: FileSuggestion['kind'] = 'misfiled'): FileSuggestion {
  return {
    filePath,
    clusterId: -1,
    suggestedDestination: dest,
    rationale: '',
    confidence: 0.9,
    status: 'approved',
    kind,
  };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aifs-exec-'));
  manifestPath = path.join(os.tmpdir(), `aifs-undo-${path.basename(root)}.json`);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(manifestPath, { force: true });
});

describe('executeApproved overwrite guard (real fs)', () => {
  it('skips a same-volume move whose destination already exists and leaves both files intact', async () => {
    const src = write('Photos/scan.pdf', 'SOURCE');
    const existing = write('Documents/scan.pdf', 'EXISTING');

    const result = await executeApproved([suggestion(src, 'Documents')], root, manifestPath);

    expect(result.moved).toEqual([]);
    expect(result.skipped).toEqual([src]);
    expect(fs.readFileSync(src, 'utf-8')).toBe('SOURCE');
    expect(fs.readFileSync(existing, 'utf-8')).toBe('EXISTING');
  });

  it('skips a folder move whose destination already exists', async () => {
    write('Hades/game.exe', 'NEW');
    write('Games/Hades/save.dat', 'OLD');

    const src = path.join(root, 'Hades');
    const result = await executeApproved([suggestion(src, 'Games', 'folder')], root, manifestPath);

    expect(result.skipped).toEqual([src]);
    expect(fs.readFileSync(path.join(root, 'Hades/game.exe'), 'utf-8')).toBe('NEW');
    expect(fs.readFileSync(path.join(root, 'Games/Hades/save.dat'), 'utf-8')).toBe('OLD');
  });

  it('moves the first of two same-named files bound for the same folder and skips the second', async () => {
    const a = write('Photos/scan.pdf', 'FROM-PHOTOS');
    const b = write('Music/scan.pdf', 'FROM-MUSIC');
    fs.mkdirSync(path.join(root, 'Documents'));

    const result = await executeApproved(
      [suggestion(a, 'Documents'), suggestion(b, 'Documents')],
      root,
      manifestPath,
    );

    expect(result.moved).toEqual([a]);
    expect(result.skipped).toEqual([b]);
    expect(fs.readFileSync(path.join(root, 'Documents/scan.pdf'), 'utf-8')).toBe('FROM-PHOTOS');
    expect(fs.readFileSync(b, 'utf-8')).toBe('FROM-MUSIC');

    // The manifest only records the move that can actually happen, so undo restores the right file.
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(manifest.moves).toHaveLength(1);
    const undo = await undoManifest(manifestPath);
    expect(undo.restored).toEqual([a]);
    expect(fs.readFileSync(a, 'utf-8')).toBe('FROM-PHOTOS');
    expect(fs.readFileSync(b, 'utf-8')).toBe('FROM-MUSIC');
  });

  it('treats destinations differing only by case as colliding on win32', async () => {
    if (process.platform !== 'win32') return;
    const a = write('Photos/Scan.pdf', 'A');
    const b = write('Music/scan.pdf', 'B');

    const result = await executeApproved(
      [suggestion(a, 'Documents'), suggestion(b, 'documents')],
      root,
      manifestPath,
    );

    expect(result.moved).toEqual([a]);
    expect(result.skipped).toEqual([b]);
    expect(fs.readFileSync(b, 'utf-8')).toBe('B');
  });
});

describe('undoManifest overwrite guard (real fs)', () => {
  it('does not move a file back onto an occupied origin path', async () => {
    const src = write('Photos/scan.pdf', 'MOVED');
    await executeApproved([suggestion(src, 'Documents')], root, manifestPath);
    // A new file appears at the original location after the move.
    write('Photos/scan.pdf', 'NEWCOMER');

    const undo = await undoManifest(manifestPath);

    expect(undo.restored).toEqual([]);
    expect(undo.skipped).toEqual([src]);
    expect(fs.readFileSync(src, 'utf-8')).toBe('NEWCOMER');
    expect(fs.readFileSync(path.join(root, 'Documents/scan.pdf'), 'utf-8')).toBe('MOVED');
  });
});

import os from 'os';
import path from 'path';
import fsp from 'fs/promises';
import { scanDirectory } from './fileScanner';

let root: string;

// Paths ending in '/' create empty directories; everything else is a file with dummy content
async function makeTree(entries: string[]): Promise<void> {
  for (const rel of entries) {
    const full = path.join(root, rel);
    if (rel.endsWith('/')) {
      await fsp.mkdir(full, { recursive: true });
    } else {
      await fsp.mkdir(path.dirname(full), { recursive: true });
      await fsp.writeFile(full, 'x');
    }
  }
}

const rels = (files: { relativeFolder: string; name: string }[]) =>
  files.map((f) => (f.relativeFolder ? `${f.relativeFolder}/${f.name}` : f.name)).sort();

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aifs-scan-'));
});
afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

describe('scanDirectory', () => {
  it('tags loose and filed files with their relative folder', async () => {
    await makeTree(['loose.txt', 'Finance/Bank/statement.pdf', 'Finance/a/b/c/deep.txt']);
    const { files } = await scanDirectory(root, () => {});
    const byName = new Map(files.map((f) => [f.name, f]));
    expect(byName.get('loose.txt')!.relativeFolder).toBe('');
    expect(byName.get('statement.pdf')!.relativeFolder).toBe('Finance/Bank');
    expect(byName.get('deep.txt')!.relativeFolder).toBe('Finance/a/b/c');
    expect(byName.get('statement.pdf')!.extension).toBe('.pdf');
  });

  it('skips hidden entries and node_modules', async () => {
    await makeTree(['.hidden', 'node_modules/x.js', 'keep.txt']);
    const { files } = await scanDirectory(root, () => {});
    expect(rels(files)).toEqual(['keep.txt']);
  });

  it('skips Windows/macOS system files case-insensitively', async () => {
    await makeTree([
      'desktop.ini', 'Photos/Desktop.ini', 'Photos/Thumbs.db', 'Photos/ehthumbs.db',
      'Videos/EHTHUMBS_VISTA.DB', 'Photos/keep.jpg',
      // macOS custom-icon file; Windows cannot create a name containing a carriage return
      ...(process.platform === 'win32' ? [] : ['Photos/Icon\r']),
    ]);
    const { files } = await scanDirectory(root, () => {});
    expect(rels(files)).toEqual(['Photos/keep.jpg']);
  });

  it('reports progress for each file', async () => {
    await makeTree(['a.txt', 'b.txt']);
    const counts: number[] = [];
    await scanDirectory(root, (n) => counts.push(n));
    expect(counts).toEqual([1, 2]);
  });

  it('treats an installed app (exe next to dll) as an atomic top-level folder', async () => {
    await makeTree(['Hades/Hades.exe', 'Hades/fmod.dll', 'Hades/Content/a.pak']);
    const { files, atomicFolders } = await scanDirectory(root, () => {});
    expect(files).toHaveLength(0);
    expect(atomicFolders).toEqual([
      expect.objectContaining({ name: 'Hades', hasExecutable: true, absolutePath: path.join(root, 'Hades') }),
    ]);
  });

  it('finds app binaries inside bin-style subfolders', async () => {
    await makeTree(['Game/Binaries/Win64/Game.exe', 'Game/Binaries/Win64/engine.dll', 'Game/Content/data.pak']);
    const { atomicFolders } = await scanDirectory(root, () => {});
    expect(atomicFolders.map((f) => f.name)).toEqual(['Game']);
  });

  it('does not treat a folder of installers as an app', async () => {
    await makeTree(['Software/Installers/setup.exe', 'Software/Installers/tool.msi']);
    const { files, atomicFolders } = await scanDirectory(root, () => {});
    expect(atomicFolders).toEqual([]);
    expect(rels(files)).toEqual(['Software/Installers/setup.exe', 'Software/Installers/tool.msi']);
  });

  it('keeps an organising parent like Games/ walkable and skips the nested app silently', async () => {
    await makeTree(['Games/Hades/Hades.exe', 'Games/Hades/fmod.dll', 'Games/notes.txt']);
    const { files, atomicFolders } = await scanDirectory(root, () => {});
    expect(atomicFolders).toEqual([]);
    expect(rels(files)).toEqual(['Games/notes.txt']);
  });

  it('treats code projects as atomic: top-level reported, nested skipped', async () => {
    await makeTree(['myapp/package.json', 'myapp/src/index.ts', 'Projects/repo/.git/HEAD', 'Projects/repo/main.go', 'Projects/readme.txt', 'Tools/build.sln']);
    const { files, atomicFolders } = await scanDirectory(root, () => {});
    expect(atomicFolders.map((f) => [f.name, f.hasExecutable]).sort()).toEqual([['Tools', false], ['myapp', false]]);
    expect(rels(files)).toEqual(['Projects/readme.txt']);
  });

  it('treats .app bundles as atomic', async () => {
    await makeTree(['Tool.app/Contents/Info.plist']);
    const { atomicFolders } = await scanDirectory(root, () => {});
    expect(atomicFolders.map((f) => f.name)).toEqual(['Tool.app']);
  });

  it('caps the reported file count of an atomic folder at 30', async () => {
    const many = Array.from({ length: 40 }, (_, i) => `App/data${i}.pak`);
    await makeTree(['App/app.exe', 'App/core.dll', ...many]);
    const { atomicFolders } = await scanDirectory(root, () => {});
    expect(atomicFolders[0].fileCount).toBe(30);
  });

  it('returns nothing for a missing root', async () => {
    const result = await scanDirectory(path.join(root, 'nope'), () => {});
    expect(result).toEqual({ files: [], atomicFolders: [], folders: [] });
  });

  it('lists every walkable folder at depth 1-3, including empty ones and ones holding only an installed game', async () => {
    await makeTree([
      'Empty/',
      'Games/Hades/Hades.exe', 'Games/Hades/fmod.dll',
      'Finance/Bank/statement.pdf',
      'a/b/c/d/deep.txt',
      'Tool/tool.exe', 'Tool/lib.dll',
      '.hidden/x.txt',
      'node_modules/pkg/index.js',
      'loose.txt',
    ]);
    const { folders } = await scanDirectory(root, () => {});
    expect([...folders].sort()).toEqual(['Empty', 'Finance', 'Finance/Bank', 'Games', 'a', 'a/b', 'a/b/c']);
  });
});

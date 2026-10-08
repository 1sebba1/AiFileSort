import os from 'os';
import path from 'path';
import fsp from 'fs/promises';
import { FileSuggestion } from '@shared/types';
import { createScanStore, SavedScan, withoutMoved } from './scanStore';

let dir: string;

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aifs-store-'));
});
afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

function suggestion(filePath: string, status: FileSuggestion['status'] = 'pending'): FileSuggestion {
  return { filePath, clusterId: 0, suggestedDestination: 'Docs', rationale: 'r', confidence: 0.7, status, kind: 'loose' };
}

async function scanWith(files: string[]): Promise<SavedScan> {
  for (const f of files) await fsp.writeFile(f, 'x');
  return {
    rootPath: dir, chatModel: 'llama3.2:3b', k: 4, scannedAt: '2026-10-08T18:40:00.000Z',
    suggestions: files.map((f, i) => suggestion(f, i === 0 ? 'approved' : 'pending')),
  };
}

describe('scanStore', () => {
  it('returns null when nothing has been saved', async () => {
    expect(await createScanStore(path.join(dir, 'last-scan.json')).load()).toBeNull();
  });

  it('round-trips a scan including approve/reject statuses', async () => {
    const store = createScanStore(path.join(dir, 'last-scan.json'));
    const scan = await scanWith([path.join(dir, 'a.txt'), path.join(dir, 'b.txt')]);
    await store.save(scan);
    expect(await store.load()).toEqual(scan);
  });

  it('drops suggestions whose file no longer exists', async () => {
    const store = createScanStore(path.join(dir, 'last-scan.json'));
    const a = path.join(dir, 'a.txt');
    const b = path.join(dir, 'b.txt');
    await store.save(await scanWith([a, b]));
    await fsp.rm(b);
    const loaded = await store.load();
    expect(loaded!.suggestions.map((s) => s.filePath)).toEqual([a]);
  });

  it('treats a corrupt or foreign file as no saved scan', async () => {
    const file = path.join(dir, 'last-scan.json');
    const store = createScanStore(file);
    await fsp.writeFile(file, '{not json');
    expect(await store.load()).toBeNull();
    await fsp.writeFile(file, JSON.stringify({ hello: 'world' }));
    expect(await store.load()).toBeNull();
  });

  it('clear removes the saved scan, and clearing twice is fine', async () => {
    const store = createScanStore(path.join(dir, 'last-scan.json'));
    await store.save(await scanWith([path.join(dir, 'a.txt')]));
    await store.clear();
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it('creates the directory it saves into', async () => {
    const store = createScanStore(path.join(dir, 'nested', 'last-scan.json'));
    const scan = await scanWith([path.join(dir, 'a.txt')]);
    await store.save(scan);
    expect(await store.load()).toEqual(scan);
  });
});

describe('withoutMoved', () => {
  it('removes moved items and keeps skipped and unapproved ones', () => {
    const list = [suggestion('/r/a', 'approved'), suggestion('/r/b', 'approved'), suggestion('/r/c')];
    expect(withoutMoved(list, ['/r/a']).map((s) => s.filePath)).toEqual(['/r/b', '/r/c']);
  });
});

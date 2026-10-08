import { reasonClusters, categorizeAtomicFolders, sanitizeFolder, clampConfidence, buildContextSection, confirmMisfits, parseMisfitResponse } from './llmReasoner';
import { MisfitCandidate } from '../context/misfitDetector';
import { FolderProfile } from '../context/folderProfiles';
import { OllamaClient } from '../ollama/ollamaClient';
import { ClusterAssignment, FileMeta } from '@shared/types';

function makeMeta(filePath: string): FileMeta {
  return {
    absolutePath: filePath,
    name: filePath.split('/').pop()!,
    extension: '.txt',
    sizeBytes: 100,
    createdAt: new Date(),
    modifiedAt: new Date(),
    mimeType: 'text/plain',
    relativeFolder: '',
  };
}

const llmResponse = JSON.stringify({
  suggestedFolder: 'Documents/Work',
  confidence: 0.85,
  rationale: 'These files appear to be work-related documents.',
});

describe('reasonClusters', () => {
  it('returns one FileSuggestion per file', async () => {
    const client = { chat: jest.fn().mockResolvedValue(llmResponse) } as unknown as OllamaClient;
    const assignments: ClusterAssignment[] = [
      { filePath: '/root/a.txt', clusterId: 0 },
      { filePath: '/root/b.txt', clusterId: 0 },
    ];
    const fileMap = new Map([
      ['/root/a.txt', makeMeta('/root/a.txt')],
      ['/root/b.txt', makeMeta('/root/b.txt')],
    ]);
    const result = await reasonClusters(assignments, fileMap, ['Documents'], client, 'llama3.2:3b', () => {});
    expect(result).toHaveLength(2);
    expect(result[0].suggestedDestination).toBe('Documents/Work');
    expect(result[0].confidence).toBe(0.85);
    expect(result[0].status).toBe('pending');
  });

  it('makes one chat call per unique cluster', async () => {
    const client = { chat: jest.fn().mockResolvedValue(llmResponse) } as unknown as OllamaClient;
    const assignments: ClusterAssignment[] = [
      { filePath: '/root/a.txt', clusterId: 0 },
      { filePath: '/root/b.txt', clusterId: 1 },
    ];
    const fileMap = new Map([
      ['/root/a.txt', makeMeta('/root/a.txt')],
      ['/root/b.txt', makeMeta('/root/b.txt')],
    ]);
    await reasonClusters(assignments, fileMap, [], client, 'llama3.2:3b', () => {});
    expect(client.chat).toHaveBeenCalledTimes(2);
  });

  it('falls back gracefully when LLM returns malformed JSON', async () => {
    const client = { chat: jest.fn().mockResolvedValue('not json') } as unknown as OllamaClient;
    const assignments: ClusterAssignment[] = [{ filePath: '/root/a.txt', clusterId: 0 }];
    const fileMap = new Map([['/root/a.txt', makeMeta('/root/a.txt')]]);
    const result = await reasonClusters(assignments, fileMap, [], client, 'llama3.2:3b', () => {});
    expect(result[0].suggestedDestination).toBe('Unsorted');
    expect(result[0].confidence).toBe(0);
  });
});

describe('reasonClusters prompts', () => {
  it('shows paths relative to rootPath and requests structured JSON', async () => {
    const client = { chat: jest.fn().mockResolvedValue(llmResponse) } as unknown as OllamaClient;
    const assignments: ClusterAssignment[] = [{ filePath: '/root/sub/a.txt', clusterId: 0 }];
    const fileMap = new Map([['/root/sub/a.txt', makeMeta('/root/sub/a.txt')]]);
    await reasonClusters(assignments, fileMap, [], client, 'm', () => {}, { rootPath: '/root' });
    const [, prompt, options] = (client.chat as jest.Mock).mock.calls[0];
    expect(prompt).toContain('- sub/a.txt');
    expect(prompt).not.toContain('/root/sub');
    expect(options.format.required).toContain('suggestedFolder');
  });

  it('caps the number of paths in a large cluster prompt', async () => {
    const client = { chat: jest.fn().mockResolvedValue(llmResponse) } as unknown as OllamaClient;
    const paths = Array.from({ length: 200 }, (_, i) => `/root/f${i}.txt`);
    const assignments = paths.map((filePath) => ({ filePath, clusterId: 0 }));
    const fileMap = new Map(paths.map((p) => [p, makeMeta(p)]));
    await reasonClusters(assignments, fileMap, [], client, 'm', () => {}, { rootPath: '/root' });
    const prompt: string = (client.chat as jest.Mock).mock.calls[0][1];
    expect(prompt.match(/^- f\d+\.txt$/gm)).toHaveLength(30);
    expect(prompt).toContain('This group has 200 files');
    expect(prompt).toContain('.txt ×200');
  });

  it('runs clusters concurrently, preserves order, and reports progress', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const client = {
      chat: jest.fn(async (_m: string, prompt: string) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        const folder = prompt.match(/- (\w+)\.txt/)![1];
        return JSON.stringify({ suggestedFolder: folder, confidence: 0.9, rationale: '' });
      }),
    } as unknown as OllamaClient;
    const names = ['a', 'b', 'c', 'd', 'e'];
    const assignments = names.map((n, i) => ({ filePath: `/root/${n}.txt`, clusterId: i }));
    const fileMap = new Map(assignments.map((a) => [a.filePath, makeMeta(a.filePath)]));
    const progress: number[] = [];
    const result = await reasonClusters(assignments, fileMap, [], client, 'm', (d) => progress.push(d), { rootPath: '/root', concurrency: 2 });
    expect(maxInFlight).toBe(2);
    expect(result.map((r) => r.suggestedDestination)).toEqual(names);
    expect(progress).toEqual([1, 2, 3, 4, 5]);
  });

  it('stops issuing requests once aborted', async () => {
    const controller = new AbortController();
    const client = {
      chat: jest.fn(async () => {
        controller.abort();
        return llmResponse;
      }),
    } as unknown as OllamaClient;
    const assignments = [0, 1, 2, 3].map((i) => ({ filePath: `/root/${i}.txt`, clusterId: i }));
    const fileMap = new Map(assignments.map((a) => [a.filePath, makeMeta(a.filePath)]));
    await reasonClusters(assignments, fileMap, [], client, 'm', () => {}, { concurrency: 1, signal: controller.signal });
    expect(client.chat).toHaveBeenCalledTimes(1);
  });
});

describe('suggestion kinds', () => {
  it('tags cluster suggestions as loose', async () => {
    const client = { chat: jest.fn().mockResolvedValue(llmResponse) } as unknown as OllamaClient;
    const result = await reasonClusters(
      [{ filePath: '/root/a.txt', clusterId: 0 }],
      new Map([['/root/a.txt', makeMeta('/root/a.txt')]]),
      [], client, 'm', () => {},
    );
    expect(result[0].kind).toBe('loose');
  });

  it('tags atomic folder suggestions as folder', async () => {
    const client = { chat: jest.fn().mockResolvedValue(llmResponse) } as unknown as OllamaClient;
    const result = await categorizeAtomicFolders(
      [{ absolutePath: '/root/Hades', name: 'Hades', fileCount: 30, hasExecutable: true }],
      [], client, 'm', () => {},
    );
    expect(result[0].kind).toBe('folder');
  });
});

describe('sanitizeFolder', () => {
  it.each([
    ['Documents/Work', 'Documents/Work'],
    ['Documents\\Work', 'Documents/Work'],
    ['/Games/', 'Games'],
    ['../../Windows/System32', 'Windows/System32'],
    ['C:\\Users\\me\\Music', 'Users/me/Music'],
    ['Inv<oi>ces?', 'Invoices'],
    ['Docs. ', 'Docs'],
    ['a/b/c/d/e', 'a/b/c'],
    ['', 'Unsorted'],
    ['..', 'Unsorted'],
  ])('%p → %p', (raw, expected) => {
    expect(sanitizeFolder(raw)).toBe(expected);
  });

  it('returns Unsorted for non-strings', () => {
    expect(sanitizeFolder(42)).toBe('Unsorted');
  });

  it('reuses the casing of an existing folder', () => {
    expect(sanitizeFolder('documents/work', ['Documents', 'Games'])).toBe('Documents/work');
  });
});

describe('clampConfidence', () => {
  it.each([
    [0.7, 0.7],
    [85, 0.85],
    [-1, 0],
    [1000, 1],
    ['0.4', 0.4],
    ['high', 0],
    [undefined, 0],
  ])('%p → %p', (raw, expected) => {
    expect(clampConfidence(raw)).toBeCloseTo(expected);
  });
});

function profile(path: string, centroid: number[], sampleNames = ['a.pdf']): FolderProfile {
  return { path, fileCount: 10, topExtensions: [['.pdf', 10]], sampleNames, centroid, vectorSum: centroid, embeddedCount: 10 };
}

describe('buildContextSection', () => {
  it('includes every section that has content', () => {
    const text = buildContextSection({
      similar: [profile('Finance/Bank', [1, 0])],
      allFolders: ['Finance', 'Finance/Bank'],
      signatureLines: ['Bank statement — Finance (2 files)'],
      originLine: 'hsbc.co.uk (2)',
    });
    expect(text).toContain('Most similar existing folders:\n  - Finance/Bank (10 files: .pdf ×10) e.g. "a.pdf"');
    expect(text).toContain('All existing folders: Finance, Finance/Bank');
    expect(text).toContain('Known patterns in this group:\n  - Bank statement — Finance (2 files)');
    expect(text).toContain('Downloaded from: hsbc.co.uk (2)');
  });

  it('omits empty sections', () => {
    const text = buildContextSection({ similar: [], allFolders: ['Docs'], signatureLines: [], originLine: null });
    expect(text).toBe('All existing folders: Docs');
  });

  it('stays within budget with very long folder and file names', () => {
    const longName = 'x'.repeat(250);
    const text = buildContextSection({
      similar: Array.from({ length: 5 }, (_, i) => profile(`Folder${i}/${longName}`, [1, 0], [longName, longName, longName, longName, longName])),
      allFolders: Array.from({ length: 60 }, (_, i) => `Folder${i}/${longName}`),
      signatureLines: ['Font — Fonts (1 file)'],
      originLine: 'a.com (1)',
    });
    expect(text.length).toBeLessThanOrEqual(4800);
    expect(text).toContain('Most similar existing folders:');
  });
});

describe('reasonClusters with context', () => {
  it('puts the most similar folders, signatures and origins in the prompt', async () => {
    const client = { chat: jest.fn().mockResolvedValue(llmResponse) } as unknown as OllamaClient;
    const meta = { ...makeMeta('/root/IMG_0001.jpg'), originHost: 'drive.google.com' };
    await reasonClusters(
      [{ filePath: meta.absolutePath, clusterId: 0 }],
      new Map([[meta.absolutePath, meta]]),
      ['Media', 'Media/Photos', 'Finance'],
      client, 'm', () => {},
      {
        rootPath: '/root',
        profiles: [profile('Media/Photos', [0, 1]), profile('Finance', [1, 0])],
        vectors: new Map([[meta.absolutePath, [0.1, 1]]]),
      },
    );
    const prompt: string = (client.chat as jest.Mock).mock.calls[0][1];
    const similar = prompt.slice(prompt.indexOf('Most similar existing folders:'));
    expect(similar.indexOf('Media/Photos')).toBeLessThan(similar.indexOf('Finance ('));
    expect(prompt).toContain('All existing folders: Media, Media/Photos, Finance');
    expect(prompt).toContain('Phone camera — Photos');
    expect(prompt).toContain('Downloaded from: drive.google.com (1)');
    expect(prompt).toContain('Prefer the most similar existing folder');
  });

  it('says there are no folders when there is nothing to reuse', async () => {
    const client = { chat: jest.fn().mockResolvedValue(llmResponse) } as unknown as OllamaClient;
    await reasonClusters(
      [{ filePath: '/root/a.txt', clusterId: 0 }],
      new Map([['/root/a.txt', makeMeta('/root/a.txt')]]),
      [], client, 'm', () => {},
    );
    expect((client.chat as jest.Mock).mock.calls[0][1]).toContain('No existing folders yet — you may create one.');
  });

  it('returns no suggestions when there are no clusters', async () => {
    const client = { chat: jest.fn() } as unknown as OllamaClient;
    expect(await reasonClusters([], new Map(), ['A'], client, 'm', () => {})).toEqual([]);
    expect(client.chat).not.toHaveBeenCalled();
  });
});

describe('parseMisfitResponse', () => {
  const alts = ['Finance/Receipts', 'Work (old)', 'Café'];
  const json = (o: object) => JSON.stringify(o);

  it('accepts a move to one of the alternatives, keeping its spelling', () => {
    expect(parseMisfitResponse(json({ rationale: 'r', move: true, suggestedFolder: 'finance\\receipts/', confidence: 80 }), alts))
      .toEqual({ folder: 'Finance/Receipts', confidence: 0.8, rationale: 'r' });
  });

  it('matches names with spaces, parentheses and accents', () => {
    expect(parseMisfitResponse(json({ rationale: '', move: true, suggestedFolder: 'work (OLD)', confidence: 0.6 }), alts)?.folder).toBe('Work (old)');
    expect(parseMisfitResponse(json({ rationale: '', move: true, suggestedFolder: 'café', confidence: 0.6 }), alts)?.folder).toBe('Café');
  });

  it.each([
    ['move false', { rationale: 'fits', move: false, suggestedFolder: 'Café', confidence: 0.9 }],
    ['move missing', { rationale: '', suggestedFolder: 'Café', confidence: 0.9 }],
    ['folder not offered', { rationale: '', move: true, suggestedFolder: 'Photos', confidence: 0.9 }],
  ])('drops %s', (_label, obj) => {
    expect(parseMisfitResponse(json(obj), alts)).toBeNull();
  });

  it('drops malformed output', () => {
    expect(parseMisfitResponse('not json', alts)).toBeNull();
  });
});

describe('confirmMisfits', () => {
  function candidate(name: string): MisfitCandidate {
    const p = (path: string): FolderProfile => ({ path, fileCount: 5, topExtensions: [['.jpg', 5]], sampleNames: ['IMG_1.jpg'], centroid: [1], vectorSum: [5], embeddedCount: 5 });
    return {
      file: { ...makeMeta(`/root/Photos/${name}`), relativeFolder: 'Photos', contentSnippet: 'Invoice total £40', originHost: 'amazon.co.uk' },
      current: p('Photos'),
      alternatives: [p('Finance/Receipts'), p('Documents')],
      margin: 0.3,
    };
  }

  it('turns confirmed moves into misfiled suggestions and drops the rest', async () => {
    const client = {
      chat: jest.fn(async (_m: string, prompt: string) => prompt.includes('receipt_a.pdf')
        ? JSON.stringify({ rationale: 'A receipt.', move: true, suggestedFolder: 'Finance/Receipts', confidence: 0.9 })
        : JSON.stringify({ rationale: 'Fits.', move: false, suggestedFolder: '', confidence: 0.4 })),
    } as unknown as OllamaClient;
    const progress: number[] = [];
    const result = await confirmMisfits([candidate('receipt_a.pdf'), candidate('holiday.jpg')], client, 'm', (d) => progress.push(d), { rootPath: '/root' });
    expect(result).toEqual([{
      filePath: '/root/Photos/receipt_a.pdf', clusterId: -1, suggestedDestination: 'Finance/Receipts',
      rationale: 'A receipt.', confidence: 0.9, status: 'pending', kind: 'misfiled', currentFolder: 'Photos',
    }]);
    expect(progress).toEqual([1, 2]);
  });

  it('shows the model the file evidence, the current folder and only the alternatives', async () => {
    const client = { chat: jest.fn().mockResolvedValue('{}') } as unknown as OllamaClient;
    await confirmMisfits([candidate('receipt_a.pdf')], client, 'm', () => {}, { rootPath: '/root' });
    const [, prompt, options] = (client.chat as jest.Mock).mock.calls[0];
    expect(prompt).toContain('File: Photos/receipt_a.pdf');
    expect(prompt).toContain('Invoice total £40');
    expect(prompt).toContain('Known pattern: Receipt — Finance');
    expect(prompt).toContain('Downloaded from: amazon.co.uk');
    expect(prompt).toContain('It is currently in:\n  - Photos (5 files');
    expect(prompt).toContain('exactly one of: "Finance/Receipts", "Documents"');
    expect(options.format.required).toContain('move');
  });

  it('drops a candidate when the chat call fails', async () => {
    const client = { chat: jest.fn().mockRejectedValue(new Error('down')) } as unknown as OllamaClient;
    expect(await confirmMisfits([candidate('a.pdf')], client, 'm', () => {})).toEqual([]);
  });
});

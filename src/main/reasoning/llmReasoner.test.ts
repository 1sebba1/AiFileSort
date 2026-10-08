import { reasonClusters, categorizeAtomicFolders, sanitizeFolder, clampConfidence, samplePaths } from './llmReasoner';
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

describe('samplePaths', () => {
  it('returns all paths when under the limit', () => {
    expect(samplePaths(['a', 'b'], 5)).toEqual(['a', 'b']);
  });
  it('spreads the sample across the whole list', () => {
    const paths = Array.from({ length: 100 }, (_, i) => String(i));
    const sample = samplePaths(paths, 4);
    expect(sample).toEqual(['0', '25', '50', '75']);
  });
});

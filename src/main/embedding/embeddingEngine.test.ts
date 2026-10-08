import { embedFiles } from './embeddingEngine';
import { OllamaClient } from '../ollama/ollamaClient';
import { FileMeta } from '@shared/types';

function makeFile(name: string): FileMeta {
  return {
    absolutePath: `/fake/${name}`,
    name,
    extension: '.txt',
    sizeBytes: 100,
    createdAt: new Date('2024-01-01'),
    modifiedAt: new Date('2024-01-01'),
    mimeType: 'text/plain',
    contentSnippet: 'some content',
  };
}

// Mimics /api/embed: one vector per input, or throws for the whole request
function batchClient(embedText: (text: string) => number[]): OllamaClient {
  return {
    embedBatch: jest.fn(async (_model: string, texts: string[]) => texts.map(embedText)),
  } as unknown as OllamaClient;
}

describe('embedFiles', () => {
  it('returns a FileVector for each file', async () => {
    const client = batchClient(() => [0.1, 0.2]);
    const files = [makeFile('a.txt'), makeFile('b.txt')];
    const result = await embedFiles(files, client, 'nomic-embed-text', 5, () => {}, new AbortController().signal);
    expect(result).toHaveLength(2);
    expect(result[0].vector).toEqual([0.1, 0.2]);
  });

  it('sends one request per batch with the clustering task prefix', async () => {
    const client = batchClient(() => [1]);
    const files = [makeFile('a.txt'), makeFile('b.txt'), makeFile('c.txt')];
    await embedFiles(files, client, 'nomic-embed-text', 2, () => {}, new AbortController().signal);
    const calls = (client.embedBatch as jest.Mock).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).toHaveLength(2);
    expect(calls[0][1][0]).toMatch(/^clustering: filename: a\.txt/);
  });

  it('falls back to per-file requests and skips only the file that fails', async () => {
    const client = batchClient((text) => {
      if (text.includes('fail.txt')) throw new Error('bad input');
      return [0.5, 0.6];
    });
    const files = [makeFile('fail.txt'), makeFile('ok.txt')];
    const result = await embedFiles(files, client, 'nomic-embed-text', 5, () => {}, new AbortController().signal);
    expect(result).toHaveLength(1);
    expect(result[0].filePath).toBe('/fake/ok.txt');
  });

  it('calls onProgress with percentage', async () => {
    const client = batchClient(() => [1]);
    const files = [makeFile('a.txt'), makeFile('b.txt'), makeFile('c.txt'), makeFile('d.txt')];
    const progress: number[] = [];
    await embedFiles(files, client, 'nomic-embed-text', 2, (pct) => progress.push(pct), new AbortController().signal);
    expect(progress).toEqual([50, 100]);
  });

  it('stops early when aborted', async () => {
    const controller = new AbortController();
    const client = batchClient(() => {
      controller.abort();
      return [1];
    });
    const files = [makeFile('a.txt'), makeFile('b.txt'), makeFile('c.txt')];
    const result = await embedFiles(files, client, 'nomic-embed-text', 1, () => {}, controller.signal);
    expect(result.length).toBeLessThan(3);
  });
});

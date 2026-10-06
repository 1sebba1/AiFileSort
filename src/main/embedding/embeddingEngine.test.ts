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

describe('embedFiles', () => {
  it('returns a FileVector for each file', async () => {
    const client = { embed: jest.fn().mockResolvedValue([0.1, 0.2]) } as unknown as OllamaClient;
    const files = [makeFile('a.txt'), makeFile('b.txt')];
    const result = await embedFiles(files, client, 'nomic-embed-text', 5, () => {}, new AbortController().signal);
    expect(result).toHaveLength(2);
    expect(result[0].vector).toEqual([0.1, 0.2]);
  });

  it('skips a file and continues if embed throws', async () => {
    const client = {
      embed: jest.fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce([0.5, 0.6]),
    } as unknown as OllamaClient;
    const files = [makeFile('fail.txt'), makeFile('ok.txt')];
    const result = await embedFiles(files, client, 'nomic-embed-text', 5, () => {}, new AbortController().signal);
    expect(result).toHaveLength(1);
    expect(result[0].filePath).toBe('/fake/ok.txt');
  });

  it('calls onProgress with percentage', async () => {
    const client = { embed: jest.fn().mockResolvedValue([1]) } as unknown as OllamaClient;
    const files = [makeFile('a.txt'), makeFile('b.txt'), makeFile('c.txt'), makeFile('d.txt')];
    const progress: number[] = [];
    await embedFiles(files, client, 'nomic-embed-text', 2, (pct) => progress.push(pct), new AbortController().signal);
    expect(progress[progress.length - 1]).toBe(100);
  });

  it('stops early when aborted', async () => {
    const controller = new AbortController();
    const client = {
      embed: jest.fn().mockImplementation(async () => {
        controller.abort();
        return [1];
      }),
    } as unknown as OllamaClient;
    const files = [makeFile('a.txt'), makeFile('b.txt'), makeFile('c.txt')];
    const result = await embedFiles(files, client, 'nomic-embed-text', 1, () => {}, controller.signal);
    expect(result.length).toBeLessThan(3);
  });
});

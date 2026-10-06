import { reasonClusters } from './llmReasoner';
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

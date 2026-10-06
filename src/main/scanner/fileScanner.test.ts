import path from 'path';
import { scanDirectory } from './fileScanner';

jest.mock('fs/promises');
import fsp from 'fs/promises';
const mockFsp = fsp as jest.Mocked<typeof fsp>;

describe('scanDirectory', () => {
  it('returns FileMeta for each file', async () => {
    mockFsp.readdir = jest.fn().mockResolvedValueOnce([
      { name: 'file.txt', isDirectory: () => false, isFile: () => true } as unknown as import('fs').Dirent,
    ]);
    mockFsp.stat = jest.fn().mockResolvedValueOnce({
      size: 100,
      birthtime: new Date('2024-01-01'),
      mtime: new Date('2024-06-01'),
    } as import('fs').Stats);

    const results = await scanDirectory('/fake/dir', () => {});
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('file.txt');
    expect(results[0].extension).toBe('.txt');
    expect(results[0].sizeBytes).toBe(100);
  });

  it('skips hidden files', async () => {
    mockFsp.readdir = jest.fn().mockResolvedValueOnce([
      { name: '.hidden', isDirectory: () => false, isFile: () => true } as unknown as import('fs').Dirent,
    ]);
    const results = await scanDirectory('/fake/dir', () => {});
    expect(results).toHaveLength(0);
  });

  it('skips node_modules directory', async () => {
    mockFsp.readdir = jest.fn()
      .mockResolvedValueOnce([
        { name: 'node_modules', isDirectory: () => true, isFile: () => false } as unknown as import('fs').Dirent,
      ]);
    const results = await scanDirectory('/fake/dir', () => {});
    expect(results).toHaveLength(0);
  });

  it('calls onProgress for each file found', async () => {
    mockFsp.readdir = jest.fn().mockResolvedValueOnce([
      { name: 'a.txt', isDirectory: () => false, isFile: () => true } as unknown as import('fs').Dirent,
      { name: 'b.txt', isDirectory: () => false, isFile: () => true } as unknown as import('fs').Dirent,
    ]);
    mockFsp.stat = jest.fn().mockResolvedValue({
      size: 50, birthtime: new Date(), mtime: new Date(),
    } as import('fs').Stats);

    const counts: number[] = [];
    await scanDirectory('/fake/dir', (n) => counts.push(n));
    expect(counts).toEqual([1, 2]);
  });
});

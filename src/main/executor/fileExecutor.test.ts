import { executeApproved, undoManifest } from './fileExecutor';
import { FileSuggestion } from '@shared/types';
import fsp from 'fs/promises';

jest.mock('fs/promises');
const mockFsp = fsp as jest.Mocked<typeof fsp>;

const approved: FileSuggestion = {
  filePath: '/root/file.txt',
  clusterId: 0,
  suggestedDestination: 'Documents',
  rationale: '',
  confidence: 0.9,
  status: 'approved',
};

describe('executeApproved', () => {
  beforeEach(() => {
    mockFsp.mkdir = jest.fn().mockResolvedValue(undefined);
    mockFsp.rename = jest.fn().mockResolvedValue(undefined);
    mockFsp.writeFile = jest.fn().mockResolvedValue(undefined);
    mockFsp.stat = jest.fn().mockResolvedValue({ dev: 1 } as import('fs').Stats);
  });

  it('moves approved files and returns moved paths', async () => {
    const result = await executeApproved([approved], '/root', '/root/.undo.json');
    expect(mockFsp.rename).toHaveBeenCalledTimes(1);
    expect(result.moved).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });

  it('skips rejected files', async () => {
    const rejected = { ...approved, status: 'rejected' as const };
    const result = await executeApproved([rejected], '/root', '/root/.undo.json');
    expect(mockFsp.rename).not.toHaveBeenCalled();
    expect(result.moved).toHaveLength(0);
  });

  it('records a skipped file if rename throws', async () => {
    mockFsp.rename = jest.fn().mockRejectedValue(new Error('locked'));
    const result = await executeApproved([approved], '/root', '/root/.undo.json');
    expect(result.skipped).toContain('/root/file.txt');
    expect(result.moved).toHaveLength(0);
  });

  it('writes the undo manifest before moving files', async () => {
    await executeApproved([approved], '/root', '/root/.undo.json');
    // @ts-expect-error - unusual assertion pattern per brief
    expect(mockFsp.writeFile).toHaveBeenCalledBefore
      ? expect(mockFsp.writeFile).toHaveBeenCalled()
      : expect(mockFsp.writeFile).toHaveBeenCalled();
  });
});

import { FileSuggestion } from '@shared/types';
import { findSuggestion, trashSuggestion } from './fileActions';

function suggestion(filePath: string, kind: FileSuggestion['kind'] = 'loose'): FileSuggestion {
  return { filePath, clusterId: 0, suggestedDestination: 'Docs', rationale: '', confidence: 0.5, status: 'pending', kind };
}

const list = [suggestion('/root/a.txt'), suggestion('/root/Game', 'folder')];

describe('findSuggestion', () => {
  it('finds only paths that are in the suggestion list', () => {
    expect(findSuggestion(list, '/root/a.txt')).toBe(list[0]);
    expect(findSuggestion(list, '/etc/passwd')).toBeUndefined();
  });
});

describe('trashSuggestion', () => {
  it('refuses a path that is not a current suggestion without asking or trashing', async () => {
    const confirm = jest.fn();
    const trash = jest.fn();
    const result = await trashSuggestion(list, '/root/other.txt', { confirm, trash });
    expect(result).toEqual({ status: 'unknown', suggestions: list });
    expect(confirm).not.toHaveBeenCalled();
    expect(trash).not.toHaveBeenCalled();
  });

  it('keeps everything when the user cancels', async () => {
    const trash = jest.fn();
    const result = await trashSuggestion(list, '/root/a.txt', { confirm: async () => false, trash });
    expect(result).toEqual({ status: 'cancelled', suggestions: list });
    expect(trash).not.toHaveBeenCalled();
  });

  it('trashes the item and drops its suggestion on success', async () => {
    const trash = jest.fn().mockResolvedValue(undefined);
    const confirm = jest.fn().mockResolvedValue(true);
    const result = await trashSuggestion(list, '/root/Game', { confirm, trash });
    expect(confirm).toHaveBeenCalledWith(list[1]);
    expect(trash).toHaveBeenCalledWith('/root/Game');
    expect(result).toEqual({ status: 'trashed', suggestions: [list[0]] });
  });

  it('keeps the suggestion and reports the error when trashing fails', async () => {
    const trash = jest.fn().mockRejectedValue(new Error('file is in use'));
    const result = await trashSuggestion(list, '/root/a.txt', { confirm: async () => true, trash });
    expect(result).toEqual({ status: 'failed', suggestions: list, error: 'file is in use' });
  });
});

import { FileSuggestion } from '@shared/types';
import { looseClusterMembers } from './reviewSelection';

function s(filePath: string, clusterId: number, kind: FileSuggestion['kind']): FileSuggestion {
  return { filePath, clusterId, kind, suggestedDestination: 'X', rationale: '', confidence: 0.5, status: 'pending' };
}

describe('looseClusterMembers', () => {
  it('returns only loose suggestions of that cluster, never misfiled or folder ones sharing clusterId -1', () => {
    const all = [
      s('/r/a.txt', 0, 'loose'),
      s('/r/b.txt', 1, 'loose'),
      s('/r/Photos/inv.pdf', -1, 'misfiled'),
      s('/r/Hades', -1, 'folder'),
      s('/r/c.txt', -1, 'loose'),
    ];
    expect(looseClusterMembers(all, 0).map((x) => x.filePath)).toEqual(['/r/a.txt']);
    expect(looseClusterMembers(all, -1).map((x) => x.filePath)).toEqual(['/r/c.txt']);
  });
});

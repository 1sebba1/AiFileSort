import { FileSuggestion } from '@shared/types';

/**
 * The suggestions a cluster's "approve all / reject all" applies to. Misfiled and folder
 * suggestions share clusterId -1, so the kind must be checked too.
 */
export function looseClusterMembers(suggestions: FileSuggestion[], clusterId: number): FileSuggestion[] {
  return suggestions.filter((s) => s.kind === 'loose' && s.clusterId === clusterId);
}

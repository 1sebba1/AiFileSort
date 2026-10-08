import { FileMeta } from '@shared/types';
import { FolderProfile, isRelatedFolder, profileFolderOf, topFolders } from './folderProfiles';
import { dot, normalize } from './vectorMath';

export const MISFIT_MARGIN = 0.1;
export const MIN_FOLDER_SIZE = 4;
export const MAX_MISFIT_CANDIDATES = 40;
const ALTERNATIVES = 2;

export interface MisfitCandidate {
  file: FileMeta;
  current: FolderProfile;
  /** Best other folders, most similar first; never the current folder's ancestors or descendants */
  alternatives: FolderProfile[];
  /** How much closer the best alternative is than the current folder */
  margin: number;
}

export interface MisfitOptions {
  margin?: number;
  minFolderSize?: number;
  maxCandidates?: number;
}

/**
 * Stage 1 of misfit detection — embedding outliers only, no LLM.
 * A filed file is a candidate when another (unrelated) folder is clearly closer to it than its own.
 */
export function findMisfitCandidates(
  files: FileMeta[],
  vectors: Map<string, number[]>,
  profiles: FolderProfile[],
  opts: MisfitOptions = {},
): MisfitCandidate[] {
  const margin = opts.margin ?? MISFIT_MARGIN;
  const minFolderSize = opts.minFolderSize ?? MIN_FOLDER_SIZE;
  const maxCandidates = opts.maxCandidates ?? MAX_MISFIT_CANDIDATES;
  const byPath = new Map(profiles.map((p) => [p.path, p]));
  const candidates: MisfitCandidate[] = [];

  for (const file of files) {
    if (file.relativeFolder === '') continue;
    const vector = vectors.get(file.absolutePath);
    if (!vector) continue;
    const current = byPath.get(profileFolderOf(file.relativeFolder));
    if (!current || current.embeddedCount < minFolderSize) continue;

    const unit = normalize(vector);
    // Leave the file out of its own folder's centroid, or it would always look like it fits
    const ownCentroid = normalize(current.vectorSum.map((x, i) => x - unit[i]));
    const ownSimilarity = dot(unit, ownCentroid);

    const ranked = topFolders(profiles, unit, ALTERNATIVES, (p) => isRelatedFolder(p.path, current.path));
    if (ranked.length === 0) continue;
    const gap = ranked[0].similarity - ownSimilarity;
    if (gap < margin) continue;

    candidates.push({ file, current, alternatives: ranked.map((r) => r.profile), margin: gap });
  }

  return candidates.sort((a, b) => b.margin - a.margin).slice(0, maxCandidates);
}

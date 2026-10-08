import { FileMeta } from '@shared/types';
import { evenSample } from './sampling';
import { dot, normalize } from './vectorMath';

export const MAX_PROFILE_DEPTH = 3;
export const MAX_EMBEDDED_PER_FOLDER = 200;
const TOP_EXTENSIONS = 4;
const SAMPLE_NAMES = 5;
const MAX_NAME_CHARS = 40;

export interface FolderProfile {
  /** Relative to the scan root, '/'-separated, e.g. 'Finance/Bank' */
  path: string;
  /** Files scanned in this folder and all its subfolders */
  fileCount: number;
  topExtensions: Array<[string, number]>;
  sampleNames: string[];
  /** Unit vector: the average direction of the members' embeddings */
  centroid: number[];
  /** Sum of the members' unit vectors — lets callers compute a centroid with one file left out */
  vectorSum: number[];
  /** Members that have an embedding (the centroid is built from these) */
  embeddedCount: number;
}

/** The profiled folder a file belongs to: its folder truncated to MAX_PROFILE_DEPTH ('' for loose files) */
export function profileFolderOf(relativeFolder: string): string {
  return relativeFolder.split('/').filter(Boolean).slice(0, MAX_PROFILE_DEPTH).join('/');
}

/** True when a and b are the same folder or one contains the other */
export function isRelatedFolder(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function ancestorsAndSelf(folder: string): string[] {
  const parts = folder.split('/');
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}

/** All loose files, plus an even sample of at most `perFolder` filed files per profiled folder */
export function selectForEmbedding(files: FileMeta[], perFolder = MAX_EMBEDDED_PER_FOLDER): FileMeta[] {
  const loose: FileMeta[] = [];
  const byFolder = new Map<string, FileMeta[]>();
  for (const f of files) {
    if (f.relativeFolder === '') {
      loose.push(f);
      continue;
    }
    const key = profileFolderOf(f.relativeFolder);
    const group = byFolder.get(key) ?? [];
    group.push(f);
    byFolder.set(key, group);
  }
  const filed = Array.from(byFolder.values()).flatMap((group) =>
    evenSample([...group].sort((a, b) => a.absolutePath.localeCompare(b.absolutePath)), perFolder),
  );
  return [...loose, ...filed];
}

export function buildFolderProfiles(files: FileMeta[], vectors: Map<string, number[]>): FolderProfile[] {
  const members = new Map<string, FileMeta[]>();
  for (const f of files) {
    if (f.relativeFolder === '') continue;
    for (const folder of ancestorsAndSelf(profileFolderOf(f.relativeFolder))) {
      const list = members.get(folder) ?? [];
      list.push(f);
      members.set(folder, list);
    }
  }

  const profiles: FolderProfile[] = [];
  for (const [folderPath, folderFiles] of members) {
    let vectorSum: number[] | null = null;
    let embeddedCount = 0;
    for (const f of folderFiles) {
      const v = vectors.get(f.absolutePath);
      if (!v) continue;
      const unit = normalize(v);
      vectorSum = vectorSum ? vectorSum.map((x, i) => x + unit[i]) : [...unit];
      embeddedCount++;
    }
    if (!vectorSum) continue;

    const extCounts = new Map<string, number>();
    for (const f of folderFiles) {
      const ext = f.extension || '(none)';
      extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
    }
    const names = Array.from(new Set(folderFiles.map((f) => f.name))).sort();

    profiles.push({
      path: folderPath,
      fileCount: folderFiles.length,
      topExtensions: Array.from(extCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, TOP_EXTENSIONS),
      sampleNames: evenSample(names, SAMPLE_NAMES),
      centroid: normalize(vectorSum),
      vectorSum,
      embeddedCount,
    });
  }
  return profiles.sort((a, b) => a.path.localeCompare(b.path));
}

export function topFolders(
  profiles: FolderProfile[],
  vector: number[],
  n: number,
  exclude?: (p: FolderProfile) => boolean,
): Array<{ profile: FolderProfile; similarity: number }> {
  const unit = normalize(vector);
  return profiles
    .filter((p) => !exclude?.(p))
    .map((profile) => ({ profile, similarity: dot(unit, profile.centroid) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, n);
}

function shorten(name: string): string {
  return name.length > MAX_NAME_CHARS ? `${name.slice(0, MAX_NAME_CHARS - 1)}…` : name;
}

/** One prompt line, e.g. `Finance/Bank (42 files: .pdf ×38, .csv ×4) e.g. "Statement_2026-03.pdf"` */
export function describeProfile(p: FolderProfile, withSamples = true): string {
  const exts = p.topExtensions.map(([ext, n]) => `${ext} ×${n}`).join(', ');
  const base = `${p.path} (${p.fileCount} files: ${exts})`;
  if (!withSamples || p.sampleNames.length === 0) return base;
  return `${base} e.g. ${p.sampleNames.map((n) => `"${shorten(n)}"`).join(', ')}`;
}

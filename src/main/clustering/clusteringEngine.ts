// eslint-disable-next-line @typescript-eslint/no-var-requires
const { kmeans } = require('ml-kmeans');
import { ClusterAssignment, FileVector } from '@shared/types';
import { normalize } from '../context/vectorMath';

export function estimateK(fileCount: number): number {
  if (fileCount <= 0) return 1;
  return Math.min(50, Math.max(1, Math.round(Math.sqrt(fileCount))));
}

export function clusterFiles(vectors: FileVector[], k?: number): ClusterAssignment[] {
  if (vectors.length === 0) return [];
  const resolvedK = Math.min(k ?? estimateK(vectors.length), vectors.length);
  const matrix = vectors.map((v) => normalize(v.vector));
  const result = kmeans(matrix, resolvedK, { initialization: 'kmeans++', seed: 42 });
  return vectors.map((v, i) => ({
    filePath: v.filePath,
    clusterId: result.clusters[i],
  }));
}

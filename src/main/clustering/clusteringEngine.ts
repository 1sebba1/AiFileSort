// eslint-disable-next-line @typescript-eslint/no-var-requires
const { kmeans } = require('ml-kmeans');
import { ClusterAssignment, FileVector } from '@shared/types';

export function estimateK(fileCount: number): number {
  if (fileCount <= 0) return 1;
  return Math.min(50, Math.max(1, Math.round(Math.sqrt(fileCount))));
}

// Unit-length vectors make k-means' euclidean distance rank like cosine similarity,
// which is what text embeddings are meant to be compared with
export function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
  return norm === 0 ? vector : vector.map((x) => x / norm);
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

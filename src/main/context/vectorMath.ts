// Unit-length vectors make euclidean distance and dot product rank like cosine similarity,
// which is how text embeddings are meant to be compared
export function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
  return norm === 0 ? vector : vector.map((x) => x / norm);
}

export function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/** Unit vector pointing in the average direction of the inputs (each input counts equally, whatever its length) */
export function meanDirection(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const sum = new Array(vectors[0].length).fill(0);
  for (const v of vectors) normalize(v).forEach((x, i) => { sum[i] += x; });
  return normalize(sum);
}

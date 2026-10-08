import { clusterFiles, estimateK } from './clusteringEngine';

// Mock ml-kmeans module with a simple k-means-like clustering algorithm
jest.mock('ml-kmeans', () => ({
  kmeans: jest.fn((data: number[][], k: number) => {
    // Simple k-means++ style mock: run one iteration of clustering
    const n = data.length;
    const dims = data[0].length;
    let clusters = new Array(n).fill(0);

    // Initialize centroids: first k points
    let centroids = data.slice(0, Math.min(k, n)).map((p) => [...p]);

    // Run a few iterations to converge
    for (let iter = 0; iter < 5; iter++) {
      const newCentroids = Array.from({ length: centroids.length }, () =>
        Array(dims).fill(0),
      );
      const counts = new Array(centroids.length).fill(0);

      // Assign each point to nearest centroid
      for (let i = 0; i < n; i++) {
        let bestCluster = 0;
        let bestDistance = Infinity;

        for (let c = 0; c < centroids.length; c++) {
          let distance = 0;
          for (let j = 0; j < dims; j++) {
            distance += (data[i][j] - centroids[c][j]) ** 2;
          }
          if (distance < bestDistance) {
            bestDistance = distance;
            bestCluster = c;
          }
        }

        clusters[i] = bestCluster;
        counts[bestCluster]++;
        for (let j = 0; j < dims; j++) {
          newCentroids[bestCluster][j] += data[i][j];
        }
      }

      // Update centroids
      for (let c = 0; c < centroids.length; c++) {
        if (counts[c] > 0) {
          for (let j = 0; j < dims; j++) {
            centroids[c][j] = newCentroids[c][j] / counts[c];
          }
        }
      }
    }

    return { clusters };
  }),
}));

describe('estimateK', () => {
  it('returns sqrt of file count', () => {
    expect(estimateK(100)).toBe(10);
  });
  it('caps at 50', () => {
    expect(estimateK(10000)).toBe(50);
  });
  it('has a floor of 1', () => {
    expect(estimateK(0)).toBe(1);
  });
});

describe('clusterFiles', () => {
  it('returns one ClusterAssignment per vector', () => {
    const vectors = [
      { filePath: '/a.txt', vector: [1, 0] },
      { filePath: '/b.txt', vector: [0, 1] },
      { filePath: '/c.txt', vector: [1, 0.1] },
    ];
    const result = clusterFiles(vectors, 2);
    expect(result).toHaveLength(3);
    expect(result.every((r: { clusterId: number }) => typeof r.clusterId === 'number')).toBe(true);
  });

  it('groups similar vectors into the same cluster', () => {
    const vectors = [
      { filePath: '/a.txt', vector: [10, 0] },
      { filePath: '/b.txt', vector: [10.1, 0] },
      { filePath: '/c.txt', vector: [0, 10] },
      { filePath: '/d.txt', vector: [0, 10.1] },
    ];
    const result = clusterFiles(vectors, 2);
    const abCluster = result.find((r: { filePath: string }) => r.filePath === '/a.txt')!.clusterId;
    const abCluster2 = result.find((r: { filePath: string }) => r.filePath === '/b.txt')!.clusterId;
    const cdCluster = result.find((r: { filePath: string }) => r.filePath === '/c.txt')!.clusterId;
    const cdCluster2 = result.find((r: { filePath: string }) => r.filePath === '/d.txt')!.clusterId;
    expect(abCluster).toBe(abCluster2);
    expect(cdCluster).toBe(cdCluster2);
    expect(abCluster).not.toBe(cdCluster);
  });

  it('uses estimateK when k not provided', () => {
    const vectors = Array.from({ length: 9 }, (_, i) => ({
      filePath: `/file${i}.txt`,
      vector: [Math.random(), Math.random()],
    }));
    const result = clusterFiles(vectors);
    expect(result).toHaveLength(9);
  });
});

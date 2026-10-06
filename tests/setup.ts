// Pre-mock ml-kmeans before tests load it
jest.mock('ml-kmeans', () => ({
  kmeans: jest.fn((data: number[][], k: number) => {
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

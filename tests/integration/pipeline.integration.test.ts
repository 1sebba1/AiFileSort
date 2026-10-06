import os from 'os';
import path from 'path';
import fsp from 'fs/promises';
import { OllamaClient } from '../../src/main/ollama/ollamaClient';
import { scanDirectory } from '../../src/main/scanner/fileScanner';
import { extractContent } from '../../src/main/extractor/contentExtractor';
import { embedFiles } from '../../src/main/embedding/embeddingEngine';
import { clusterFiles } from '../../src/main/clustering/clusteringEngine';
import { reasonClusters } from '../../src/main/reasoning/llmReasoner';

const client = new OllamaClient();
let skipAll = false;

beforeAll(async () => {
  const healthy = await client.checkHealth();
  if (!healthy) {
    console.warn('Ollama not running — skipping integration tests');
    skipAll = true;
  }
});

describe('Full pipeline integration', () => {
  let tmpDir: string;

  beforeEach(async () => {
    if (skipAll) return;
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aifilesort-test-'));
    await fsp.writeFile(path.join(tmpDir, 'invoice_jan.txt'), 'Invoice for January services rendered. Total: $500.');
    await fsp.writeFile(path.join(tmpDir, 'invoice_feb.txt'), 'Invoice for February consulting. Total: $750.');
    await fsp.writeFile(path.join(tmpDir, 'readme.md'), '# Project\nThis project does X.');
    await fsp.writeFile(path.join(tmpDir, 'notes.txt'), 'Meeting notes from Monday. Action items: review PR, deploy.');
  });

  afterEach(async () => {
    if (tmpDir) await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('scans, embeds, clusters, and reasons over a small temp directory', async () => {
    if (skipAll) return;

    const files = await scanDirectory(tmpDir, () => {});
    expect(files.length).toBe(4);

    for (const f of files) {
      f.contentSnippet = await extractContent(f);
    }

    const vectors = await embedFiles(files, client, 'nomic-embed-text', 5, () => {}, new AbortController().signal);
    expect(vectors.length).toBeGreaterThan(0);
    expect(vectors[0].vector.length).toBeGreaterThan(0);

    const assignments = clusterFiles(vectors, 2);
    expect(assignments.length).toBe(vectors.length);

    const fileMap = new Map(files.map((f) => [f.absolutePath, f]));
    const suggestions = await reasonClusters(assignments, fileMap, [], client, 'llama3.2:3b', () => {});
    expect(suggestions.length).toBe(vectors.length);
    suggestions.forEach((s) => {
      expect(s.suggestedDestination).toBeTruthy();
      expect(s.status).toBe('pending');
    });
  }, 120_000);
});

import { FileMeta, FileVector } from '@shared/types';
import { OllamaClient } from '../ollama/ollamaClient';

function buildDescription(file: FileMeta): string {
  const date = file.createdAt.toISOString().split('T')[0];
  return [
    `filename: ${file.name}`,
    `type: ${file.mimeType}`,
    `date: ${date}`,
    file.contentSnippet ? `content: ${file.contentSnippet}` : '',
  ].filter(Boolean).join(' | ');
}

// nomic-embed-text is trained with task prefixes; "clustering: " is the one for grouping documents
const TASK_PREFIX = 'clustering: ';

async function embedOne(client: OllamaClient, model: string, text: string): Promise<number[] | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const [vector] = await client.embedBatch(model, [text]);
      return vector;
    } catch {
      // retry once, then give up on this file
    }
  }
  return null;
}

export async function embedFiles(
  files: FileMeta[],
  client: OllamaClient,
  model: string,
  batchSize: number,
  onProgress: (pct: number) => void,
  signal: AbortSignal,
): Promise<FileVector[]> {
  const results: FileVector[] = [];

  for (let i = 0; i < files.length; i += batchSize) {
    if (signal.aborted) break;
    const batch = files.slice(i, i + batchSize);
    const descriptions = batch.map((f) => TASK_PREFIX + buildDescription(f));

    let vectors: (number[] | null)[];
    try {
      vectors = await client.embedBatch(model, descriptions);
    } catch {
      // One bad input fails the whole request — fall back to per-file so only that file is skipped
      vectors = [];
      for (const d of descriptions) {
        if (signal.aborted) break;
        vectors.push(await embedOne(client, model, d));
      }
    }

    vectors.forEach((vector, j) => {
      if (vector) results.push({ filePath: batch[j].absolutePath, vector });
    });

    onProgress(Math.round(((i + batch.length) / files.length) * 100));
  }

  return results;
}

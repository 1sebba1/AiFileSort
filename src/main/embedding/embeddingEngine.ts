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

    // Process each file in the batch
    for (const file of batch) {
      if (signal.aborted) break;

      const description = buildDescription(file);
      let vector: number[] | null = null;

      // Try embed, then retry once
      try {
        vector = await client.embed(model, description);
      } catch {
        try {
          vector = await client.embed(model, description);
        } catch {
          // skip file
          continue;
        }
      }

      results.push({ filePath: file.absolutePath, vector });
    }

    onProgress(Math.round(((i + batch.length) / files.length) * 100));
  }

  return results;
}

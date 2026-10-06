import { ClusterAssignment, FileMeta, FileSuggestion } from '@shared/types';
import { OllamaClient } from '../ollama/ollamaClient';

interface LlmClusterResult {
  suggestedFolder: string;
  confidence: number;
  rationale: string;
}

function buildPrompt(fileNames: string[], existingFolders: string[]): string {
  const folderList = existingFolders.length
    ? `Existing folders: ${existingFolders.join(', ')}.`
    : 'There are no existing folders yet.';

  return `You are a file organisation assistant. Given a list of files, suggest the best folder to group them into.
${folderList}
You may suggest an existing folder or a new one (use "/" for subfolders, e.g. "Documents/Work").

Files in this group:
${fileNames.map((n) => `- ${n}`).join('\n')}

Respond ONLY with valid JSON in this exact format:
{"suggestedFolder": "FolderName", "confidence": 0.85, "rationale": "One sentence explanation."}`;
}

function parseLlmResponse(raw: string): LlmClusterResult {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('no JSON found');
    return JSON.parse(match[0]) as LlmClusterResult;
  } catch {
    return { suggestedFolder: 'Unsorted', confidence: 0, rationale: '' };
  }
}

export async function reasonClusters(
  assignments: ClusterAssignment[],
  fileMap: Map<string, FileMeta>,
  existingFolders: string[],
  client: OllamaClient,
  model: string,
  onProgress: (done: number, total: number) => void,
): Promise<FileSuggestion[]> {
  const clusterMap = new Map<number, string[]>();
  for (const a of assignments) {
    const names = clusterMap.get(a.clusterId) ?? [];
    names.push(fileMap.get(a.filePath)?.name ?? a.filePath.split('/').pop() ?? a.filePath);
    clusterMap.set(a.clusterId, names);
  }

  const clusterResults = new Map<number, LlmClusterResult>();
  const clusterIds = Array.from(clusterMap.keys());

  for (let i = 0; i < clusterIds.length; i++) {
    const clusterId = clusterIds[i];
    const fileNames = clusterMap.get(clusterId)!;
    const prompt = buildPrompt(fileNames, existingFolders);
    try {
      const raw = await client.chat(model, prompt);
      clusterResults.set(clusterId, parseLlmResponse(raw));
    } catch {
      clusterResults.set(clusterId, { suggestedFolder: 'Unsorted', confidence: 0, rationale: '' });
    }
    onProgress(i + 1, clusterIds.length);
  }

  return assignments.map((a) => {
    const cr = clusterResults.get(a.clusterId) ?? { suggestedFolder: 'Unsorted', confidence: 0, rationale: '' };
    return {
      filePath: a.filePath,
      clusterId: a.clusterId,
      suggestedDestination: cr.suggestedFolder,
      rationale: cr.rationale,
      confidence: cr.confidence,
      status: 'pending',
    };
  });
}

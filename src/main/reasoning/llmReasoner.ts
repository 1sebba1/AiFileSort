import { ClusterAssignment, FileMeta, FileSuggestion, AtomicFolder } from '@shared/types';
import { OllamaClient } from '../ollama/ollamaClient';

interface LlmClusterResult {
  suggestedFolder: string;
  confidence: number;
  rationale: string;
}

const CATEGORY_HINTS = `
Common category patterns (use these as guidance):
- Games: Steam, Epic, GOG, Ubisoft, EA, game installers, .pak files, game data folders
- Software/Apps: setup wizards, .exe/.msi installers, application packages
- Development: IDEs, SDKs, source code, node_modules, repositories, compilers
- Documents: PDFs, Word/Excel/PowerPoint files, text files, spreadsheets
- Media/Photos: images (.jpg, .png, .raw), screenshots, wallpapers
- Video: .mp4, .mkv, .avi, .mov files, recorded content
- Music/Audio: .mp3, .flac, .wav, music libraries
- Archives: .zip, .rar, .7z, .tar files, compressed downloads
- Drivers/Firmware: hardware drivers, BIOS updates, firmware files
- Fonts: .ttf, .otf, .woff font files
`.trim();

function buildPrompt(filePaths: string[], existingFolders: string[]): string {
  const folderList = existingFolders.length
    ? `Existing folders (STRONGLY prefer these over creating new ones):\n${existingFolders.map((f) => `  - ${f}`).join('\n')}`
    : 'No existing folders yet — you may create one.';

  return `You are a file organisation assistant. Given a group of related files, suggest the single best folder to move them into.

${folderList}

${CATEGORY_HINTS}

Files in this group (shown as relative paths — the path gives context about where they came from):
${filePaths.map((p) => `- ${p}`).join('\n')}

Rules:
1. If an existing folder fits well, use it — do not create a new one unnecessarily.
2. Use "/" for subfolders only when genuinely needed (e.g. "Documents/Work").
3. Be specific: "Games" is better than "Misc", "Drivers" is better than "Software".

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

function buildAtomicPrompt(folder: AtomicFolder, existingFolders: string[]): string {
  const folderList = existingFolders.length
    ? `Existing folders (STRONGLY prefer these):\n${existingFolders.map((f) => `  - ${f}`).join('\n')}`
    : 'No existing folders yet.';
  const hints = [
    folder.hasExecutable ? 'contains executables (likely software or a game)' : null,
    `${folder.fileCount}+ files`,
  ].filter(Boolean).join(', ');

  return `You are a file organisation assistant. Suggest where to move this entire folder as a single unit (do not move individual files inside it).

${folderList}

${CATEGORY_HINTS}

Folder name: "${folder.name}"
Characteristics: ${hints}

Rules:
1. Prefer an existing folder if one fits.
2. Be specific: "Games" beats "Misc", "Software" beats "Files".

Respond ONLY with valid JSON:
{"suggestedFolder": "FolderName", "confidence": 0.85, "rationale": "One sentence explanation."}`;
}

export async function categorizeAtomicFolders(
  folders: AtomicFolder[],
  existingFolders: string[],
  client: OllamaClient,
  model: string,
  onProgress: (done: number, total: number) => void,
): Promise<FileSuggestion[]> {
  const suggestions: FileSuggestion[] = [];
  for (let i = 0; i < folders.length; i++) {
    const folder = folders[i];
    const prompt = buildAtomicPrompt(folder, existingFolders);
    let result: LlmClusterResult;
    try {
      const raw = await client.chat(model, prompt);
      result = parseLlmResponse(raw);
    } catch {
      result = { suggestedFolder: 'Unsorted', confidence: 0, rationale: '' };
    }
    suggestions.push({
      filePath: folder.absolutePath,
      clusterId: -1,
      suggestedDestination: result.suggestedFolder,
      rationale: result.rationale,
      confidence: result.confidence,
      status: 'pending',
      isAtomicFolder: true,
    });
    onProgress(i + 1, folders.length);
  }
  return suggestions;
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
    const meta = fileMap.get(a.filePath);
    // Use relative path from the scan root for richer context; fall back to basename
    const label = meta ? a.filePath.replace(/\\/g, '/') : a.filePath;
    const paths = clusterMap.get(a.clusterId) ?? [];
    paths.push(label);
    clusterMap.set(a.clusterId, paths);
  }

  const clusterResults = new Map<number, LlmClusterResult>();
  const clusterIds = Array.from(clusterMap.keys());

  for (let i = 0; i < clusterIds.length; i++) {
    const clusterId = clusterIds[i];
    const filePaths = clusterMap.get(clusterId)!;
    const prompt = buildPrompt(filePaths, existingFolders);
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

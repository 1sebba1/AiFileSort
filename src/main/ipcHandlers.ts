import { ipcMain, dialog } from 'electron';
import path from 'path';
import os from 'os';
import fsp from 'fs/promises';
import { IpcChannels, EMBED_MODEL, OllamaHealth, PullProgress } from '@shared/types';
import { OllamaClient } from './ollama/ollamaClient';
import { scanDirectory, detectAtomicFolders } from './scanner/fileScanner';
import { extractContent } from './extractor/contentExtractor';
import { embedFiles } from './embedding/embeddingEngine';
import { clusterFiles } from './clustering/clusteringEngine';
import { reasonClusters, categorizeAtomicFolders } from './reasoning/llmReasoner';
import { executeApproved, undoManifest } from './executor/fileExecutor';
import { FileMeta, FileSuggestion } from '@shared/types';
import { BrowserWindow } from 'electron';

const ollamaClient = new OllamaClient();
let scanAbortController: AbortController | null = null;
let currentSuggestions: FileSuggestion[] = [];
const activePulls = new Map<string, Promise<void>>();
const MANIFEST_PATH = path.join(os.tmpdir(), 'aifilesort-undo.json');

export function registerIpcHandlers(win: BrowserWindow): void {
  ipcMain.handle(IpcChannels.SELECT_FOLDER, async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select folder to sort',
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle(IpcChannels.OLLAMA_HEALTH, async (_, { chatModel }: { chatModel: string }): Promise<OllamaHealth> => {
    const healthy = await ollamaClient.checkHealth();
    if (!healthy) return { healthy: false, embedModel: false, chatModel: false };
    const [embedOk, chatOk] = await Promise.all([
      ollamaClient.checkModelAvailable(EMBED_MODEL),
      ollamaClient.checkModelAvailable(chatModel),
    ]);
    return { healthy, embedModel: embedOk, chatModel: chatOk };
  });

  ipcMain.handle(IpcChannels.OLLAMA_PULL, async (_, { model }: { model: string }) => {
    // A second request for the same model joins the download already in progress
    let pull = activePulls.get(model);
    if (!pull) {
      pull = ollamaClient
        .pullModel(model, (status, percent) => {
          const progress: PullProgress = { model, status, percent };
          win.webContents.send(IpcChannels.OLLAMA_PULL_PROGRESS, progress);
        })
        .finally(() => activePulls.delete(model));
      activePulls.set(model, pull);
    }
    try {
      await pull;
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IpcChannels.SCAN_START, async (_, { rootPath, chatModel, k }: { rootPath: string; chatModel: string; k?: number }) => {
    scanAbortController = new AbortController();
    const signal = scanAbortController.signal;

    // Phase: scanning — detect atomic folders first, then walk remaining files
    win.webContents.send(IpcChannels.SCAN_PROGRESS, { phase: 'scanning', current: 0, total: 0 });
    const atomicFolders = await detectAtomicFolders(rootPath);
    const atomicPaths = new Set(atomicFolders.map((f) => f.absolutePath));
    const files = await scanDirectory(rootPath, (count) => {
      win.webContents.send(IpcChannels.SCAN_PROGRESS, { phase: 'scanning', current: count, total: count });
    }, atomicPaths);

    if (signal.aborted) return;

    // Phase: extracting
    for (let i = 0; i < files.length; i++) {
      if (signal.aborted) return;
      files[i].contentSnippet = await extractContent(files[i]);
      win.webContents.send(IpcChannels.SCAN_PROGRESS, { phase: 'extracting', current: i + 1, total: files.length });
    }

    // Phase: embedding
    win.webContents.send(IpcChannels.SCAN_PROGRESS, { phase: 'embedding', current: 0, total: files.length });
    const vectors = await embedFiles(files, ollamaClient, EMBED_MODEL, 32, (pct) => {
      win.webContents.send(IpcChannels.SCAN_PROGRESS, { phase: 'embedding', current: pct, total: 100 });
    }, signal);

    if (signal.aborted) return;

    // Phase: clustering
    win.webContents.send(IpcChannels.SCAN_PROGRESS, { phase: 'clustering', current: 0, total: 1 });
    const assignments = clusterFiles(vectors, k);

    // Phase: reasoning
    const fileMap = new Map<string, FileMeta>(files.map((f) => [f.absolutePath, f]));
    let topLevelFolders: string[] = [];
    try {
      const rootEntries = await fsp.readdir(rootPath, { withFileTypes: true });
      const SKIP = new Set(['.git', 'node_modules', '.svn', '.hg']);
      topLevelFolders = rootEntries
        .filter((e) => e.isDirectory() && !SKIP.has(e.name))
        .map((e) => e.name);
    } catch {
      topLevelFolders = [];
    }
    win.webContents.send(IpcChannels.SCAN_PROGRESS, { phase: 'reasoning', current: 0, total: assignments.length });
    const fileSuggestions = await reasonClusters(assignments, fileMap, topLevelFolders, ollamaClient, chatModel, (done, total) => {
      win.webContents.send(IpcChannels.SCAN_PROGRESS, { phase: 'reasoning', current: done, total });
    }, { rootPath, signal });

    if (signal.aborted) return;

    // Categorize atomic folders (shown separately — not destructured)
    const atomicSuggestions = atomicFolders.length > 0
      ? await categorizeAtomicFolders(atomicFolders, topLevelFolders, ollamaClient, chatModel, () => {}, { rootPath, signal })
      : [];

    const suggestions = [...atomicSuggestions, ...fileSuggestions];
    currentSuggestions = suggestions;
    win.webContents.send(IpcChannels.SCAN_PROGRESS, { phase: 'done', current: suggestions.length, total: suggestions.length });
    win.webContents.send(IpcChannels.SUGGESTIONS_UPDATE, suggestions);
  });

  ipcMain.handle(IpcChannels.SCAN_CANCEL, () => {
    scanAbortController?.abort();
  });

  ipcMain.handle(IpcChannels.SUGGESTION_SET_STATUS, (_, { filePath, status }: { filePath: string; status: FileSuggestion['status'] }) => {
    const s = currentSuggestions.find((s) => s.filePath === filePath);
    if (s) s.status = status;
    return currentSuggestions;
  });

  ipcMain.handle(IpcChannels.EXECUTE_START, async (_, { rootPath }: { rootPath: string }) => {
    const { moved, skipped } = await executeApproved(currentSuggestions, rootPath, MANIFEST_PATH);
    win.webContents.send(IpcChannels.EXECUTE_COMPLETE, { moved, skipped });
  });

  ipcMain.handle(IpcChannels.UNDO_START, async () => {
    const result = await undoManifest(MANIFEST_PATH);
    win.webContents.send(IpcChannels.UNDO_COMPLETE, result);
  });
}

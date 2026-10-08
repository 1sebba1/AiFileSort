import { ipcMain, dialog, shell } from 'electron';
import path from 'path';
import os from 'os';
import { IpcChannels, EMBED_MODEL, OllamaHealth, PullProgress } from '@shared/types';
import { OllamaClient } from './ollama/ollamaClient';
import { executeApproved, undoManifest } from './executor/fileExecutor';
import { FileSuggestion } from '@shared/types';
import { runPipeline } from './pipeline';
import { findSuggestion, trashSuggestion } from './fileActions';
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
    const suggestions = await runPipeline(rootPath, {
      client: ollamaClient,
      chatModel,
      k,
      signal: scanAbortController.signal,
      emit: (progress) => win.webContents.send(IpcChannels.SCAN_PROGRESS, progress),
    });
    if (!suggestions) return;

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

  ipcMain.handle(IpcChannels.FILE_REVEAL, (_, { filePath }: { filePath: string }) => {
    if (findSuggestion(currentSuggestions, filePath)) shell.showItemInFolder(filePath);
  });

  ipcMain.handle(IpcChannels.FILE_TRASH, async (_, { filePath }: { filePath: string }) => {
    const result = await trashSuggestion(currentSuggestions, filePath, {
      confirm: async (s) => {
        const name = path.basename(s.filePath);
        const { response } = await dialog.showMessageBox(win, {
          type: 'warning',
          buttons: ['Move to Recycle Bin', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
          title: 'Delete',
          message: `Move "${name}" to the Recycle Bin?`,
          detail: s.kind === 'folder' ? 'The folder and everything inside it will be moved.' : s.filePath,
        });
        return response === 0;
      },
      trash: (p) => shell.trashItem(p),
    });
    if (result.status === 'failed') {
      dialog.showErrorBox('Could not delete', `${path.basename(filePath)}: ${result.error}`);
    }
    currentSuggestions = result.suggestions;
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

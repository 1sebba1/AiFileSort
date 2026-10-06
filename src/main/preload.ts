import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels } from '../shared/types';

type IpcWrapper = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => void;
const listenerWrappers = new Map<string, Map<(...args: unknown[]) => void, IpcWrapper>>();

contextBridge.exposeInMainWorld('api', {
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  on: (channel: string, cb: (...args: unknown[]) => void) => {
    const wrapper = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => cb(...args);
    if (!listenerWrappers.has(channel)) {
      listenerWrappers.set(channel, new Map());
    }
    listenerWrappers.get(channel)!.set(cb, wrapper);
    ipcRenderer.on(channel, wrapper);
  },
  off: (channel: string, cb: (...args: unknown[]) => void) => {
    const wrapper = listenerWrappers.get(channel)?.get(cb);
    if (wrapper) {
      ipcRenderer.removeListener(channel, wrapper);
      listenerWrappers.get(channel)?.delete(cb);
    }
  },
  IpcChannels,
});

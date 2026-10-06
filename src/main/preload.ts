import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels } from '../shared/types';

contextBridge.exposeInMainWorld('api', {
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  on: (channel: string, cb: (...args: unknown[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => cb(...args));
  },
  off: (channel: string, cb: (...args: unknown[]) => void) => {
    ipcRenderer.removeListener(channel, cb as Parameters<typeof ipcRenderer.removeListener>[1]);
  },
  IpcChannels,
});

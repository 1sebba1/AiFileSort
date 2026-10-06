import { useCallback } from 'react';

declare global {
  interface Window {
    api: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      on: (channel: string, cb: (...args: unknown[]) => void) => void;
      off: (channel: string, cb: (...args: unknown[]) => void) => void;
      IpcChannels: typeof import('@shared/types').IpcChannels;
    };
  }
}

export function useIpc() {
  const invoke = useCallback(
    (channel: string, ...args: unknown[]) => window.api.invoke(channel, ...args),
    [],
  );
  return { invoke, on: window.api.on, off: window.api.off, IpcChannels: window.api.IpcChannels };
}

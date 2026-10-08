import React, { useEffect, useState } from 'react';
import { ExecuteResult, FileSuggestion, SavedScan, ScanProgress } from '@shared/types';
import HomeView from './views/HomeView';
import ScanningView from './views/ScanningView';
import ReviewView from './views/ReviewView';
import ExecutingView from './views/ExecutingView';
import { useIpc } from './hooks/useIpc';

export type AppState = 'loading' | 'home' | 'scanning' | 'review' | 'executing' | 'done';

export interface AppConfig {
  rootPath: string;
  chatModel: string;
  k?: number;
}

/** Which folder the suggestions on screen came from, and when it was scanned */
export interface ScanInfo {
  rootPath: string;
  scannedAt: string;
}

export default function App(): React.JSX.Element {
  const { invoke, IpcChannels } = useIpc();
  const [state, setState] = useState<AppState>('loading');
  const [config, setConfig] = useState<AppConfig>({ rootPath: '', chatModel: 'llama3.1:8b' });
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [suggestions, setSuggestions] = useState<FileSuggestion[]>([]);
  const [scanInfo, setScanInfo] = useState<ScanInfo | null>(null);
  const [executeResult, setExecuteResult] = useState<ExecuteResult | null>(null);

  // Come back to the last scan (after a reload or restart) instead of starting over
  useEffect(() => {
    invoke(IpcChannels.SESSION_LOAD)
      .then((saved) => {
        const scan = saved as SavedScan | null;
        if (scan) {
          setConfig({ rootPath: scan.rootPath, chatModel: scan.chatModel, k: scan.k });
          setSuggestions(scan.suggestions);
          setScanInfo({ rootPath: scan.rootPath, scannedAt: scan.scannedAt });
          setState('review');
        } else {
          setState('home');
        }
      })
      .catch(() => setState('home'));
  }, []);

  const hasSavedScan = scanInfo !== null && suggestions.length > 0;

  function startScan(): void {
    setProgress(null);
    setState('scanning');
  }

  return (
    <>
      {state === 'loading' && <div style={{ padding: 32, color: '#6b7280' }}>Loading…</div>}
      {state === 'home' && (
        <HomeView
          config={config}
          onConfigChange={setConfig}
          onStart={startScan}
          onContinue={hasSavedScan ? () => setState('review') : undefined}
        />
      )}
      {state === 'scanning' && (
        <ScanningView
          config={config}
          onProgress={setProgress}
          progress={progress}
          onComplete={(s: FileSuggestion[]) => {
            setSuggestions(s);
            setScanInfo({ rootPath: config.rootPath, scannedAt: new Date().toISOString() });
            setState('review');
          }}
          // A cancelled rescan leaves the previous results in place
          onCancel={() => setState(hasSavedScan ? 'review' : 'home')}
        />
      )}
      {state === 'review' && (
        <ReviewView
          suggestions={suggestions}
          scanInfo={scanInfo}
          onSuggestionsChange={setSuggestions}
          onExecute={() => setState('executing')}
          onRescan={startScan}
          onBack={() => setState('home')}
        />
      )}
      {state === 'executing' && (
        <ExecutingView
          suggestions={suggestions}
          config={config}
          onComplete={(result: ExecuteResult) => {
            setExecuteResult(result);
            setSuggestions(result.remaining);
            setState('done');
          }}
        />
      )}
      {state === 'done' && executeResult && (
        <ExecutingView
          suggestions={suggestions}
          config={config}
          onComplete={() => {}}
          result={executeResult}
          onGoHome={() => setState('home')}
          onContinueReview={suggestions.length > 0 ? () => setState('review') : undefined}
        />
      )}
    </>
  );
}

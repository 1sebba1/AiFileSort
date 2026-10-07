import React, { useState } from 'react';
import { FileSuggestion, ScanProgress } from '@shared/types';
import HomeView from './views/HomeView';
import ScanningView from './views/ScanningView';
import ReviewView from './views/ReviewView';
import ExecutingView from './views/ExecutingView';

export type AppState = 'home' | 'scanning' | 'review' | 'executing' | 'done';

export interface AppConfig {
  rootPath: string;
  chatModel: string;
  k?: number;
}

export default function App(): React.JSX.Element {
  const [state, setState] = useState<AppState>('home');
  const [config, setConfig] = useState<AppConfig>({ rootPath: '', chatModel: 'llama3.1:8b' });
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [suggestions, setSuggestions] = useState<FileSuggestion[]>([]);
  const [executeResult, setExecuteResult] = useState<{ moved: string[]; skipped: string[] } | null>(null);

  return (
    <>
      {state === 'home' && (
        <HomeView
          config={config}
          onConfigChange={setConfig}
          onStart={() => setState('scanning')}
        />
      )}
      {state === 'scanning' && (
        <ScanningView
          config={config}
          onProgress={setProgress}
          progress={progress}
          onComplete={(s: FileSuggestion[]) => { setSuggestions(s); setState('review'); }}
          onCancel={() => setState('home')}
        />
      )}
      {state === 'review' && (
        <ReviewView
          suggestions={suggestions}
          onSuggestionsChange={setSuggestions}
          onExecute={() => setState('executing')}
          onBack={() => setState('home')}
        />
      )}
      {state === 'executing' && (
        <ExecutingView
          suggestions={suggestions}
          config={config}
          onComplete={(result: { moved: string[]; skipped: string[] }) => { setExecuteResult(result); setState('done'); }}
        />
      )}
      {state === 'done' && executeResult && (
        <ExecutingView
          suggestions={suggestions}
          config={config}
          onComplete={() => {}}
          result={executeResult}
          onGoHome={() => setState('home')}
        />
      )}
    </>
  );
}

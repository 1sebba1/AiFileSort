import React, { useEffect } from 'react';
import { FileSuggestion, ScanProgress } from '@shared/types';
import { AppConfig } from '../App';
import { useIpc } from '../hooks/useIpc';
import ProgressBar from '../components/ProgressBar';

interface Props {
  config: AppConfig;
  progress: ScanProgress | null;
  onProgress: (p: ScanProgress) => void;
  onComplete: (suggestions: FileSuggestion[]) => void;
  onCancel: () => void;
}

const phaseLabel: Record<string, string> = {
  scanning: 'Scanning files…',
  extracting: 'Extracting content…',
  embedding: 'Generating embeddings…',
  profiling: 'Learning how your folders are organised…',
  clustering: 'Clustering…',
  reasoning: 'Reasoning with AI…',
  done: 'Done',
};

export default function ScanningView({ config, progress, onProgress, onComplete, onCancel }: Props): React.JSX.Element {
  const { invoke, on, off, IpcChannels } = useIpc();

  useEffect(() => {
    const handleProgress = (p: unknown) => onProgress(p as ScanProgress);
    const handleSuggestions = (s: unknown) => onComplete(s as FileSuggestion[]);
    on(IpcChannels.SCAN_PROGRESS, handleProgress);
    on(IpcChannels.SUGGESTIONS_UPDATE, handleSuggestions);
    invoke(IpcChannels.SCAN_START, { rootPath: config.rootPath, chatModel: config.chatModel, k: config.k });
    return () => {
      off(IpcChannels.SCAN_PROGRESS, handleProgress);
      off(IpcChannels.SUGGESTIONS_UPDATE, handleSuggestions);
    };
  }, []);

  const pct = progress ? (progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0) : 0;

  return (
    <div style={{ padding: 32, maxWidth: 600 }}>
      <h2>Analysing…</h2>
      <p>{progress ? phaseLabel[progress.phase] : 'Starting…'}</p>
      <ProgressBar pct={pct} />
      {progress && <p style={{ color: '#6b7280', marginTop: 8 }}>{progress.current} / {progress.total}</p>}
      <button onClick={() => { invoke(IpcChannels.SCAN_CANCEL); onCancel(); }} style={{ marginTop: 24, padding: '8px 16px' }}>
        Cancel
      </button>
    </div>
  );
}

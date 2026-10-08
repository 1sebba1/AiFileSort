import React, { useEffect } from 'react';
import { ExecuteResult, FileSuggestion } from '@shared/types';
import { AppConfig } from '../App';
import { useIpc } from '../hooks/useIpc';
import ProgressBar from '../components/ProgressBar';

interface Props {
  suggestions: FileSuggestion[];
  config: AppConfig;
  onComplete: (result: ExecuteResult) => void;
  result?: ExecuteResult;
  onGoHome?: () => void;
  /** Shown when unmoved suggestions remain from the same scan */
  onContinueReview?: () => void;
}

export default function ExecutingView({ suggestions, config, onComplete, result, onGoHome, onContinueReview }: Props): React.JSX.Element {
  const { invoke, on, off, IpcChannels } = useIpc();

  useEffect(() => {
    if (result) return;
    const handleComplete = (r: unknown) => onComplete(r as ExecuteResult);
    const handleUndo = () => onGoHome?.();
    on(IpcChannels.EXECUTE_COMPLETE, handleComplete);
    on(IpcChannels.UNDO_COMPLETE, handleUndo);
    invoke(IpcChannels.EXECUTE_START, { rootPath: config.rootPath });
    return () => {
      off(IpcChannels.EXECUTE_COMPLETE, handleComplete);
      off(IpcChannels.UNDO_COMPLETE, handleUndo);
    };
  }, []);

  if (!result) {
    return (
      <div style={{ padding: 32, maxWidth: 600 }}>
        <h2>Moving files…</h2>
        <ProgressBar pct={0} label="Executing moves" />
      </div>
    );
  }

  return (
    <div style={{ padding: 32, maxWidth: 600 }}>
      <h2>Done</h2>
      <p>{result.moved.length} files moved successfully.</p>
      {result.skipped.length > 0 && (
        <div style={{ background: '#fef2f2', padding: 12, borderRadius: 6, marginTop: 8 }}>
          <p style={{ margin: 0, color: '#b91c1c' }}>{result.skipped.length} files could not be moved:</p>
          <ul>{result.skipped.map((f) => <li key={f} style={{ fontFamily: 'monospace', fontSize: 12 }}>{f}</li>)}</ul>
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
        <button
          onClick={() => invoke(IpcChannels.UNDO_START)}
          style={{ padding: '8px 16px', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer' }}
        >
          Undo all moves
        </button>
        {onContinueReview && (
          <button
            onClick={onContinueReview}
            style={{ padding: '8px 16px', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer' }}
          >
            Continue reviewing ({result.remaining.length} left)
          </button>
        )}
        <button
          onClick={onGoHome}
          style={{ padding: '8px 20px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
        >
          Sort another folder
        </button>
      </div>
    </div>
  );
}

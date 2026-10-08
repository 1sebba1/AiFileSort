import React from 'react';
import { PullProgress } from '@shared/types';
import ProgressBar from './ProgressBar';

interface Props {
  ollamaRunning: boolean;
  missingModels: string[];
  pull: PullProgress | null;
  pullError: string | null;
  onRetry: () => void;
}

const panel = (bg: string, border: string): React.CSSProperties => ({
  padding: 16, background: bg, border: `1px solid ${border}`, borderRadius: 8,
});
const retryButton: React.CSSProperties = {
  marginTop: 8, padding: '6px 14px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer',
};

export default function OllamaSetupGuide({ ollamaRunning, missingModels, pull, pullError, onRetry }: Props): React.JSX.Element {
  if (!ollamaRunning) {
    return (
      <div style={panel('#fef2f2', '#fca5a5')}>
        <h3 style={{ margin: '0 0 8px', color: '#b91c1c' }}>Ollama is not running</h3>
        <p style={{ margin: 0 }}>
          AiFileSort needs Ollama to run AI models locally. Install it from{' '}
          <code>https://ollama.com/download</code>, start it, then retry.
        </p>
        <button style={retryButton} onClick={onRetry}>Retry</button>
      </div>
    );
  }

  if (pullError) {
    return (
      <div style={panel('#fef2f2', '#fca5a5')}>
        <h3 style={{ margin: '0 0 8px', color: '#b91c1c' }}>Model download failed</h3>
        <p style={{ margin: 0 }}>{pullError}</p>
        <p style={{ margin: '8px 0 0' }}>Check the model name and your internet connection.</p>
        <button style={retryButton} onClick={onRetry}>Retry download</button>
      </div>
    );
  }

  const label = pull
    ? `Downloading ${pull.model}${pull.percent !== null ? ` — ${pull.percent}%` : ` — ${pull.status}…`}`
    : `Preparing to download ${missingModels.join(', ')}…`;

  return (
    <div style={panel('#eef2ff', '#c7d2fe')}>
      <h3 style={{ margin: '0 0 8px', color: '#4338ca' }}>Installing AI models</h3>
      <p style={{ margin: '0 0 8px' }}>
        This is a one-time download ({missingModels.join(', ')}). Large models can take several minutes.
      </p>
      <ProgressBar pct={pull?.percent ?? 0} label={label} />
    </div>
  );
}

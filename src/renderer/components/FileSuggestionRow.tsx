import React from 'react';
import { FileSuggestion } from '@shared/types';
import FileActionButtons, { FileActions } from './FileActionButtons';

interface Props extends FileActions {
  suggestion: FileSuggestion;
  onChange: (filePath: string, status: FileSuggestion['status']) => void;
}

export default function FileSuggestionRow({ suggestion, onChange, onReveal, onDelete }: Props): React.JSX.Element {
  const name = suggestion.filePath.split(/[/\\]/).pop() ?? suggestion.filePath;
  const statusColor = suggestion.status === 'approved' ? '#dcfce7' : suggestion.status === 'rejected' ? '#fee2e2' : '#f3f4f6';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', background: statusColor, borderRadius: 4, paddingLeft: 8 }}>
      <span style={{ flex: 1, fontFamily: 'monospace', fontSize: 13 }} title={suggestion.filePath}>{name}</span>
      <span style={{ color: '#6b7280', fontSize: 12 }}>→ {suggestion.suggestedDestination}</span>
      <span style={{ color: '#9ca3af', fontSize: 11 }}>{Math.round(suggestion.confidence * 100)}%</span>
      <FileActionButtons filePath={suggestion.filePath} onReveal={onReveal} onDelete={onDelete} compact />
      <button onClick={() => onChange(suggestion.filePath, 'approved')} style={{ padding: '2px 8px', background: '#22c55e', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>✓</button>
      <button onClick={() => onChange(suggestion.filePath, 'rejected')} style={{ padding: '2px 8px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>✗</button>
    </div>
  );
}

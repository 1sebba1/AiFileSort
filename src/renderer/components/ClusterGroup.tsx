import React, { useState } from 'react';
import { FileSuggestion } from '@shared/types';
import FileSuggestionRow from './FileSuggestionRow';

interface Props {
  destination: string;
  rationale: string;
  confidence: number;
  files: FileSuggestion[];
  onChange: (filePath: string, status: FileSuggestion['status']) => void;
  onApproveAll: () => void;
  onRejectAll: () => void;
}

export default function ClusterGroup({ destination, rationale, confidence, files, onChange, onApproveAll, onRejectAll }: Props): React.JSX.Element {
  const [expanded, setExpanded] = useState(true);

  return (
    <div style={{ marginBottom: 16, border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: '#f9fafb', cursor: 'pointer' }}
        onClick={() => setExpanded((e) => !e)}
      >
        <span style={{ fontWeight: 600 }}>{destination}</span>
        <span style={{ color: '#6b7280', fontSize: 12 }}>{files.length} files · {Math.round(confidence * 100)}%</span>
        <span style={{ flex: 1, color: '#9ca3af', fontSize: 12, fontStyle: 'italic' }}>{rationale}</span>
        <button onClick={(e) => { e.stopPropagation(); onApproveAll(); }} style={{ padding: '2px 10px', background: '#22c55e', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>✓ All</button>
        <button onClick={(e) => { e.stopPropagation(); onRejectAll(); }} style={{ padding: '2px 10px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>✗ All</button>
        <span>{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && (
        <div style={{ padding: '0 12px 8px' }}>
          {files.map((f) => <FileSuggestionRow key={f.filePath} suggestion={f} onChange={onChange} />)}
        </div>
      )}
    </div>
  );
}

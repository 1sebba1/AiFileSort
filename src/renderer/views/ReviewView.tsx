import React from 'react';
import { FileSuggestion } from '@shared/types';
import { useIpc } from '../hooks/useIpc';
import ClusterGroup from '../components/ClusterGroup';

interface Props {
  suggestions: FileSuggestion[];
  onSuggestionsChange: (s: FileSuggestion[]) => void;
  onExecute: () => void;
  onBack: () => void;
}

export default function ReviewView({ suggestions, onSuggestionsChange, onExecute, onBack }: Props): React.JSX.Element {
  const { invoke, IpcChannels } = useIpc();

  function setStatus(filePath: string, status: FileSuggestion['status']): void {
    invoke(IpcChannels.SUGGESTION_SET_STATUS, { filePath, status }).then((updated) => {
      onSuggestionsChange(updated as FileSuggestion[]);
    });
  }

  function setAllInCluster(clusterId: number, status: FileSuggestion['status']): void {
    const cluster = suggestions.filter((s) => s.clusterId === clusterId);
    let updated = [...suggestions];
    cluster.forEach((s) => {
      updated = updated.map((u) => u.filePath === s.filePath ? { ...u, status } : u);
      invoke(IpcChannels.SUGGESTION_SET_STATUS, { filePath: s.filePath, status });
    });
    onSuggestionsChange(updated);
  }

  const groups = new Map<number, FileSuggestion[]>();
  for (const s of suggestions) {
    const arr = groups.get(s.clusterId) ?? [];
    arr.push(s);
    groups.set(s.clusterId, arr);
  }

  const approvedCount = suggestions.filter((s) => s.status === 'approved').length;

  return (
    <div style={{ padding: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <h2 style={{ margin: 0 }}>Review Suggestions</h2>
        <span style={{ color: '#6b7280' }}>{suggestions.length} files · {approvedCount} approved</span>
        <div style={{ flex: 1 }} />
        <button onClick={onBack} style={{ padding: '8px 16px', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer' }}>Back</button>
        <button
          disabled={approvedCount === 0}
          onClick={onExecute}
          style={{ padding: '8px 20px', background: approvedCount > 0 ? '#6366f1' : '#e5e7eb', color: approvedCount > 0 ? '#fff' : '#9ca3af', border: 'none', borderRadius: 6, cursor: approvedCount > 0 ? 'pointer' : 'not-allowed' }}
        >
          Move {approvedCount} files
        </button>
      </div>
      {Array.from(groups.entries()).map(([clusterId, files]) => (
        <ClusterGroup
          key={clusterId}
          destination={files[0].suggestedDestination}
          rationale={files[0].rationale}
          confidence={files[0].confidence}
          files={files}
          onChange={setStatus}
          onApproveAll={() => setAllInCluster(clusterId, 'approved')}
          onRejectAll={() => setAllInCluster(clusterId, 'rejected')}
        />
      ))}
    </div>
  );
}

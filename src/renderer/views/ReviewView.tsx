import React from 'react';
import { FileSuggestion } from '@shared/types';
import { useIpc } from '../hooks/useIpc';
import ClusterGroup from '../components/ClusterGroup';
import FileActionButtons from '../components/FileActionButtons';
import { looseClusterMembers } from './reviewSelection';

interface Props {
  suggestions: FileSuggestion[];
  onSuggestionsChange: (s: FileSuggestion[]) => void;
  onExecute: () => void;
  onBack: () => void;
}

function DecisionButtons({ status, onChange }: { status: FileSuggestion['status']; onChange: (s: FileSuggestion['status']) => void }): React.JSX.Element {
  const style = (active: boolean, color: string): React.CSSProperties => ({
    padding: '4px 12px', borderRadius: 4, border: 'none', cursor: 'pointer',
    background: active ? color : '#e5e7eb', color: active ? '#fff' : '#374151',
  });
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <button onClick={() => onChange('approved')} style={style(status === 'approved', '#6366f1')}>Approve</button>
      <button onClick={() => onChange('rejected')} style={style(status === 'rejected', '#ef4444')}>Reject</button>
    </div>
  );
}

const sectionHeading: React.CSSProperties = {
  margin: '0 0 12px', color: '#374151', fontSize: 14, textTransform: 'uppercase', letterSpacing: 1,
};

export default function ReviewView({ suggestions, onSuggestionsChange, onExecute, onBack }: Props): React.JSX.Element {
  const { invoke, IpcChannels } = useIpc();

  function setStatus(filePath: string, status: FileSuggestion['status']): void {
    invoke(IpcChannels.SUGGESTION_SET_STATUS, { filePath, status }).then((updated) => {
      onSuggestionsChange(updated as FileSuggestion[]);
    });
  }

  function reveal(filePath: string): void {
    void invoke(IpcChannels.FILE_REVEAL, { filePath });
  }

  // Main process confirms, moves the item to the Recycle Bin and returns the updated list
  function remove(filePath: string): void {
    invoke(IpcChannels.FILE_TRASH, { filePath }).then((updated) => {
      onSuggestionsChange(updated as FileSuggestion[]);
    });
  }

  async function setAllInCluster(clusterId: number, status: FileSuggestion['status']): Promise<void> {
    const cluster = looseClusterMembers(suggestions, clusterId);
    let updated: FileSuggestion[] = suggestions;
    for (const s of cluster) {
      const result = await invoke(IpcChannels.SUGGESTION_SET_STATUS, { filePath: s.filePath, status });
      updated = result as FileSuggestion[];
    }
    onSuggestionsChange(updated);
  }

  const atomicFolders = suggestions.filter((s) => s.kind === 'folder');
  const fileGroups = new Map<number, FileSuggestion[]>();
  for (const s of suggestions.filter((s) => s.kind === 'loose')) {
    const arr = fileGroups.get(s.clusterId) ?? [];
    arr.push(s);
    fileGroups.set(s.clusterId, arr);
  }

  const misfiled = suggestions.filter((s) => s.kind === 'misfiled');

  const approvedCount = suggestions.filter((s) => s.status === 'approved').length;
  const totalCount = suggestions.length;

  return (
    <div style={{ padding: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <h2 style={{ margin: 0 }}>Review Suggestions</h2>
        <span style={{ color: '#6b7280' }}>{totalCount} items · {approvedCount} approved</span>
        <div style={{ flex: 1 }} />
        <button onClick={onBack} style={{ padding: '8px 16px', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer' }}>Back</button>
        <button
          disabled={approvedCount === 0}
          onClick={onExecute}
          style={{ padding: '8px 20px', background: approvedCount > 0 ? '#6366f1' : '#e5e7eb', color: approvedCount > 0 ? '#fff' : '#9ca3af', border: 'none', borderRadius: 6, cursor: approvedCount > 0 ? 'pointer' : 'not-allowed' }}
        >
          Move {approvedCount} items
        </button>
      </div>

      {atomicFolders.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <h3 style={sectionHeading}>
            Folders (moved as a unit)
          </h3>
          {atomicFolders.map((s) => (
            <div key={s.filePath} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', marginBottom: 8, border: '1px solid #e5e7eb', borderRadius: 8, background: '#f9fafb' }}>
              <span style={{ fontSize: 20 }}>📁</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.filePath.split(/[\\/]/).pop()}
                </div>
                <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
                  → {s.suggestedDestination} &nbsp;·&nbsp; {s.rationale}
                </div>
              </div>
              <FileActionButtons filePath={s.filePath} onReveal={reveal} onDelete={remove} />
              <DecisionButtons status={s.status} onChange={(status) => setStatus(s.filePath, status)} />
            </div>
          ))}
        </div>
      )}

      {Array.from(fileGroups.entries()).map(([clusterId, files]) => (
        <ClusterGroup
          key={clusterId}
          destination={files[0].suggestedDestination}
          rationale={files[0].rationale}
          confidence={files[0].confidence}
          files={files}
          onChange={setStatus}
          onApproveAll={() => { void setAllInCluster(clusterId, 'approved'); }}
          onRejectAll={() => { void setAllInCluster(clusterId, 'rejected'); }}
          onReveal={reveal}
          onDelete={remove}
        />
      ))}

      {misfiled.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <h3 style={sectionHeading}>Possibly misfiled</h3>
          <p style={{ margin: '0 0 12px', color: '#6b7280', fontSize: 13 }}>
            These files are already in a folder but look like they belong elsewhere. Review each one — nothing moves unless you approve it.
          </p>
          {misfiled.map((s) => (
            <div key={s.filePath} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', marginBottom: 8, border: '1px solid #fde68a', borderRadius: 8, background: '#fffbeb' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.filePath.split(/[\\/]/).pop()}
                </div>
                <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
                  {s.currentFolder} → <strong>{s.suggestedDestination}</strong> &nbsp;·&nbsp; {Math.round(s.confidence * 100)}% &nbsp;·&nbsp; {s.rationale}
                </div>
              </div>
              <FileActionButtons filePath={s.filePath} onReveal={reveal} onDelete={remove} />
              <DecisionButtons status={s.status} onChange={(status) => setStatus(s.filePath, status)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

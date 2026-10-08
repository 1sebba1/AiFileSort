import React from 'react';

export interface FileActions {
  onReveal: (filePath: string) => void;
  onDelete: (filePath: string) => void;
}

interface Props extends FileActions {
  filePath: string;
  compact?: boolean;
}

/** "Show in Explorer" and "Move to Recycle Bin" for one suggested file or folder */
export default function FileActionButtons({ filePath, onReveal, onDelete, compact }: Props): React.JSX.Element {
  const style: React.CSSProperties = {
    padding: compact ? '2px 8px' : '4px 10px', borderRadius: 4, border: '1px solid #d1d5db',
    background: '#fff', color: '#374151', cursor: 'pointer', fontSize: compact ? 12 : 13,
  };
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <button title="Show in File Explorer" onClick={(e) => { e.stopPropagation(); onReveal(filePath); }} style={style}>
        📂 Show
      </button>
      <button title="Move to Recycle Bin" onClick={(e) => { e.stopPropagation(); onDelete(filePath); }} style={{ ...style, color: '#b91c1c' }}>
        🗑 Delete
      </button>
    </div>
  );
}

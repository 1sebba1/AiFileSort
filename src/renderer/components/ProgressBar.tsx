import React from 'react';

interface Props { pct: number; label?: string; }

export default function ProgressBar({ pct, label }: Props): React.JSX.Element {
  return (
    <div style={{ width: '100%' }}>
      {label && <p style={{ margin: '0 0 4px' }}>{label}</p>}
      <div style={{ background: '#e5e7eb', borderRadius: 4, height: 12 }}>
        <div style={{ background: '#6366f1', width: `${pct}%`, height: '100%', borderRadius: 4, transition: 'width 0.2s' }} />
      </div>
    </div>
  );
}

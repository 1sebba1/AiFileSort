import React from 'react';

interface Props { chatModel: string; embedOk: boolean; chatOk: boolean; }

export default function OllamaSetupGuide({ chatModel, embedOk, chatOk }: Props): React.JSX.Element {
  return (
    <div style={{ padding: 16, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8 }}>
      <h3 style={{ margin: '0 0 8px', color: '#b91c1c' }}>Ollama Setup Required</h3>
      <p>Run these commands in your terminal:</p>
      {!embedOk && <code style={{ display: 'block', background: '#fff', padding: 8, margin: '4px 0' }}>ollama pull nomic-embed-text</code>}
      {!chatOk && <code style={{ display: 'block', background: '#fff', padding: 8, margin: '4px 0' }}>ollama pull {chatModel}</code>}
      <p style={{ marginTop: 8 }}>Then restart AiFileSort.</p>
    </div>
  );
}

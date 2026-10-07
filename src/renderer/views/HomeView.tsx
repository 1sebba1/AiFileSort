import React, { useEffect, useState } from 'react';
import { AppConfig } from '../App';
import { useIpc } from '../hooks/useIpc';
import OllamaSetupGuide from '../components/OllamaSetupGuide';

interface Props {
  config: AppConfig;
  onConfigChange: (c: AppConfig) => void;
  onStart: () => void;
}

export default function HomeView({ config, onConfigChange, onStart }: Props): React.JSX.Element {
  const { invoke, IpcChannels } = useIpc();
  const [health, setHealth] = useState<{ healthy: boolean; embedModel: boolean; chatModel: boolean } | null>(null);

  useEffect(() => {
    invoke(IpcChannels.OLLAMA_HEALTH, { chatModel: config.chatModel }).then((h) =>
      setHealth(h as typeof health),
    );
  }, [config.chatModel]);

  const ready = health?.healthy && health.embedModel && health.chatModel;

  async function browseFolder() {
    const picked = await invoke(IpcChannels.SELECT_FOLDER) as string | null;
    if (picked) onConfigChange({ ...config, rootPath: picked });
  }

  return (
    <div style={{ padding: 32, maxWidth: 600 }}>
      <h1>AiFileSort</h1>
      <div>
        <span>Folder to sort:</span>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <input
            type="text"
            value={config.rootPath}
            readOnly
            onClick={browseFolder}
            style={{ flex: 1, padding: 8, cursor: 'pointer', background: '#f9fafb', border: '1px solid #d1d5db', borderRadius: 4 }}
            placeholder="Click Browse to select a folder…"
          />
          <button
            onClick={browseFolder}
            style={{ padding: '8px 16px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
          >
            Browse
          </button>
        </div>
      </div>
      <label style={{ display: 'block', marginTop: 16 }}>
        <span>Chat model (Ollama):</span>
        <input
          type="text"
          value={config.chatModel}
          onChange={(e) => onConfigChange({ ...config, chatModel: e.target.value })}
          style={{ display: 'block', width: '100%', marginTop: 4, padding: 8 }}
        />
      </label>
      <label style={{ display: 'block', marginTop: 16 }}>
        <span>Number of groups (k, leave blank for auto):</span>
        <input
          type="number"
          value={config.k ?? ''}
          onChange={(e) => onConfigChange({ ...config, k: e.target.value ? Number(e.target.value) : undefined })}
          style={{ display: 'block', width: '100%', marginTop: 4, padding: 8 }}
          min={1}
          max={50}
        />
      </label>
      <div style={{ marginTop: 24 }}>
        {health && !ready && (
          <OllamaSetupGuide
            chatModel={config.chatModel}
            embedOk={health.embedModel}
            chatOk={health.chatModel}
          />
        )}
        <button
          disabled={!ready || !config.rootPath}
          onClick={onStart}
          style={{ marginTop: 16, padding: '10px 24px', background: ready ? '#6366f1' : '#e5e7eb', color: ready ? '#fff' : '#9ca3af', border: 'none', borderRadius: 6, cursor: ready ? 'pointer' : 'not-allowed' }}
        >
          Analyse Folder
        </button>
      </div>
    </div>
  );
}

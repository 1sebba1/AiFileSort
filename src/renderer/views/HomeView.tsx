import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppConfig } from '../App';
import { useIpc } from '../hooks/useIpc';
import OllamaSetupGuide from '../components/OllamaSetupGuide';
import { EMBED_MODEL, OllamaHealth, PullProgress } from '@shared/types';

interface Props {
  config: AppConfig;
  onConfigChange: (c: AppConfig) => void;
  onStart: () => void;
  /** Present when a saved scan can be resumed */
  onContinue?: () => void;
}

const OLLAMA_POLL_MS = 5000;

export default function HomeView({ config, onConfigChange, onStart, onContinue }: Props): React.JSX.Element {
  const { invoke, on, off, IpcChannels } = useIpc();
  const [health, setHealth] = useState<OllamaHealth | null>(null);
  const [pulling, setPulling] = useState(false);
  const [pull, setPull] = useState<PullProgress | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);
  // Edited separately and committed on blur/Enter, so half-typed names never trigger a download
  const [modelDraft, setModelDraft] = useState(config.chatModel);
  const chatModelRef = useRef(config.chatModel);
  chatModelRef.current = config.chatModel;

  const checkHealth = useCallback(async () => {
    const model = chatModelRef.current;
    const h = await invoke(IpcChannels.OLLAMA_HEALTH, { chatModel: model }) as OllamaHealth;
    if (model === chatModelRef.current) setHealth(h); // ignore answers for a model the user has since changed
  }, []);

  const missingModels = health?.healthy
    ? [!health.embedModel && EMBED_MODEL, !health.chatModel && config.chatModel].filter((m): m is string => !!m)
    : [];

  const installModels = useCallback(async (models: string[]) => {
    setPulling(true);
    setPullError(null);
    try {
      for (const model of models) {
        const result = await invoke(IpcChannels.OLLAMA_PULL, { model }) as { ok: boolean; error?: string };
        if (!result.ok) {
          setPullError(`Could not download "${model}": ${result.error}`);
          return;
        }
      }
    } finally {
      // Refresh health before clearing `pulling`, or the auto-install effect would see stale "missing" and pull again
      setPull(null);
      await checkHealth().catch(() => {});
      setPulling(false);
    }
  }, [checkHealth]);

  useEffect(() => {
    setPullError(null);
    checkHealth();
  }, [config.chatModel]);

  // Install missing models automatically; after a failure, wait for the user to press Retry
  useEffect(() => {
    if (missingModels.length && !pulling && !pullError) installModels(missingModels);
  }, [health, pulling, pullError]);

  // Pick Ollama up as soon as the user starts it
  useEffect(() => {
    if (!health || health.healthy) return;
    const timer = setInterval(checkHealth, OLLAMA_POLL_MS);
    return () => clearInterval(timer);
  }, [health]);

  useEffect(() => {
    const onProgress = (p: unknown) => setPull(p as PullProgress);
    on(IpcChannels.OLLAMA_PULL_PROGRESS, onProgress);
    return () => off(IpcChannels.OLLAMA_PULL_PROGRESS, onProgress);
  }, []);

  function commitModel() {
    const model = modelDraft.trim();
    if (model && model !== config.chatModel) onConfigChange({ ...config, chatModel: model });
    else setModelDraft(config.chatModel);
  }

  function retry() {
    setPullError(null);
    checkHealth();
  }

  const ready = health?.healthy && health.embedModel && health.chatModel;

  async function browseFolder() {
    const picked = await invoke(IpcChannels.SELECT_FOLDER) as string | null;
    if (picked) onConfigChange({ ...config, rootPath: picked });
  }

  return (
    <div style={{ padding: 32, maxWidth: 600 }}>
      <h1>AiFileSort</h1>
      {onContinue && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, marginBottom: 16, background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 8 }}>
          <span style={{ flex: 1 }}>You have results from your last scan.</span>
          <button onClick={onContinue} style={{ padding: '6px 14px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
            Continue reviewing
          </button>
        </div>
      )}
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
          value={modelDraft}
          disabled={pulling}
          onChange={(e) => setModelDraft(e.target.value)}
          onBlur={commitModel}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
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
            ollamaRunning={health.healthy}
            missingModels={missingModels}
            pull={pull}
            pullError={pullError}
            onRetry={retry}
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

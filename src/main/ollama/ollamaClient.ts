const OLLAMA_BASE = 'http://localhost:11434';
// Keep models loaded between pipeline phases so each scan doesn't pay the load cost again
const KEEP_ALIVE = '10m';

// Ollama treats "name" and "name:latest" as the same model
function withTag(model: string): string {
  return model.includes(':') ? model : `${model}:latest`;
}

export interface ChatOptions {
  /** JSON schema the response must conform to (Ollama structured outputs) */
  format?: object;
  temperature?: number;
  numCtx?: number;
}

export class OllamaClient {
  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${OLLAMA_BASE}/api/tags`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async checkModelAvailable(model: string): Promise<boolean> {
    try {
      const res = await fetch(`${OLLAMA_BASE}/api/tags`);
      if (!res.ok) return false;
      const data = await res.json() as { models: Array<{ name: string }> };
      const wanted = withTag(model);
      return data.models.some((m) => withTag(m.name) === wanted);
    } catch {
      return false;
    }
  }

  /** Downloads a model via /api/pull, reporting aggregate progress across its layers. Throws on failure. */
  async pullModel(model: string, onProgress: (status: string, percent: number | null) => void): Promise<void> {
    const res = await fetch(`${OLLAMA_BASE}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
    });
    if (!res.ok || !res.body) throw new Error(`Could not download ${model}: ${res.statusText}`);

    // Each layer reports its own total/completed; sum them for one overall percentage
    const layers = new Map<string, { total: number; completed: number }>();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let succeeded = false;

    const handleLine = (line: string): void => {
      if (!line.trim()) return;
      const msg = JSON.parse(line) as { status?: string; error?: string; digest?: string; total?: number; completed?: number };
      if (msg.error) throw new Error(msg.error);
      if (msg.digest && msg.total) layers.set(msg.digest, { total: msg.total, completed: msg.completed ?? 0 });
      if (msg.status === 'success') succeeded = true;
      const isDownloading = msg.status?.startsWith('pulling') && msg.digest;
      let percent: number | null = null;
      if (isDownloading && layers.size) {
        let total = 0;
        let completed = 0;
        for (const l of layers.values()) { total += l.total; completed += l.completed; }
        percent = Math.min(100, Math.round((completed / total) * 100));
      }
      onProgress(isDownloading ? 'downloading' : msg.status ?? '', percent);
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      lines.forEach(handleLine);
    }
    handleLine(buffer);
    if (!succeeded) throw new Error(`Download of ${model} ended unexpectedly`);
  }

  async embed(model: string, text: string): Promise<number[]> {
    const res = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: text }),
    });
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json() as { embedding: number[] };
    return data.embedding;
  }

  /** Embeds many texts in one request via /api/embed; returns vectors in input order. */
  async embedBatch(model: string, texts: string[]): Promise<number[][]> {
    const res = await fetch(`${OLLAMA_BASE}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: texts, truncate: true, keep_alive: KEEP_ALIVE }),
    });
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json() as { embeddings: number[][] };
    if (data.embeddings?.length !== texts.length) throw new Error('embedding count mismatch');
    return data.embeddings;
  }

  async chat(model: string, prompt: string, options: ChatOptions = {}): Promise<string> {
    const modelOptions: Record<string, number> = {};
    if (options.temperature !== undefined) modelOptions.temperature = options.temperature;
    if (options.numCtx !== undefined) modelOptions.num_ctx = options.numCtx;
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        keep_alive: KEEP_ALIVE,
        ...(options.format ? { format: options.format } : {}),
        ...(Object.keys(modelOptions).length ? { options: modelOptions } : {}),
      }),
    });
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json() as { message: { content: string } };
    return data.message.content;
  }
}

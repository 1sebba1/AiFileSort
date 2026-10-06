const OLLAMA_BASE = 'http://localhost:11434';

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
      return data.models.some((m) => m.name.startsWith(model));
    } catch {
      return false;
    }
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

  async chat(model: string, prompt: string): Promise<string> {
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
      }),
    });
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json() as { message: { content: string } };
    return data.message.content;
  }
}

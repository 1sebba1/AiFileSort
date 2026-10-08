import { OllamaClient } from './ollamaClient';

const mockFetch = jest.fn();
global.fetch = mockFetch;

afterEach(() => mockFetch.mockReset());

describe('OllamaClient.checkHealth', () => {
  it('returns true when Ollama responds 200', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    const client = new OllamaClient();
    expect(await client.checkHealth()).toBe(true);
  });

  it('returns false when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const client = new OllamaClient();
    expect(await client.checkHealth()).toBe(false);
  });
});

describe('OllamaClient.embed', () => {
  it('returns embedding vector from Ollama response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embedding: [0.1, 0.2, 0.3] }),
    });
    const client = new OllamaClient();
    const result = await client.embed('nomic-embed-text', 'hello');
    expect(result).toEqual([0.1, 0.2, 0.3]);
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, statusText: 'Not Found' });
    const client = new OllamaClient();
    await expect(client.embed('nomic-embed-text', 'hello')).rejects.toThrow('Not Found');
  });
});

describe('OllamaClient.embedBatch', () => {
  it('posts all inputs to /api/embed and returns vectors in order', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embeddings: [[1], [2]] }),
    });
    const client = new OllamaClient();
    const result = await client.embedBatch('nomic-embed-text', ['a', 'b']);
    expect(result).toEqual([[1], [2]]);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toMatch(/\/api\/embed$/);
    expect(JSON.parse(init.body).input).toEqual(['a', 'b']);
  });

  it('throws when the vector count does not match the input count', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ embeddings: [[1]] }) });
    const client = new OllamaClient();
    await expect(client.embedBatch('nomic-embed-text', ['a', 'b'])).rejects.toThrow('mismatch');
  });
});

describe('OllamaClient.chat', () => {
  it('passes format and model options through to Ollama', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ message: { content: '{}' } }) });
    const client = new OllamaClient();
    const format = { type: 'object' };
    await client.chat('llama3.1:8b', 'hi', { format, temperature: 0.2, numCtx: 4096 });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.format).toEqual(format);
    expect(body.options).toEqual({ temperature: 0.2, num_ctx: 4096 });
  });

  it('returns response text from Ollama', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: { content: 'hello back' } }),
    });
    const client = new OllamaClient();
    const result = await client.chat('llama3.2:3b', 'hello');
    expect(result).toBe('hello back');
  });
});

describe('OllamaClient.checkModelAvailable', () => {
  const tags = { ok: true, json: async () => ({ models: [{ name: 'llama3.2:3b' }, { name: 'nomic-embed-text:latest' }] }) };

  it('matches an untagged name against :latest', async () => {
    mockFetch.mockResolvedValueOnce(tags);
    expect(await new OllamaClient().checkModelAvailable('nomic-embed-text')).toBe(true);
  });

  it('does not treat a different tag of the same family as installed', async () => {
    mockFetch.mockResolvedValueOnce(tags);
    expect(await new OllamaClient().checkModelAvailable('llama3.1:8b')).toBe(false);
  });

  it('does not match on a name prefix', async () => {
    mockFetch.mockResolvedValueOnce(tags);
    expect(await new OllamaClient().checkModelAvailable('llama3')).toBe(false);
  });
});

describe('OllamaClient.pullModel', () => {
  // Splits the NDJSON stream across chunk boundaries the way a real response can
  function streamResponse(lines: object[]) {
    const text = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
    const bytes = new TextEncoder().encode(text);
    const chunks = [bytes.slice(0, 25), bytes.slice(25)];
    let i = 0;
    return {
      ok: true,
      body: { getReader: () => ({ read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined }) }) },
    };
  }

  it('reports overall download percent across layers and resolves on success', async () => {
    mockFetch.mockResolvedValueOnce(streamResponse([
      { status: 'pulling manifest' },
      { status: 'pulling a', digest: 'a', total: 300, completed: 0 },
      { status: 'pulling b', digest: 'b', total: 100, completed: 100 },
      { status: 'pulling a', digest: 'a', total: 300, completed: 300 },
      { status: 'verifying sha256 digest' },
      { status: 'success' },
    ]));
    const updates: Array<[string, number | null]> = [];
    await new OllamaClient().pullModel('m', (s, p) => updates.push([s, p]));
    expect(updates).toEqual([
      ['pulling manifest', null],
      ['downloading', 0],
      ['downloading', 25],
      ['downloading', 100],
      ['verifying sha256 digest', null],
      ['success', null],
    ]);
  });

  it('throws the error Ollama streams back', async () => {
    mockFetch.mockResolvedValueOnce(streamResponse([{ status: 'pulling manifest' }, { error: 'pull model manifest: file does not exist' }]));
    await expect(new OllamaClient().pullModel('nope', () => {})).rejects.toThrow('file does not exist');
  });

  it('throws if the stream ends without success', async () => {
    mockFetch.mockResolvedValueOnce(streamResponse([{ status: 'pulling manifest' }]));
    await expect(new OllamaClient().pullModel('m', () => {})).rejects.toThrow('ended unexpectedly');
  });
});

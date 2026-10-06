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

describe('OllamaClient.chat', () => {
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

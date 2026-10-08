import os from 'os';
import path from 'path';
import fsp from 'fs/promises';
import { OllamaClient } from './ollama/ollamaClient';
import { runPipeline } from './pipeline';
import { ScanProgress } from '@shared/types';

let root: string;

async function write(rel: string, content = 'x'): Promise<void> {
  const full = path.join(root, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, content);
}

// Deterministic "embeddings": finance-ish text → x axis, photos → y axis, everything else → z axis
function fakeClient(): OllamaClient {
  const embed = (text: string) => (/invoice|statement/i.test(text) ? [1, 0, 0] : /IMG_/.test(text) ? [0, 1, 0] : [0, 0, 1]);
  return {
    embedBatch: jest.fn(async (_m: string, texts: string[]) => texts.map(embed)),
    chat: jest.fn(async (_m: string, prompt: string) => {
      if (prompt.includes('may have been filed in the wrong folder')) {
        return JSON.stringify({ rationale: 'It is an invoice.', move: true, suggestedFolder: 'Finance', confidence: 0.9 });
      }
      if (prompt.includes('entire folder')) {
        return JSON.stringify({ rationale: 'An app.', suggestedFolder: 'Software', confidence: 0.8 });
      }
      return JSON.stringify({ rationale: 'Loose files.', suggestedFolder: 'Finance', confidence: 0.7 });
    }),
  } as unknown as OllamaClient;
}

function run(opts: Partial<{ signal: AbortSignal; client: OllamaClient }> = {}) {
  const phases: string[] = [];
  const emit = (p: ScanProgress) => { if (phases[phases.length - 1] !== p.phase) phases.push(p.phase); };
  const promise = runPipeline(root, {
    client: opts.client ?? fakeClient(), chatModel: 'm', signal: opts.signal ?? new AbortController().signal, emit,
  });
  return { promise, phases };
}

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aifs-pipe-'));
});
afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

describe('runPipeline', () => {
  it('produces folder, loose and misfiled suggestions', async () => {
    for (let i = 1; i <= 4; i++) await write(`Finance/statement_${i}.txt`, 'Bank statement for account');
    for (let i = 1; i <= 4; i++) await write(`Photos/IMG_000${i}.jpg`);
    await write('Photos/invoice_march.txt', 'Invoice total due');
    await write('statement_may.txt', 'Bank statement May');
    await write('Tool/tool.exe');
    await write('Tool/lib.dll');

    const { promise, phases } = run();
    const suggestions = (await promise)!;

    expect(suggestions.filter((s) => s.kind === 'folder').map((s) => path.basename(s.filePath))).toEqual(['Tool']);
    expect(suggestions.filter((s) => s.kind === 'loose').map((s) => path.basename(s.filePath))).toEqual(['statement_may.txt']);
    const misfiled = suggestions.filter((s) => s.kind === 'misfiled');
    expect(misfiled).toHaveLength(1);
    expect(misfiled[0]).toMatchObject({ suggestedDestination: 'Finance', currentFolder: 'Photos' });
    expect(path.basename(misfiled[0].filePath)).toBe('invoice_march.txt');
    expect(phases).toEqual(['scanning', 'extracting', 'embedding', 'profiling', 'clustering', 'reasoning']);
  });

  it('handles a root with only organised folders (no loose files)', async () => {
    for (let i = 1; i <= 4; i++) await write(`Finance/statement_${i}.txt`, 'Bank statement');
    const { promise } = run();
    expect(await promise).toEqual([]);
  });

  it('handles an empty root', async () => {
    const client = fakeClient();
    const { promise } = run({ client });
    expect(await promise).toEqual([]);
    expect(client.chat).not.toHaveBeenCalled();
  });

  it('returns null when cancelled', async () => {
    await write('a.txt');
    const controller = new AbortController();
    controller.abort();
    const { promise } = run({ signal: controller.signal });
    expect(await promise).toBeNull();
  });

  it('reports reasoning progress across loose, folder and misfit calls in one counter', async () => {
    for (let i = 1; i <= 4; i++) await write(`Finance/statement_${i}.txt`, 'Bank statement');
    for (let i = 1; i <= 4; i++) await write(`Photos/IMG_000${i}.jpg`);
    await write('Photos/invoice.txt', 'Invoice');
    await write('loose.txt');
    await write('Tool/tool.exe');
    await write('Tool/lib.dll');
    const reasoning: ScanProgress[] = [];
    await runPipeline(root, {
      client: fakeClient(), chatModel: 'm', signal: new AbortController().signal,
      emit: (p) => { if (p.phase === 'reasoning') reasoning.push(p); },
    });
    const last = reasoning[reasoning.length - 1];
    expect(last.total).toBe(3); // 1 loose cluster + 1 atomic folder + 1 misfit candidate
    expect(last.current).toBe(3);
  });
});

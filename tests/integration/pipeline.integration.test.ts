import os from 'os';
import path from 'path';
import fsp from 'fs/promises';
import { OllamaClient } from '../../src/main/ollama/ollamaClient';
import { runPipeline } from '../../src/main/pipeline';

// Uses whatever chat model is installed for tests; override with AIFS_TEST_MODEL
const CHAT_MODEL = process.env.AIFS_TEST_MODEL ?? 'llama3.2:3b';
const client = new OllamaClient();
let skipAll = false;
let root: string;

jest.setTimeout(300_000);

async function write(rel: string, content: string): Promise<void> {
  const full = path.join(root, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, content);
}

beforeAll(async () => {
  const healthy = await client.checkHealth();
  const hasModel = healthy && await client.checkModelAvailable(CHAT_MODEL);
  if (!hasModel) {
    console.warn(`Ollama or ${CHAT_MODEL} unavailable — skipping integration tests`);
    skipAll = true;
  }
});

beforeEach(async () => {
  if (skipAll) return;
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aifs-int-'));
  const months = ['January', 'February', 'March', 'April', 'May'];
  for (const m of months) {
    await write(`Finance/Statement_${m}_2026.txt`, `HSBC current account statement for ${m} 2026. Opening balance £1,240. Closing balance £980. Direct debits, card payments, salary credit.`);
  }
  for (let i = 1; i <= 5; i++) await write(`Photos/IMG_20260${i}01_120000.jpg`, '');
  await write('Photos/Invoice_0042.txt', 'INVOICE #0042. Bill to: Sam. Web design services, 10 hours at £50. Total due: £500. Payment within 30 days.');
  await write('Statement_June_2026.txt', 'HSBC current account statement for June 2026. Opening balance £980. Closing balance £1,105.');
});

afterEach(async () => {
  if (root) await fsp.rm(root, { recursive: true, force: true });
});

describe('Context-aware pipeline (live Ollama)', () => {
  it('files loose statements with the existing Finance folder and flags the invoice in Photos', async () => {
    if (skipAll) return;
    const suggestions = (await runPipeline(root, {
      client, chatModel: CHAT_MODEL, signal: new AbortController().signal, emit: () => {},
    }))!;

    const loose = suggestions.find((s) => s.kind === 'loose' && s.filePath.endsWith('Statement_June_2026.txt'));
    expect(loose?.suggestedDestination.toLowerCase()).toMatch(/^finance/);

    const misfiled = suggestions.filter((s) => s.kind === 'misfiled');
    expect(misfiled.map((s) => path.basename(s.filePath))).toContain('Invoice_0042.txt');
    expect(misfiled.every((s) => s.currentFolder === 'Photos' || s.currentFolder === 'Finance')).toBe(true);
  });
});

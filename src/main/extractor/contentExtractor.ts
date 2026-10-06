import fsp from 'fs/promises';
import path from 'path';
import { FileMeta } from '@shared/types';

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonc', '.csv', '.xml',
  '.yaml', '.yml', '.toml', '.ini', '.env', '.log',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.cs',
  '.html', '.htm', '.css', '.scss', '.sass', '.less',
  '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
  '.sql', '.graphql', '.proto',
]);

const SNIPPET_LENGTH = 500;

export async function extractContent(file: FileMeta): Promise<string> {
  const ext = file.extension.toLowerCase();
  try {
    if (TEXT_EXTENSIONS.has(ext)) {
      return await readTextSnippet(file.absolutePath);
    }
    if (ext === '.pdf') return await readPdf(file.absolutePath);
    if (ext === '.docx') return await readDocx(file.absolutePath);
    if (ext === '.xlsx') return await readXlsx(file.absolutePath);
    return '';
  } catch {
    return '';
  }
}

async function readTextSnippet(filePath: string): Promise<string> {
  const content = await fsp.readFile(filePath, 'utf-8');
  return content.slice(0, SNIPPET_LENGTH);
}

async function readPdf(filePath: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;
  const buf = await fsp.readFile(filePath);
  const data = await pdfParse(buf);
  return data.text.slice(0, SNIPPET_LENGTH);
}

async function readDocx(filePath: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mammoth = require('mammoth') as {
    extractRawText: (opts: { path: string }) => Promise<{ value: string }>;
  };
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value.slice(0, SNIPPET_LENGTH);
}

async function readXlsx(filePath: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require('xlsx') as typeof import('xlsx');
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const text = XLSX.utils.sheet_to_csv(sheet);
  return text.slice(0, SNIPPET_LENGTH);
}

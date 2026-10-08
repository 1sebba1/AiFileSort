import path from 'path';
import { extractContent } from './contentExtractor';
import { FileMeta } from '@shared/types';

function makeMeta(filename: string): FileMeta {
  return {
    absolutePath: path.join(__dirname, '../../../tests/fixtures', filename),
    name: filename,
    extension: path.extname(filename),
    sizeBytes: 100,
    createdAt: new Date(),
    modifiedAt: new Date(),
    mimeType: 'text/plain',
    relativeFolder: '',
  };
}

describe('extractContent', () => {
  it('reads plain text files', async () => {
    const result = await extractContent(makeMeta('sample.txt'));
    expect(result).toContain('plain text fixture');
  });

  it('reads markdown files', async () => {
    const result = await extractContent(makeMeta('sample.md'));
    expect(result).toContain('markdown');
  });

  it('truncates content to 500 chars', async () => {
    const result = await extractContent(makeMeta('sample.txt'));
    expect(result.length).toBeLessThanOrEqual(500);
  });

  it('returns empty string for unsupported extension', async () => {
    const meta = makeMeta('photo.jpg');
    meta.absolutePath = '/fake/photo.jpg';
    const result = await extractContent(meta);
    expect(result).toBe('');
  });

  it('returns empty string if file read fails', async () => {
    const meta = makeMeta('nonexistent.txt');
    meta.absolutePath = '/nonexistent/path/file.txt';
    const result = await extractContent(meta);
    expect(result).toBe('');
  });
});

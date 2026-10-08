import { matchSignature, summarizeSignatures } from './signatures';

describe('matchSignature', () => {
  it.each([
    ['IMG_20260312_101500.jpg', 'Phone camera'],
    ['PXL_20260101_120000123.jpg', 'Google Pixel camera'],
    ['DSC01234.ARW', 'Digital camera'],
    ['20260412_183005.jpg', 'Samsung camera'],
    ['Screenshot 2026-03-01 101500.png', 'Screenshot'],
    ['Screen Shot 2026-03-01 at 10.15.00.png', 'macOS screenshot'],
    ['WhatsApp Image 2026-03-01 at 10.15.00.jpeg', 'WhatsApp'],
    ['photo_2026-03-01_10-15-00.jpg', 'Telegram'],
    ['unknown.png', 'Discord'],
    ['2026-03-01 10-15-00.mkv', 'OBS recording'],
    ['Valorant 2026-03-01 10-15-00.mp4', 'Xbox Game Bar clip'],
    ['zoom_0.mp4', 'Zoom recording'],
    ['SteamSetup.exe', 'Steam'],
    ['EpicInstaller-15.17.1.msi', 'Epic Games'],
    ['setup_cyberpunk_2077_2.1_(64bit)_(70283).exe', 'GOG'],
    ['VSCodeUserSetup-x64-1.95.0.exe', 'Software installer'],
    ['python-3.13.0-amd64.exe', 'Software installer'],
    ['ubuntu-24.04-desktop-amd64.iso', 'Disk image'],
    ['Invoice_0042.pdf', 'Invoice'],
    ['INV-2026-001.pdf', 'Invoice'],
    ['Statement_2026-03.pdf', 'Bank statement'],
    ['P60_2025.pdf', 'Tax document'],
    ['John_Smith_CV.pdf', 'CV / résumé'],
    ['BoardingPass_LHR.pdf', 'Travel document'],
    ['takeout-20260301T101500Z-001.zip', 'Google Takeout'],
    ['scene.blend', 'Blender'],
    ['poster.psd', 'Photoshop'],
    ['Roboto-Regular.ttf', 'Font'],
    ['book.epub', 'E-book'],
  ])('%s → %s', (name, app) => {
    expect(matchSignature(name)?.app).toBe(app);
  });

  it.each(['notes.txt', 'syntax.md', 'image.png', 'report.docx', 'agenda.pdf'])('%s matches nothing', (name) => {
    expect(matchSignature(name)).toBeNull();
  });
});

describe('summarizeSignatures', () => {
  it('groups matches by app, most frequent first, with folder hints', () => {
    const lines = summarizeSignatures(['IMG_0001.jpg', 'IMG_0002.jpg', 'Invoice_1.pdf', 'notes.txt']);
    expect(lines).toEqual([
      'Phone camera — Photos, usually in "Photos" (2 files)',
      'Invoice — Finance, usually in "Finance/Invoices" (1 file)',
    ]);
  });

  it('returns nothing when no file matches', () => {
    expect(summarizeSignatures(['notes.txt'])).toEqual([]);
  });

  it('keeps only the top entries', () => {
    const names = ['a.ttf', 'b.epub', 'c.blend', 'd.psd', 'e.iso', 'f.torrent'];
    expect(summarizeSignatures(names, 3)).toHaveLength(3);
  });
});

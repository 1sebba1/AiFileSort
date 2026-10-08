import { FileMeta } from '@shared/types';
import {
  buildFolderProfiles, describeProfile, isRelatedFolder, profileFolderOf, selectForEmbedding, topFolders,
} from './folderProfiles';

function file(relativeFolder: string, name: string): FileMeta {
  const dir = relativeFolder ? `/root/${relativeFolder}` : '/root';
  return {
    absolutePath: `${dir}/${name}`, name, extension: name.includes('.') ? `.${name.split('.').pop()}` : '',
    sizeBytes: 1, createdAt: new Date(), modifiedAt: new Date(), mimeType: 'x', relativeFolder,
  };
}

describe('profileFolderOf / isRelatedFolder', () => {
  it('truncates to depth 3', () => {
    expect(profileFolderOf('a/b/c/d/e')).toBe('a/b/c');
    expect(profileFolderOf('a')).toBe('a');
    expect(profileFolderOf('')).toBe('');
  });
  it('relates a folder to itself, its ancestors and descendants only', () => {
    expect(isRelatedFolder('Media', 'Media/Photos')).toBe(true);
    expect(isRelatedFolder('Media/Photos', 'Media')).toBe(true);
    expect(isRelatedFolder('Media', 'Media')).toBe(true);
    expect(isRelatedFolder('Media', 'MediaArchive')).toBe(false);
    expect(isRelatedFolder('Media/Photos', 'Media/Video')).toBe(false);
  });
});

describe('selectForEmbedding', () => {
  it('keeps all loose files and caps filed files per profile folder', () => {
    const loose = Array.from({ length: 5 }, (_, i) => file('', `l${i}.txt`));
    const filed = Array.from({ length: 10 }, (_, i) => file('Docs/a/b/c', `f${i}.txt`));
    const other = [file('Music', 'song.mp3')];
    const selected = selectForEmbedding([...loose, ...filed, ...other], 4);
    expect(selected.filter((f) => f.relativeFolder === '')).toHaveLength(5);
    expect(selected.filter((f) => f.relativeFolder === 'Docs/a/b/c')).toHaveLength(4);
    expect(selected.filter((f) => f.relativeFolder === 'Music')).toHaveLength(1);
  });
});

describe('buildFolderProfiles', () => {
  const files = [
    file('Finance/Bank', 'statement1.pdf'),
    file('Finance/Bank', 'statement2.pdf'),
    file('Finance/Bank', 'export.csv'),
    file('Media/Photos', 'IMG_1.jpg'),
    file('', 'loose.txt'),
  ];
  const vectors = new Map<string, number[]>([
    ['/root/Finance/Bank/statement1.pdf', [2, 0]],
    ['/root/Finance/Bank/statement2.pdf', [1, 0]],
    ['/root/Finance/Bank/export.csv', [1, 0]],
    ['/root/Media/Photos/IMG_1.jpg', [0, 5]],
    ['/root/loose.txt', [1, 1]],
  ]);

  it('profiles each folder and its ancestors, ignoring loose files', () => {
    const profiles = buildFolderProfiles(files, vectors);
    expect(profiles.map((p) => p.path)).toEqual(['Finance', 'Finance/Bank', 'Media', 'Media/Photos']);
  });

  it('counts files, ranks extensions and samples names', () => {
    const bank = buildFolderProfiles(files, vectors).find((p) => p.path === 'Finance/Bank')!;
    expect(bank.fileCount).toBe(3);
    expect(bank.topExtensions).toEqual([['.pdf', 2], ['.csv', 1]]);
    expect(bank.sampleNames).toEqual(['export.csv', 'statement1.pdf', 'statement2.pdf']);
  });

  it('builds a unit centroid from unit member vectors and keeps their sum', () => {
    const bank = buildFolderProfiles(files, vectors).find((p) => p.path === 'Finance/Bank')!;
    expect(bank.centroid).toEqual([1, 0]);
    expect(bank.vectorSum).toEqual([3, 0]);
    expect(bank.embeddedCount).toBe(3);
  });

  it('skips files without a vector when building centroids but still counts them', () => {
    const withMissing = [...files, file('Media/Photos', 'broken.jpg')];
    const photos = buildFolderProfiles(withMissing, vectors).find((p) => p.path === 'Media/Photos')!;
    expect(photos.fileCount).toBe(2);
    expect(photos.embeddedCount).toBe(1);
    expect(photos.centroid).toEqual([0, 1]);
  });

  it('omits folders with no embedded files', () => {
    const profiles = buildFolderProfiles([file('Empty', 'x.txt')], new Map());
    expect(profiles).toEqual([]);
  });
});

describe('topFolders', () => {
  const files = [file('A', 'a.txt'), file('B', 'b.txt'), file('C', 'c.txt')];
  const vectors = new Map([
    ['/root/A/a.txt', [1, 0]],
    ['/root/B/b.txt', [0.7, 0.7]],
    ['/root/C/c.txt', [0, 1]],
  ]);
  const profiles = buildFolderProfiles(files, vectors);

  it('ranks folders by cosine similarity', () => {
    const ranked = topFolders(profiles, [1, 0.1], 2);
    expect(ranked.map((r) => r.profile.path)).toEqual(['A', 'B']);
    expect(ranked[0].similarity).toBeGreaterThan(ranked[1].similarity);
  });

  it('honours the exclude filter', () => {
    const ranked = topFolders(profiles, [1, 0], 1, (p) => p.path === 'A');
    expect(ranked.map((r) => r.profile.path)).toEqual(['B']);
  });
});

describe('describeProfile', () => {
  const profile = {
    path: 'Finance/Bank', fileCount: 42, topExtensions: [['.pdf', 38], ['.csv', 4]] as Array<[string, number]>,
    sampleNames: ['Statement_2026-03.pdf', 'x'.repeat(100) + '.csv'], centroid: [], vectorSum: [], embeddedCount: 42,
  };
  it('formats one prompt line and shortens long names', () => {
    const line = describeProfile(profile);
    expect(line).toMatch(/^Finance\/Bank \(42 files: \.pdf ×38, \.csv ×4\) e\.g\. "Statement_2026-03\.pdf", "x+…"$/);
    expect(line.length).toBeLessThan(140);
  });
  it('can omit the samples', () => {
    expect(describeProfile(profile, false)).toBe('Finance/Bank (42 files: .pdf ×38, .csv ×4)');
  });
});

import { FileMeta } from '@shared/types';
import { buildFolderProfiles } from './folderProfiles';
import { findMisfitCandidates } from './misfitDetector';

function file(relativeFolder: string, name: string): FileMeta {
  return {
    absolutePath: `/root/${relativeFolder}/${name}`, name, extension: '.x', sizeBytes: 1,
    createdAt: new Date(), modifiedAt: new Date(), mimeType: 'x', relativeFolder,
  };
}

// Photos: 4 photo-like files + 1 invoice-like outlier; Finance: 4 invoice-like files
function fixture() {
  const files: FileMeta[] = [];
  const vectors = new Map<string, number[]>();
  const add = (folder: string, name: string, v: number[]) => {
    const f = file(folder, name);
    files.push(f);
    vectors.set(f.absolutePath, v);
    return f;
  };
  for (let i = 0; i < 4; i++) add('Photos', `IMG_${i}.jpg`, [0, 1, 0]);
  const invoice = add('Photos', 'invoice.pdf', [1, 0, 0]);
  for (let i = 0; i < 4; i++) add('Finance', `inv${i}.pdf`, [1, 0.05, 0]);
  return { files, vectors, invoice };
}

describe('findMisfitCandidates', () => {
  it('flags a file much closer to another folder than to its own', () => {
    const { files, vectors, invoice } = fixture();
    const result = findMisfitCandidates(files, vectors, buildFolderProfiles(files, vectors));
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe(invoice);
    expect(result[0].current.path).toBe('Photos');
    expect(result[0].alternatives.map((p) => p.path)).toEqual(['Finance']);
    expect(result[0].margin).toBeGreaterThan(0.9);
  });

  it('leaves the file out of its own folder centroid (leave-one-out)', () => {
    // With only 4 files in Photos the outlier is 1/4 of the centroid; leave-one-out keeps ownSim at 0
    const { files, vectors } = fixture();
    const result = findMisfitCandidates(files, vectors, buildFolderProfiles(files, vectors));
    expect(result[0].margin).toBeCloseTo(1 - 0, 1);
  });

  it('ignores folders with fewer than the minimum embedded files', () => {
    const { files, vectors } = fixture();
    const result = findMisfitCandidates(files, vectors, buildFolderProfiles(files, vectors), { minFolderSize: 6 });
    expect(result).toEqual([]);
  });

  it('respects the margin threshold', () => {
    const { files, vectors } = fixture();
    const result = findMisfitCandidates(files, vectors, buildFolderProfiles(files, vectors), { margin: 1.5 });
    expect(result).toEqual([]);
  });

  it('never proposes an ancestor or descendant folder', () => {
    const files: FileMeta[] = [];
    const vectors = new Map<string, number[]>();
    for (let i = 0; i < 4; i++) {
      const f = file('Media', `m${i}.jpg`);
      files.push(f);
      vectors.set(f.absolutePath, [0, 1]);
    }
    for (let i = 0; i < 4; i++) {
      const f = file('Media/Photos', `p${i}.jpg`);
      files.push(f);
      vectors.set(f.absolutePath, [1, 0]);
    }
    const odd = file('Media', 'odd.jpg');
    files.push(odd);
    vectors.set(odd.absolutePath, [1, 0]);
    expect(findMisfitCandidates(files, vectors, buildFolderProfiles(files, vectors))).toEqual([]);
  });

  it('skips files without an embedding and loose files', () => {
    const { files, vectors, invoice } = fixture();
    vectors.delete(invoice.absolutePath);
    const loose = { ...file('', 'x.pdf'), absolutePath: '/root/x.pdf' };
    vectors.set(loose.absolutePath, [1, 0, 0]);
    const all = [...files, loose];
    expect(findMisfitCandidates(all, vectors, buildFolderProfiles(all, vectors))).toEqual([]);
  });

  it('orders by margin and caps the count', () => {
    const files: FileMeta[] = [];
    const vectors = new Map<string, number[]>();
    const add = (folder: string, name: string, v: number[]) => {
      const f = file(folder, name);
      files.push(f);
      vectors.set(f.absolutePath, v);
    };
    for (let i = 0; i < 6; i++) add('A', `a${i}`, [0, 1]);
    add('A', 'strong', [1, 0]);
    add('A', 'weaker', [1, 0.6]);
    for (let i = 0; i < 4; i++) add('B', `b${i}`, [1, 0]);
    const result = findMisfitCandidates(files, vectors, buildFolderProfiles(files, vectors), { maxCandidates: 1 });
    expect(result.map((c) => c.file.name)).toEqual(['strong']);
  });
});

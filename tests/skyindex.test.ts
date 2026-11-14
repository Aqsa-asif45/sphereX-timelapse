import { describe, expect, it } from 'vitest';
import { majorOf } from '../server/src/layout';
import { folderMjd, keyFor, versionsWith, type Folder } from '../server/src/skyindex';

describe('folderMjd', () => {
  it('computes ISO-week dates (2025W01 starts Mon 30 Dec 2024)', () => {
    // MJD of 2024-12-30 = 60674; part 1 adds 0.9 days
    expect(folderMjd('2025W01_1A')).toBeCloseTo(60674.9, 6);
    expect(folderMjd('2025W02_1A')).toBeCloseTo(60681.9, 6);
  });
  it('part 2 is later in the week', () => {
    expect(folderMjd('2025W10_2A')).toBeGreaterThan(folderMjd('2025W10_1A'));
  });
  it('is NaN for bad names', () => expect(folderMjd('junk')).toBeNaN());
});

describe('folder helpers', () => {
  const f = { release: 'qr2', name: '2025W17_4B', base: 'qr2/level2/2025W17_4B/', versions: ['v2', 'v1'], dets: { v1: [1, 2], v2: [2] } } as unknown as Folder;
  it('keyFor builds the S3 key', () => {
    expect(keyFor(f, 'v1', 7, 3, 2)).toBe('qr2/level2/2025W17_4B/v1/2/level2_2025W17_4B_0007_3D2_spx_v1.fits');
  });
  it('versionsWith keeps order and filters by detector', () => {
    expect(versionsWith(f, 2)).toEqual(['v2', 'v1']);
    expect(versionsWith(f, 1)).toEqual(['v1']);
    expect(versionsWith(f, 6)).toEqual([]);
  });
  it('majorOf extracts the pipeline major', () => {
    expect(majorOf('spx-v20-2025-123')).toBe('spx-v20-2025-123'.match(/-(v\d+)-/)![1]);
    expect(majorOf('plain')).toBe('plain');
  });
});

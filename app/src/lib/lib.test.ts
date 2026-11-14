import { describe, expect, it, vi } from 'vitest';
import { positionAt, REF_MJD } from './astro';
import { emit, subscribe } from './events';
import { fmtDec, fmtMjdUtc, fmtRa } from './format';
import { cuts, flagNames, lut, stretch } from './image';

describe('display stretch (must match the shader)', () => {
  it('maps the ends to 0 and 1 and clamps', () => {
    for (const s of ['linear', 'asinh', 'log', 'sqrt'] as const) {
      expect(stretch(0, s)).toBeCloseTo(0, 12);
      expect(stretch(1, s)).toBeCloseTo(1, 12);
      expect(stretch(-5, s)).toBe(stretch(0, s));
      expect(stretch(7, s)).toBe(stretch(1, s));
    }
  });
  it('is monotonic', () => {
    for (const s of ['linear', 'asinh', 'log', 'sqrt'] as const) {
      let prev = -1;
      for (let i = 0; i <= 100; i++) { const v = stretch(i / 100, s); expect(v).toBeGreaterThan(prev); prev = v; }
    }
  });
});

describe('display cuts', () => {
  it('ignores blank (NaN) pixels instead of filling them', () => {
    const d = new Float32Array([NaN, 1, 2, 3, 4, NaN, 5]);
    expect(cuts(d, 'minmax')).toEqual([1, 5]);
  });
  it('falls back to [0, 1] when every pixel is blank', () => {
    expect(cuts(new Float32Array([NaN, NaN]), 'p99.5')).toEqual([0, 1]);
  });
});

describe('colour tables', () => {
  it('inferno starts and ends on its published colours', () => {
    const t = lut('inferno');
    expect(Array.from(t.slice(0, 3))).toEqual([0, 0, 4]);
    expect(Array.from(t.slice(255 * 4, 255 * 4 + 3))).toEqual([0xfc, 0xff, 0xa4]);
  });
});

describe('flag names', () => {
  const defs = { 0: { name: 'TRANSIENT' }, 21: { name: 'SOURCE' }, 26: { name: 'BLOOM' } };
  it('decodes the bits of a SPHEREx flag value', () => {
    expect(flagNames(69206017, defs)).toEqual(['TRANSIENT', 'SOURCE', 'BLOOM']); // 2^0 + 2^21 + 2^26, seen in a real QR3 file
    expect(flagNames(0, defs)).toEqual([]);
    expect(flagNames(-1, defs)).toEqual([]);
  });
});

describe('coordinates and time', () => {
  it('formats the WISE 0855 challenge position', () => {
    expect(fmtRa(133.7951292)).toBe('08h55m10.83s');
    expect(fmtDec(-7.2451472)).toBe('−07°14′42.5″');
  });
  it('carries rounding into the next unit', () => {
    expect(fmtRa(14.99999999)).toBe('01h00m00.00s');
    expect(fmtDec(1.99999999)).toBe('+02°00′00.0″');
  });
  it('converts MJD to UTC', () => {
    expect(fmtMjdUtc(51544.5)).toBe('2000-01-01 12:00 UTC');
  });
  it("puts Barnard's Star where v1 and Astropy do in mid-2026", () => {
    const [ra, dec] = positionAt(269.4520769586187, 4.6933649665767, 51544.5, -801.551, 10362.394, REF_MJD);
    expect(ra.toFixed(5)).toBe('269.44627');
    expect(dec.toFixed(5)).toBe('4.76820');
  });
});

describe('typed events', () => {
  it('stamps every event with an id and a time, and unsubscribes', () => {
    const seen = vi.fn();
    const off = subscribe(seen);
    const e = emit({ type: 'TARGET_SELECTED', slug: 'barnard', name: "Barnard's Star" });
    expect(e.id).toBeTruthy();
    expect(e.at).toBeGreaterThan(0);
    expect(seen).toHaveBeenCalledWith(e);
    off();
    emit({ type: 'TARGET_SELECTED', slug: 'r-dra', name: 'R Draconis' });
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

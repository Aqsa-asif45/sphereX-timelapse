import { describe, expect, it } from 'vitest';
import { encodeGif, makePalette, quantize } from '../web/src/gif';
import { aperture, badFraction, BAD_MASK, combine, LUT, lutCss, normalize, stack, type FrameData } from '../web/src/render';

/** Small deterministic PRNG so noise is reproducible. */
function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const noise = (n: number, seed = 1, amp = 1) => { const r = rng(seed); return Float32Array.from({ length: n }, () => (r() + r() + r() - 1.5) * 2 * amp); };

describe('normalize', () => {
  it('returns null with too few finite samples', () => {
    expect(normalize(new Float32Array(10))).toBeNull();
    expect(normalize(new Float32Array(100).fill(NaN))).toBeNull();
  });
  it('centres on the median and scales by robust sigma', () => {
    const raw = noise(2000, 3).map((v) => v * 4 + 100);
    const f = normalize(raw)!;
    expect(f.med).toBeCloseTo(100, 0);
    expect(f.sig).toBeGreaterThan(0);
    const sorted = [...f.s].sort((a, b) => a - b);
    expect(Math.abs(sorted[sorted.length >> 1])).toBeLessThan(0.1);
  });
  it('is robust to a bright outlier and survives a flat image', () => {
    const raw = noise(2000, 5); raw[10] = 1e6;
    expect(normalize(raw)!.sig).toBeLessThan(5);
    expect(normalize(new Float32Array(500).fill(7))!.sig).toBeGreaterThan(0);
  });
});

describe('stack', () => {
  const fd = (s: number[], flags?: number[]): FrameData => ({ raw: Float32Array.from(s), s: Float32Array.from(s), med: 0, sig: 1, flags: flags && Int32Array.from(flags) });
  it('returns null for no frames', () => expect(stack([])).toBeNull());
  it('averages ordinary values', () => {
    expect(stack([fd([1, 3]), fd([3, 5]), fd([2, 4])])![0]).toBeCloseTo(2);
  });
  it('clips a cosmic-ray outlier', () => {
    const out = stack([fd([0]), fd([0.1]), fd([-0.1]), fd([0.05]), fd([50])])!;
    expect(Math.abs(out[0])).toBeLessThan(0.1);
  });
  it('skips NaN and flagged-bad pixels; NaN if none are usable', () => {
    expect(stack([fd([NaN]), fd([4])])![0]).toBe(4);
    expect(stack([fd([9], [1]), fd([1])])![0]).toBe(1);
    expect(stack([fd([NaN]), fd([NaN])])![0]).toBeNaN();
  });
  it('does not treat informational flag bits as bad', () => {
    expect(BAD_MASK & (1 << 12)).toBe(0);
    expect(BAD_MASK & (1 << 21)).toBe(0);
    expect(stack([fd([5], [1 << 21])])![0]).toBe(5);
  });
});

describe('badFraction / combine', () => {
  it('is null without flags, else the fraction flagged bad', () => {
    const f = (flags?: number[]): FrameData => ({ raw: new Float32Array(2), s: new Float32Array(2), med: 0, sig: 1, flags: flags && Int32Array.from(flags) });
    expect(badFraction([f()])).toBeNull();
    expect([...badFraction([f([1, 0]), f([0, 0])])!]).toEqual([0.5, 0]);
  });
  it('combine subtracts or adds with rescaling', () => {
    const a = Float32Array.of(3, 4), b = Float32Array.of(1, 4);
    expect([...combine(a, b, 'sub')]).toEqual([2, 0]);
    expect(combine(a, b, 'add')[0]).toBeCloseTo(4 / Math.SQRT2, 6);
  });
});

describe('colour map', () => {
  it('runs black to light and clamps lutCss', () => {
    expect([LUT[0], LUT[1], LUT[2]]).toEqual([0, 0, 4]);
    expect(lutCss(-5)).toBe(lutCss(0));
    expect(lutCss(9)).toBe(lutCss(1));
    expect(lutCss(1)).toBe('rgb(252,255,164)');
  });
});

describe('aperture', () => {
  it('is ~0 on flat sky and positive on a source', () => {
    const n = 41, img = new Float32Array(n * n).fill(3);
    expect(Math.abs(aperture(img, n, 20, 20))).toBeLessThan(1e-6);
    img[20 * n + 20] = 20;
    expect(aperture(img, n, 20, 20)).toBeGreaterThan(0);
  });
});

describe('gif', () => {
  it('palette has 256 entries; the heat palette puts the UI colours at 248+', () => {
    expect(makePalette(null)).toHaveLength(768);
    const p = makePalette(LUT);
    expect(p).toHaveLength(768);
    expect([...p.slice(248 * 3, 248 * 3 + 3)]).toEqual([255, 184, 77]);
    expect([...p.slice(255 * 3, 255 * 3 + 3)]).toEqual([255, 122, 107]);
  });
  it('quantize maps exact palette colours to themselves and caches', () => {
    const pal = makePalette(LUT), cache = new Map<number, number>();
    const idx = quantize(new Uint8ClampedArray([255, 184, 77, 255, 255, 255, 255, 255]), pal, cache);
    expect(idx[0]).toBe(248);
    expect(idx[1]).toBe(251);
    expect(cache.size).toBe(2);
  });
  it('encodes a valid GIF89a stream', async () => {
    const w = 4, h = 4, frames = [new Uint8Array(w * h).fill(1), Uint8Array.from({ length: w * h }, (_, i) => i)];
    const bytes = new Uint8Array(await encodeGif(frames, w, h, makePalette(null), 10).arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 6))).toBe('GIF89a');
    expect(bytes[6] | (bytes[7] << 8)).toBe(w);
    expect(bytes[8] | (bytes[9] << 8)).toBe(h);
    expect(bytes.at(-1)).toBe(0x3b);
    expect(String.fromCharCode(...bytes.slice(13 + 768 + 3, 13 + 768 + 14))).toBe('NETSCAPE2.0');
  });
});

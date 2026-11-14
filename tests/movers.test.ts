import { describe, expect, it } from 'vitest';
import { compass, findMovers, type VisitImage } from '../web/src/movers';

const N = 61;
function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

/** A visit image: unit-ish noise plus gaussian stars [x, y, amplitude]. */
function visit(i: number, mjd: number, stars: Array<[number, number, number]>, frames = 10): VisitImage {
  const r = rng(100 + i), s = new Float32Array(N * N);
  for (let k = 0; k < s.length; k++) s[k] = (r() + r() + r() - 1.5) * 2;
  for (const [x, y, a] of stars) for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) s[j * N + k] += a * Math.exp(-((k - x) ** 2 + (j - y) ** 2) / (2 * 1.2 ** 2));
  return { i, mjd, s, frames };
}

describe('compass', () => {
  it('names eight directions and wraps around', () => {
    expect(compass(0)).toBe('north');
    expect(compass(90)).toBe('east');
    expect(compass(180)).toBe('south');
    expect(compass(270)).toBe('west');
    expect(compass(360)).toBe('north');
    expect(compass(44)).toBe('north-east');
  });
});

describe('findMovers', () => {
  it('needs at least two usable visits', () => {
    expect(findMovers([], N)).toEqual([]);
    expect(findMovers([visit(0, 0, [])], N)).toEqual([]);
  });
  it('finds nothing in pure noise', () => {
    const vs = [0, 1, 2].map((i) => visit(i, i * 180, []));
    expect(findMovers(vs, N).filter((f) => f.kind === 'moving')).toEqual([]);
  });
  it('does not flag a stationary star as moving', () => {
    const vs = [0, 1, 2].map((i) => visit(i, i * 180, [[30, 30, 40]]));
    expect(findMovers(vs, N).filter((f) => f.kind === 'moving')).toEqual([]);
  });
  it('detects a star drifting steadily in x', () => {
    const vs = [0, 1, 2].map((i) => visit(i, 60000 + i * 180, [[20 + i * 1.5, 30, 40], [45, 12, 40]]));
    const moving = findMovers(vs, N).filter((f) => f.kind === 'moving');
    expect(moving.length).toBeGreaterThanOrEqual(1);
    const m = moving[0];
    expect(m.shift).toBeGreaterThan(1.5);
    expect(m.x1).toBeGreaterThan(m.x0);
    expect(m.rate).toBeGreaterThan(0);
    expect(compass(m.pa)).toBe('west'); // +x is west (east is left)
    expect(m.sig).toBeGreaterThanOrEqual(4);
  });
});

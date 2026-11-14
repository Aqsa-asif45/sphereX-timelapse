import { describe, expect, it } from 'vitest';
import { coverageOf, exploreQuery, fmtFlux, fmtGap, fmtNum, fmtSpan, groupVisits, measure, median, plural, readExplore, sizeFor, timeColour, type ExploreState } from '../timelens/src/util';

describe('readExplore / exploreQuery', () => {
  it('uses defaults for an empty query string', () => {
    expect(readExplore('')).toEqual({ q: '', fov: 4, mode: 'time', view: 'blink', a: null, b: null, colours: 'all', z: 1 });
  });
  it('reads ra/dec as a query and converts 1-based visits', () => {
    const s = readExplore('?ra=10.5&dec=-3&a=2&b=5&fov=10&mode=spectrum&view=diff&colours=rgb&z=4');
    expect(s).toMatchObject({ q: '10.5 -3', a: 1, b: 4, fov: 10, mode: 'spectrum', view: 'diff', colours: 'rgb', z: 4 });
  });
  it('rejects invalid values and clamps zoom', () => {
    const s = readExplore('?fov=7&mode=nope&view=x&colours=y&a=0&b=abc&z=99');
    expect(s).toMatchObject({ fov: 4, mode: 'time', view: 'blink', colours: 'all', a: null, b: null, z: 16 });
    expect(readExplore('?z=0').z).toBe(1);
  });
  it('truncates long q to 200 chars', () => {
    expect(readExplore('?q=' + 'x'.repeat(500)).q).toHaveLength(200);
  });
  it('round-trips a non-default state', () => {
    const s: ExploreState = { q: 'Barnard\'s Star', fov: 10, mode: 'movers', view: 'side', a: 0, b: 3, colours: 'd2', z: 2.5 };
    expect(readExplore(exploreQuery(s))).toEqual(s);
  });
  it('emits an empty string for the default state and ra/dec for coordinates', () => {
    expect(exploreQuery(readExplore(''))).toBe('');
    expect(exploreQuery({ ...readExplore(''), q: '12.5 -4' })).toBe('?ra=12.5&dec=-4');
  });
});

describe('sizeFor', () => {
  it('is always odd', () => {
    for (const f of [2, 4, 6, 10, 15, 20, 30]) expect(sizeFor(f) % 2).toBe(1);
    expect(sizeFor(4)).toBe(39);
  });
});

describe('formatting', () => {
  it('fmtNum', () => {
    expect(fmtNum(NaN)).toBe('–');
    expect(fmtNum(1234.5)).toBe('1,235');
    expect(fmtNum(3.14159)).toBe('3.14');
    expect(fmtNum(0.000123456)).toBe('0.000123');
  });
  it('fmtFlux picks a unit and includes the error', () => {
    expect(fmtFlux(12.3)).toBe('12.3 µJy');
    expect(fmtFlux(2500, 100)).toBe('2.5 ± 0.1 mJy');
    expect(fmtFlux(-3e6)).toBe('-3 Jy');
    expect(fmtFlux(5, NaN)).toBe('5 µJy');
  });
  it('fmtGap', () => {
    expect(fmtGap(0.5)).toBe('12 h');
    expect(fmtGap(0.01)).toBe('1 h');
    expect(fmtGap(10)).toBe('10 days');
    expect(fmtGap(182)).toBe('6 months');
  });
  it('fmtSpan', () => {
    const d = (y: number, m: number, day: number) => Date.UTC(y, m - 1, day) / 86_400_000 + 40587;
    expect(fmtSpan(d(2025, 9, 12), d(2025, 9, 19))).toBe('12–19 Sep 2025');
    expect(fmtSpan(d(2025, 9, 28), d(2025, 10, 4))).toBe('28 Sep – 4 Oct 2025');
    expect(fmtSpan(d(2025, 12, 30), d(2026, 1, 3))).toBe('30 Dec 2025 – 3 Jan 2026');
    expect(fmtSpan(d(2025, 9, 12), d(2025, 9, 12.2))).toBe('12 Sep 2025');
  });
  it('plural', () => {
    expect(plural(1, 'frame')).toBe('1 frame');
    expect(plural(1500, 'frame')).toBe('1,500 frames');
    expect(plural(2, 'city', 'cities')).toBe('2 cities');
  });
});

describe('timeColour', () => {
  it('goes from blue to amber and handles n = 1', () => {
    expect(timeColour(0, 5)).toBe('rgb(110,195,255)');
    expect(timeColour(4, 5)).toBe('rgb(255,184,77)');
    expect(timeColour(0, 1)).toBe('rgb(255,184,77)');
  });
});

describe('median', () => {
  it('handles empty, odd, even and unsorted input', () => {
    expect(median([])).toBeNaN();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('coverageOf', () => {
  const base = { frames: [1], failed: 0, source: 'irsa', indexed: 0, folders: 0 };
  it('reports each state', () => {
    expect(coverageOf({ ...base, frames: [] }).label).toBe('No SPHEREx images yet');
    expect(coverageOf({ ...base, failed: 2 }).label).toBe('Partial coverage');
    expect(coverageOf({ ...base, source: 'index', indexed: 3, folders: 5 }).label).toBe('Partial coverage');
    expect(coverageOf({ ...base, observations: { available: 2000, checked: 400 } }).label).toBe('Verified, sampled');
    expect(coverageOf({ ...base, observations: { available: 10, checked: 10 } }).label).toBe('Verified coverage');
  });
});

describe('groupVisits (timelens)', () => {
  const f = (mjd: number) => ({ mjd }) as never;
  it('keeps an ordinary pass whole', () => {
    expect(groupVisits([f(0), f(20), f(40)])).toHaveLength(1);
  });
  it('cuts a stretch longer than 100 days into ~45-day visits', () => {
    const frames = Array.from({ length: 30 }, (_, i) => f(i * 20)); // contiguous within 30 d, span 580
    const v = groupVisits(frames);
    expect(v.length).toBeGreaterThan(5);
    expect(v.map((x) => x.i)).toEqual(v.map((_, i) => i));
    expect(v.reduce((n, x) => n + x.frames.length, 0)).toBe(30);
  });
});

describe('measure', () => {
  const n = 41;
  const flat = (v: number) => new Float32Array(n * n).fill(v);
  it('returns ~0 flux on a uniform background', () => {
    const { flux } = measure(flat(5), n, 20, 20);
    expect(Math.abs(flux)).toBeLessThan(1e-6);
  });
  it('measures a positive source above the background', () => {
    const img = flat(1);
    for (let j = 18; j <= 22; j++) for (let i = 18; i <= 22; i++) img[j * n + i] = 11;
    const { flux, err } = measure(img, n, 20, 20);
    expect(flux).toBeGreaterThan(0);
    expect(err).toBe(0); // noiseless annulus
  });
  it('returns NaN when too few valid pixels (edge / NaNs)', () => {
    expect(measure(flat(1), n, -50, -50).flux).toBeNaN();
    expect(measure(flat(NaN), n, 20, 20).err).toBeNaN();
  });
});

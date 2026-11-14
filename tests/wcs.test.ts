import { describe, expect, it } from 'vitest';
import { parseCards } from '../server/src/fits';
import { angDist, northAngle, pixToSky, skyToPix, skyToTan, tanToSky, toEcliptic, wcsFromHeader, type Wcs } from '../server/src/wcs';

const wcs: Wcs = { crpix: [1020, 1020], crval: [150, 2], pc: [-6.15 / 3600, 0, 0, 6.15 / 3600] };

describe('tanToSky / skyToTan', () => {
  it('maps the tangent point to itself', () => {
    const [ra, dec] = tanToSky(150, 20, 0, 0);
    expect(ra).toBeCloseTo(150, 9);
    expect(dec).toBeCloseTo(20, 9);
  });
  it('round-trips', () => {
    const [ra, dec] = tanToSky(10, -30, 0.3, -0.2);
    const [xi, eta] = skyToTan(10, -30, ra, dec)!;
    expect(xi).toBeCloseTo(0.3, 9);
    expect(eta).toBeCloseTo(-0.2, 9);
  });
  it('wraps RA into [0, 360)', () => {
    const [ra] = tanToSky(0.001, 0, -0.01, 0);
    expect(ra).toBeGreaterThanOrEqual(0);
    expect(ra).toBeLessThan(360);
    expect(ra).toBeGreaterThan(359);
  });
  it('returns null on the far hemisphere', () => {
    expect(skyToTan(0, 0, 180, 0)).toBeNull();
  });
});

describe('pixToSky / skyToPix', () => {
  it('CRPIX maps to CRVAL', () => {
    const [ra, dec] = pixToSky(wcs, 1020, 1020);
    expect(ra).toBeCloseTo(150, 9);
    expect(dec).toBeCloseTo(2, 9);
  });
  it('round-trips without SIP', () => {
    const [ra, dec] = pixToSky(wcs, 1500.5, 700.25);
    const [x, y] = skyToPix(wcs, ra, dec)!;
    expect(x).toBeCloseTo(1500.5, 5);
    expect(y).toBeCloseTo(700.25, 5);
  });
  it('+y is north, +x is west (CDELT1 < 0)', () => {
    const [, d0] = pixToSky(wcs, 1020, 1020);
    expect(pixToSky(wcs, 1020, 1120)[1]).toBeGreaterThan(d0);
    expect(pixToSky(wcs, 1120, 1020)[0]).toBeLessThan(150);
  });
  it('applies SIP distortion forward', () => {
    const w: Wcs = { ...wcs, a: [[2, 0, 1e-4]] };
    expect(pixToSky(w, 1520, 1020)[0]).not.toBeCloseTo(pixToSky(wcs, 1520, 1020)[0], 6);
  });
  it('skyToPix applies inverse SIP terms', () => {
    const w: Wcs = { ...wcs, ap: [[1, 0, 0.01]] };
    const [ra, dec] = pixToSky(wcs, 1220, 1020);
    expect(skyToPix(w, ra, dec)![0]).toBeCloseTo(1222, 6);
  });
});

describe('wcsFromHeader', () => {
  it('folds CDELT into PC and defaults PC to identity', () => {
    const h = parseCards(['CRPIX1  = 10', 'CRPIX2  = 20', 'CRVAL1  = 1', 'CRVAL2  = 2', 'CDELT1  = -0.5', 'CDELT2  = 0.5', 'END'].map((c) => c.padEnd(80)).join(''));
    const w = wcsFromHeader(h);
    expect(w.crpix).toEqual([10, 20]);
    expect(w.pc.map((v) => v + 0)).toEqual([-0.5, 0, 0, 0.5]);
    expect(w.a).toBeUndefined();
  });
  it('collects SIP terms, skipping zeros', () => {
    const h = parseCards(['A_2_0   = 1e-5', 'A_0_2   = 0', 'B_1_1   = -2e-6', 'AP_1_0  = 0.1', 'END'].map((c) => c.padEnd(80)).join(''));
    const w = wcsFromHeader(h);
    expect(w.a).toEqual([[2, 0, 1e-5]]);
    expect(w.b).toEqual([[1, 1, -2e-6]]);
    expect(w.ap).toEqual([[1, 0, 0.1]]);
    expect(w.bp).toBeUndefined();
  });
});

describe('angDist', () => {
  it('is zero for identical points and symmetric', () => {
    expect(angDist(10, 20, 10, 20)).toBe(0);
    expect(angDist(10, 20, 30, 40)).toBeCloseTo(angDist(30, 40, 10, 20), 12);
  });
  it('knows quarter and half circles', () => {
    expect(angDist(0, 0, 90, 0)).toBeCloseTo(90, 9);
    expect(angDist(0, 0, 180, 0)).toBeCloseTo(180, 9);
    expect(angDist(0, -90, 123, 90)).toBeCloseTo(180, 9);
  });
  it('handles RA wrap', () => {
    expect(angDist(359.5, 0, 0.5, 0)).toBeCloseTo(1, 9);
  });
});

describe('toEcliptic', () => {
  it('vernal equinox is the origin', () => {
    const [l, b] = toEcliptic(0, 0);
    expect(l).toBeCloseTo(0, 9);
    expect(b).toBeCloseTo(0, 9);
  });
  it('north ecliptic pole is at RA 18h, Dec +66.56°', () => {
    expect(toEcliptic(270, 90 - 23.4392911)[1]).toBeCloseTo(90, 6);
  });
  it('longitude is in [0, 360)', () => {
    const [l] = toEcliptic(300, -40);
    expect(l).toBeGreaterThanOrEqual(0);
    expect(l).toBeLessThan(360);
  });
});

describe('northAngle', () => {
  it('is ~0 for a north-up frame', () => {
    expect(northAngle(wcs, 1020, 1020)).toBeCloseTo(0, 3);
  });
  it('is ~180 for a flipped frame', () => {
    expect(Math.abs(northAngle({ ...wcs, pc: [wcs.pc[0], 0, 0, -wcs.pc[3]] }, 1020, 1020))).toBeCloseTo(180, 3);
  });
});

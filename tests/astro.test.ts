import { describe, expect, it } from 'vitest';
import type { Frame, Target } from '../web/src/api';
import { fmtDateTime, fmtDec, fmtRa, gridOffset, gridToSky, groupVisits, mjdToDate, positionAt, wlColor } from '../web/src/astro';

const frame = (mjd: number): Frame => ({ id: String(mjd), key: '', release: 'qr2', folder: '', version: '', obs: 0, exp: 1, det: 1, mjd, x: 0, y: 0, lambda: 1, dlambda: 0.1, north: 0 });
const target = (o: Partial<Target> = {}): Target => ({ name: 't', ra: 100, dec: 10, epoch: 51544.5, source: '', ...o });

describe('positionAt', () => {
  it('returns the catalogue position without proper motion', () => {
    expect(positionAt(target(), 60000)).toEqual([100, 10]);
  });
  it('applies linear proper motion (mas/yr)', () => {
    const [ra, dec] = positionAt(target({ dec: 0, pmra: 3600e3, pmdec: 3600e3 }), 51544.5 + 365.25);
    expect(dec).toBeCloseTo(1, 9);
    expect(ra).toBeCloseTo(101, 9);
  });
  it('wraps RA below zero', () => {
    expect(positionAt(target({ ra: 0, dec: 0, pmra: -3600e3 }), 51544.5 + 365.25)[0]).toBeCloseTo(359, 9);
  });
});

describe('gridOffset / gridToSky', () => {
  it('zero offset at the centre', () => {
    expect(gridOffset(50, 20, 50, 20, 6.15).map(Math.abs)).toEqual([0, 0]);
  });
  it('north is up (dy<0) and east is left (dx<0)', () => {
    const [dx, dy] = gridOffset(50, 0, 50.01, 0.01, 6.15);
    expect(dx).toBeLessThan(0);
    expect(dy).toBeLessThan(0);
  });
  it('handles RA wrap across 0/360', () => {
    expect(gridOffset(359.999, 0, 0.001, 0, 1)[0]).toBeCloseTo(-7.2, 3);
  });
  it('round-trips with gridToSky for small fields', () => {
    const [ra, dec] = gridToSky(120, 30, 40, -25, 6.15);
    const [dx, dy] = gridOffset(120, 30, ra, dec, 6.15);
    expect(dx).toBeCloseTo(40, 1);
    expect(dy).toBeCloseTo(-25, 1);
  });
});

describe('dates', () => {
  it('MJD 40587 is the Unix epoch', () => {
    expect(mjdToDate(40587).getTime()).toBe(0);
    expect(fmtDateTime(60676.5)).toBe('2025-01-01 12:00 UTC');
  });
});

describe('groupVisits', () => {
  it('returns nothing for no frames', () => expect(groupVisits([])).toEqual([]));
  it('splits at gaps of 30+ days and sorts input', () => {
    const v = groupVisits([frame(200), frame(10), frame(12), frame(205)]);
    expect(v).toHaveLength(2);
    expect(v.map((x) => x.i)).toEqual([0, 1]);
    expect(v[0].frames.map((f) => f.mjd)).toEqual([10, 12]);
    expect(v[0]).toMatchObject({ start: 10, end: 12, mjd: 11 });
    expect(v[1].mjd).toBe(202.5);
  });
  it('chains frames within 30 days of the previous one', () => {
    expect(groupVisits([frame(0), frame(25), frame(50)])).toHaveLength(1);
  });
  it('does not mutate its input', () => {
    const f = [frame(5), frame(1)];
    groupVisits(f);
    expect(f.map((x) => x.mjd)).toEqual([5, 1]);
  });
});

describe('wlColor', () => {
  it('clamps at both ends', () => {
    expect(wlColor(0.1)).toBe('rgb(138,120,255)');
    expect(wlColor(9)).toBe('rgb(255,95,95)');
  });
  it('hits a stop exactly and interpolates between', () => {
    expect(wlColor(1.1)).toBe('rgb(90,150,255)');
    expect(wlColor(1.35)).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
  });
});

describe('fmtRa / fmtDec', () => {
  it('formats sexagesimal', () => {
    expect(fmtRa(0)).toBe('00h00m00.00s');
    expect(fmtRa(180)).toBe('12h00m00.00s');
    expect(fmtDec(-45.5)).toBe('−45°30′00.0″');
    expect(fmtDec(7.25)).toBe('+07°15′00.0″');
  });
});

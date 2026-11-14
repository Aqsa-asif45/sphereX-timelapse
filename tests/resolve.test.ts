import { describe, expect, it } from 'vitest';
import { FEATURED, parseCoords } from '../server/src/resolve';

describe('parseCoords', () => {
  it('parses decimal degrees', () => {
    expect(parseCoords('150.5 2.25')).toEqual({ ra: 150.5, dec: 2.25 });
    expect(parseCoords('10, -45')).toEqual({ ra: 10, dec: -45 });
    expect(parseCoords('10° -45°')).toEqual({ ra: 10, dec: -45 });
  });
  it('parses sexagesimal (RA hours → degrees)', () => {
    const c = parseCoords('12 00 00 +45 30 00')!;
    expect(c.ra).toBeCloseTo(180, 9);
    expect(c.dec).toBeCloseTo(45.5, 9);
    expect(parseCoords('06:00:00 -30:00:00')).toEqual({ ra: 90, dec: -30 });
  });
  it('keeps the sign of declinations like -00 30 00', () => {
    expect(parseCoords('01 00 00 -00 30 00')!.dec).toBeCloseTo(-0.5, 9);
  });
  it('rejects out-of-range values and names', () => {
    expect(parseCoords('360 10')).toBeNull();
    expect(parseCoords('-1 10')).toBeNull();
    expect(parseCoords('10 91')).toBeNull();
    expect(parseCoords('Barnard\'s Star')).toBeNull();
    expect(parseCoords('')).toBeNull();
  });
});

describe('FEATURED', () => {
  it('has unique slugs and a position source for each entry', () => {
    const slugs = FEATURED.map((f) => f.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const f of FEATURED) expect(f.fixed || f.lookup).toBeTruthy();
  });
});

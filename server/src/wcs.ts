/** TAN-SIP world coordinates (FITS papers I/II + the SIP convention), in plain math. Angles in degrees. */
import { type Header, num } from './fits.js';

const D = Math.PI / 180;
type Sip = Array<[number, number, number]>; // [p, q, coefficient]

export interface Wcs {
  crpix: [number, number];
  crval: [number, number];
  /** PC matrix (with CDELT folded in), degrees per pixel: [pc11, pc12, pc21, pc22] */
  pc: [number, number, number, number];
  a?: Sip; b?: Sip; ap?: Sip; bp?: Sip;
}

function sipTerms(h: Header, prefix: 'A' | 'B' | 'AP' | 'BP'): Sip | undefined {
  const out: Sip = [];
  const re = new RegExp(`^${prefix}_(\\d+)_(\\d+)$`);
  for (const [k, v] of h) {
    const m = re.exec(k);
    if (m && typeof v === 'number' && v !== 0) out.push([+m[1], +m[2], v]);
  }
  return out.length ? out : undefined;
}

export function wcsFromHeader(h: Header): Wcs {
  const c1 = num(h, 'CDELT1', 1), c2 = num(h, 'CDELT2', 1);
  return {
    crpix: [num(h, 'CRPIX1'), num(h, 'CRPIX2')],
    crval: [num(h, 'CRVAL1'), num(h, 'CRVAL2')],
    pc: [num(h, 'PC1_1', 1) * c1, num(h, 'PC1_2', 0) * c1, num(h, 'PC2_1', 0) * c2, num(h, 'PC2_2', 1) * c2],
    a: sipTerms(h, 'A'), b: sipTerms(h, 'B'), ap: sipTerms(h, 'AP'), bp: sipTerms(h, 'BP'),
  };
}

const poly = (t: Sip | undefined, u: number, v: number) => {
  if (!t) return 0;
  let s = 0;
  for (const [p, q, c] of t) s += c * u ** p * v ** q;
  return s;
};

/** Gnomonic: standard coordinates (deg) about (ra0, dec0) → sky (deg). */
export function tanToSky(ra0: number, dec0: number, xi: number, eta: number): [number, number] {
  const x = xi * D, y = eta * D, d0 = dec0 * D;
  const den = Math.cos(d0) - y * Math.sin(d0);
  const ra = ra0 + Math.atan2(x, den) / D;
  const dec = Math.atan2(Math.sin(d0) + y * Math.cos(d0), Math.hypot(x, den)) / D;
  return [((ra % 360) + 360) % 360, dec];
}

/** Sky (deg) → standard coordinates (deg) about (ra0, dec0). Null if on the far hemisphere. */
export function skyToTan(ra0: number, dec0: number, ra: number, dec: number): [number, number] | null {
  const a = (ra - ra0) * D, d = dec * D, d0 = dec0 * D;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a);
  if (cosc <= 1e-6) return null;
  return [(Math.cos(d) * Math.sin(a)) / cosc / D, (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a)) / cosc / D];
}

/** FITS pixel (1-based) → sky. */
export function pixToSky(w: Wcs, x: number, y: number): [number, number] {
  const u = x - w.crpix[0], v = y - w.crpix[1];
  const U = u + poly(w.a, u, v), V = v + poly(w.b, u, v);
  const xi = w.pc[0] * U + w.pc[1] * V, eta = w.pc[2] * U + w.pc[3] * V;
  return tanToSky(w.crval[0], w.crval[1], xi, eta);
}

/** Sky → FITS pixel (1-based). Uses the inverse SIP terms (AP/BP) shipped in SPHEREx headers. */
export function skyToPix(w: Wcs, ra: number, dec: number): [number, number] | null {
  const t = skyToTan(w.crval[0], w.crval[1], ra, dec);
  if (!t) return null;
  const [p11, p12, p21, p22] = w.pc, det = p11 * p22 - p12 * p21;
  const U = (p22 * t[0] - p12 * t[1]) / det, V = (-p21 * t[0] + p11 * t[1]) / det;
  const u = U + poly(w.ap, U, V), v = V + poly(w.bp, U, V);
  return [u + w.crpix[0], v + w.crpix[1]];
}

/** Great-circle distance in degrees. */
export function angDist(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const s = Math.sin(((dec2 - dec1) * D) / 2) ** 2 + Math.cos(dec1 * D) * Math.cos(dec2 * D) * Math.sin(((ra2 - ra1) * D) / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(s)))) / D;
}

/** Equatorial (ICRS ≈ J2000) → ecliptic longitude/latitude, degrees. */
export function toEcliptic(ra: number, dec: number): [number, number] {
  const e = 23.4392911 * D, a = ra * D, d = dec * D;
  const lam = Math.atan2(Math.sin(a) * Math.cos(e) + Math.tan(d) * Math.sin(e), Math.cos(a));
  const beta = Math.asin(Math.sin(d) * Math.cos(e) - Math.cos(d) * Math.sin(e) * Math.sin(a));
  return [((lam / D) % 360 + 360) % 360, beta / D];
}

/** Position angle of North in a frame: the rotation the frame needs to be north-up. */
export function northAngle(w: Wcs, x: number, y: number): number {
  const [ra, dec] = pixToSky(w, x, y);
  const p = skyToPix(w, ra, Math.min(89.999, dec + 0.01));
  return p ? Math.atan2(p[0] - x, p[1] - y) / D : 0;
}

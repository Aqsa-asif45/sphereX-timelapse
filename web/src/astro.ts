import type { Frame, Target } from './api';

export const PIXEL_ARCSEC = 6.15;
/** Reference date for centring the view: the middle of the released data (Jan 2026). */
export const REF_MJD = 61040;
const D = Math.PI / 180;

/** Position of a target at a date, applying proper motion (linear; parallax ignored, < 0.1 px). */
export function positionAt(t: Target, mjd: number): [number, number] {
  if (!t.pmra && !t.pmdec) return [t.ra, t.dec];
  const yr = (mjd - t.epoch) / 365.25;
  const dec = t.dec + ((t.pmdec ?? 0) * yr) / 3.6e6;
  const ra = t.ra + ((t.pmra ?? 0) * yr) / 3.6e6 / Math.cos(t.dec * D);
  return [((ra % 360) + 360) % 360, dec];
}

/** Offset of (ra, dec) from the grid centre, in grid pixels (x right, y down; north up, east left). */
export function gridOffset(ra0: number, dec0: number, ra: number, dec: number, scaleArcsec: number): [number, number] {
  const dx = -(((ra - ra0 + 540) % 360) - 180) * Math.cos(dec0 * D) * 3600 / scaleArcsec;
  const dy = -(dec - dec0) * 3600 / scaleArcsec;
  return [dx, dy];
}

/** Grid offset (pixels from centre; x right, y down; north up, east left) → sky (deg), gnomonic. */
export function gridToSky(ra0: number, dec0: number, dx: number, dy: number, scaleArcsec: number): [number, number] {
  const xi = (-dx * scaleArcsec / 3600) * D, eta = (-dy * scaleArcsec / 3600) * D, d0 = dec0 * D;
  const den = Math.cos(d0) - eta * Math.sin(d0);
  const ra = ra0 + Math.atan2(xi, den) / D;
  const dec = Math.atan2(Math.sin(d0) + eta * Math.cos(d0), Math.hypot(xi, den)) / D;
  return [((ra % 360) + 360) % 360, dec];
}

export const mjdToDate = (mjd: number) => new Date((mjd - 40587) * 86_400_000);
export const fmtDate = (mjd: number) => mjdToDate(mjd).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtDateTime = (mjd: number) => mjdToDate(mjd).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

export interface Visit { i: number; frames: Frame[]; mjd: number; start: number; end: number }

/** Group frames into survey visits: SPHEREx passes each spot every ~6 months; a pass lasts days to weeks. */
export function groupVisits(frames: Frame[]): Visit[] {
  const s = [...frames].sort((a, b) => a.mjd - b.mjd);
  const out: Visit[] = [];
  for (const f of s) {
    const v = out[out.length - 1];
    if (v && f.mjd - v.end < 30) { v.frames.push(f); v.end = f.mjd; }
    else out.push({ i: out.length, frames: [f], mjd: 0, start: f.mjd, end: f.mjd });
  }
  for (const v of out) v.mjd = v.frames.reduce((a, f) => a + f.mjd, 0) / v.frames.length;
  return out;
}

/** SPHEREx's six detector bands (approximate ranges, µm). */
export const BANDS = [
  { det: 1, lo: 0.75, hi: 1.09 }, { det: 2, lo: 1.10, hi: 1.62 }, { det: 3, lo: 1.63, hi: 2.41 },
  { det: 4, lo: 2.42, hi: 3.82 }, { det: 5, lo: 3.83, hi: 4.41 }, { det: 6, lo: 4.42, hi: 5.00 },
];

/** Colour for a wavelength across 0.75–5 µm: violet (shortest) → red (longest). */
const STOPS: Array<[number, [number, number, number]]> = [
  [0.75, [138, 120, 255]], [1.1, [90, 150, 255]], [1.6, [70, 205, 215]], [2.4, [120, 220, 120]],
  [3.8, [255, 210, 100]], [4.4, [255, 150, 80]], [5.0, [255, 95, 95]],
];
export function wlColor(lam: number): string {
  if (lam <= STOPS[0][0]) return `rgb(${STOPS[0][1]})`;
  for (let i = 1; i < STOPS.length; i++) if (lam <= STOPS[i][0]) {
    const [l0, c0] = STOPS[i - 1], [l1, c1] = STOPS[i], t = (lam - l0) / (l1 - l0);
    return `rgb(${c0.map((c, k) => Math.round(c + (c1[k] - c) * t))})`;
  }
  return `rgb(${STOPS[STOPS.length - 1][1]})`;
}
export const wlGradient = `linear-gradient(90deg, ${STOPS.map(([l, c]) => `rgb(${c}) ${((l - 0.75) / 4.25) * 100}%`).join(', ')})`;

export function fmtRa(ra: number) {
  const h = ra / 15, hh = Math.floor(h), m = (h - hh) * 60, mm = Math.floor(m), s = (m - mm) * 60;
  return `${String(hh).padStart(2, '0')}h${String(mm).padStart(2, '0')}m${s.toFixed(2).padStart(5, '0')}s`;
}
export function fmtDec(dec: number) {
  const sg = dec < 0 ? '−' : '+', a = Math.abs(dec), d = Math.floor(a), m = (a - d) * 60, mm = Math.floor(m), s = (m - mm) * 60;
  return `${sg}${String(d).padStart(2, '0')}°${String(mm).padStart(2, '0')}′${s.toFixed(1).padStart(4, '0')}″`;
}

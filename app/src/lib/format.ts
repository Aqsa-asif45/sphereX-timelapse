/** Sexagesimal RA, e.g. 17h57m48.50s. */
export function fmtRa(ra: number): string {
  const h = ra / 15;
  let hh = Math.floor(h), mm = Math.floor((h - hh) * 60), ss = ((h - hh) * 60 - mm) * 60;
  if (ss >= 59.995) { ss = 0; mm += 1; }
  if (mm >= 60) { mm = 0; hh = (hh + 1) % 24; }
  return `${String(hh).padStart(2, '0')}h${String(mm).padStart(2, '0')}m${ss.toFixed(2).padStart(5, '0')}s`;
}

/** Sexagesimal Dec with a typographic minus, e.g. −07°14′42.5″. */
export function fmtDec(dec: number): string {
  const sign = dec < 0 ? '−' : '+', a = Math.abs(dec);
  let d = Math.floor(a), m = Math.floor((a - d) * 60), s = ((a - d) * 60 - m) * 60;
  if (s >= 59.95) { s = 0; m += 1; }
  if (m >= 60) { m = 0; d += 1; }
  return `${sign}${String(d).padStart(2, '0')}°${String(m).padStart(2, '0')}′${s.toFixed(1).padStart(4, '0')}″`;
}

/** MJD (UTC) → "2025-08-15 21:45 UTC". MJD 40587 is 1970-01-01. */
export function fmtMjdUtc(mjd: number): string {
  return new Date((mjd - 40587) * 86_400_000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export function fmtNum(v: number | null | undefined, digits = 3): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '–' : v.toFixed(digits);
}

/** A signed number with a typographic minus. */
export function fmtSigned(v: number, digits = 2): string {
  return `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(digits)}`;
}

/** SPHEREx band of a detector (µm), from the archive documentation. */
export const BANDS: Record<number, { lo: number; hi: number; r: number }> = {
  1: { lo: 0.75, hi: 1.09, r: 39 }, 2: { lo: 1.1, hi: 1.62, r: 41 }, 3: { lo: 1.63, hi: 2.41, r: 41 },
  4: { lo: 2.42, hi: 3.82, r: 35 }, 5: { lo: 3.83, hi: 4.41, r: 112 }, 6: { lo: 4.42, hi: 5.0, r: 128 },
};

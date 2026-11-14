/** Mid-2026 (MJD 61040), where searches are centred for moving targets (as in v1). */
export const REF_MJD = 61040;

/**
 * Position at a date from a catalogue position, its epoch and proper motion (mas/yr, pmra includes cos δ).
 * Linear motion; checked against Astropy's full space motion for Barnard's Star: 0.064″ apart at 2026.0.
 */
export function positionAt(ra: number, dec: number, epochMjd: number, pmra: number | null | undefined, pmdec: number | null | undefined, mjd: number): [number, number] {
  if (!pmra && !pmdec) return [ra, dec];
  const yr = (mjd - epochMjd) / 365.25;
  const d = dec + ((pmdec ?? 0) * yr) / 3.6e6;
  const r = ra + ((pmra ?? 0) * yr) / 3.6e6 / Math.cos((dec * Math.PI) / 180);
  return [((r % 360) + 360) % 360, d];
}

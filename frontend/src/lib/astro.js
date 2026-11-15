/** Sky and time helpers (ported from the old site's verified astro.ts). */

export const PIXEL_ARCSEC = 6.15
/** Where a moving star is centred: end of 2025 (the middle of the released data). */
export const REF_MJD = 61040
export const FOVS = [2, 4, 6, 10, 15, 20, 30] // arcmin
export const DEFAULT_FOV = 4
const D = Math.PI / 180

/** Grid size in SPHEREx pixels for a field of view (odd, so the target sits on the centre pixel). */
export const sizeFor = (fovArcmin) => Math.round((fovArcmin * 60) / PIXEL_ARCSEC) | 1

/**
 * Position of a target at a date, applying proper motion (linear; parallax ignored, < 0.1 px).
 * @param {{ra:number, dec:number, epoch_mjd:number, pmra?:number|null, pmdec?:number|null}} t
 */
export function positionAt(t, mjd) {
  if (!t.pmra && !t.pmdec) return [t.ra, t.dec]
  const yr = (mjd - t.epoch_mjd) / 365.25
  const dec = t.dec + ((t.pmdec ?? 0) * yr) / 3.6e6
  const ra = t.ra + ((t.pmra ?? 0) * yr) / 3.6e6 / Math.cos(t.dec * D)
  return [((ra % 360) + 360) % 360, dec]
}

/** Offset of (ra, dec) from the grid centre, in grid pixels (x right, y down; north up, east left). */
export function gridOffset(ra0, dec0, ra, dec, scaleArcsec = PIXEL_ARCSEC) {
  const dx = (-(((ra - ra0 + 540) % 360) - 180) * Math.cos(dec0 * D) * 3600) / scaleArcsec
  const dy = (-(dec - dec0) * 3600) / scaleArcsec
  return [dx, dy]
}

/** Grid offset (pixels from centre; x right, y down) -> sky (degrees), gnomonic. */
export function gridToSky(ra0, dec0, dx, dy, scaleArcsec = PIXEL_ARCSEC) {
  const xi = ((-dx * scaleArcsec) / 3600) * D
  const eta = ((-dy * scaleArcsec) / 3600) * D
  const d0 = dec0 * D
  const den = Math.cos(d0) - eta * Math.sin(d0)
  const ra = ra0 + Math.atan2(xi, den) / D
  const dec = Math.atan2(Math.sin(d0) + eta * Math.cos(d0), Math.hypot(xi, den)) / D
  return [((ra % 360) + 360) % 360, dec]
}

// ── dates ───────────────────────────────────────────────────────────────

export const mjdToDate = (mjd) => new Date((mjd - 40587) * 86_400_000)
const fmt = (mjd, opts) => mjdToDate(mjd).toLocaleDateString('en-GB', { timeZone: 'UTC', ...opts })
export const fmtDate = (mjd) => fmt(mjd, { day: 'numeric', month: 'short', year: 'numeric' })
export const fmtMonth = (mjd) => fmt(mjd, { month: 'short', year: 'numeric' })
/** "3–11 Aug 2025", "28 Aug – 2 Sep 2025", or one date when start and end are the same day. */
export function fmtSpan(a, b) {
  const da = mjdToDate(a)
  const db = mjdToDate(b)
  if (da.toISOString().slice(0, 10) === db.toISOString().slice(0, 10)) return fmtDate(a)
  if (da.getUTCFullYear() === db.getUTCFullYear()) {
    if (da.getUTCMonth() === db.getUTCMonth()) return `${da.getUTCDate()}–${fmtDate(b)}`
    return `${fmt(a, { day: 'numeric', month: 'short' })} – ${fmtDate(b)}`
  }
  return `${fmtDate(a)} – ${fmtDate(b)}`
}
/** A gap between visits in words: "6 months later", "12 days later". */
export function fmtGap(days) {
  if (days >= 45) return `${Math.round(days / 30.44)} months later`
  return `${Math.round(days)} days later`
}
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// ── visits and bands ────────────────────────────────────────────────────

/**
 * Group frames into survey visits: SPHEREx passes each spot about every 6 months; a pass lasts days to
 * weeks. Frames less than 30 days apart belong to the same visit.
 * @returns {Array<{i:number, frames:object[], mjd:number, start:number, end:number}>}
 */
export function groupVisits(frames) {
  const s = [...frames].sort((a, b) => a.mjd - b.mjd)
  const out = []
  for (const f of s) {
    const v = out[out.length - 1]
    if (v && f.mjd - v.end < 30) {
      v.frames.push(f)
      v.end = f.mjd
    } else out.push({ i: out.length, frames: [f], mjd: 0, start: f.mjd, end: f.mjd })
  }
  for (const v of out) v.mjd = v.frames.reduce((a, f) => a + f.mjd, 0) / v.frames.length
  return out
}

/** SPHEREx's six detector bands (approximate ranges, µm). */
export const BANDS = [
  { det: 1, lo: 0.75, hi: 1.09 },
  { det: 2, lo: 1.1, hi: 1.62 },
  { det: 3, lo: 1.63, hi: 2.41 },
  { det: 4, lo: 2.42, hi: 3.82 },
  { det: 5, lo: 3.83, hi: 4.41 },
  { det: 6, lo: 4.42, hi: 5.0 },
]

/** Colour for a wavelength across 0.75–5 µm: violet (shortest) -> red (longest). Used for wavelength only. */
const STOPS = [
  [0.75, [138, 120, 255]],
  [1.1, [90, 150, 255]],
  [1.6, [70, 205, 215]],
  [2.4, [120, 220, 120]],
  [3.8, [255, 210, 100]],
  [4.4, [255, 150, 80]],
  [5.0, [255, 95, 95]],
]
export function wlColor(lam) {
  if (lam <= STOPS[0][0]) return `rgb(${STOPS[0][1]})`
  for (let i = 1; i < STOPS.length; i++) {
    if (lam <= STOPS[i][0]) {
      const [l0, c0] = STOPS[i - 1]
      const [l1, c1] = STOPS[i]
      const t = (lam - l0) / (l1 - l0)
      return `rgb(${c0.map((c, k) => Math.round(c + (c1[k] - c) * t))})`
    }
  }
  return `rgb(${STOPS[STOPS.length - 1][1]})`
}

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

/** A pass longer than this is cut into steps of about STEP_DAYS (see groupVisits). */
export const LONG_PASS_DAYS = 60
export const STEP_DAYS = 30

/**
 * Group frames into survey visits: SPHEREx passes each spot about every 6 months; a pass lasts days to
 * weeks. Frames less than 30 days apart belong to the same pass. Fields near the ecliptic poles (R Draconis)
 * are watched almost non-stop, so one "pass" can last a year: a pass longer than 60 days is cut into equal
 * steps of about 30 days, so brightness changes within it stay visible.
 * @returns {Array<{i:number, frames:object[], mjd:number, start:number, end:number}>}
 */
export function groupVisits(frames) {
  const s = [...frames].sort((a, b) => a.mjd - b.mjd)
  const runs = []
  for (const f of s) {
    const r = runs[runs.length - 1]
    if (r && f.mjd - r[r.length - 1].mjd < 30) r.push(f)
    else runs.push([f])
  }
  const out = []
  for (const r of runs) {
    const t0 = r[0].mjd
    const span = r[r.length - 1].mjd - t0
    const k = span > LONG_PASS_DAYS ? Math.ceil(span / STEP_DAYS) : 1
    const parts = Array.from({ length: k }, () => [])
    for (const f of r) parts[k === 1 ? 0 : Math.min(k - 1, Math.floor(((f.mjd - t0) / span) * k))].push(f)
    for (const p of parts) {
      if (!p.length) continue
      const mjd = p.reduce((a, f) => a + f.mjd, 0) / p.length
      out.push({ i: out.length, frames: p, mjd, start: p[0].mjd, end: p[p.length - 1].mjd })
    }
  }
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

// ── positions for people ────────────────────────────────────────────────

const sexa = (v, digits) => {
  const h = Math.floor(v)
  const m = Math.floor((v - h) * 60)
  let s = ((v - h) * 60 - m) * 60
  s = +s.toFixed(digits)
  return [h, m, s]
}
const pad = (v, w, digits = 0) => (digits ? v.toFixed(digits).padStart(w + digits + 1, '0') : String(v).padStart(w, '0'))
/** RA in hours: 17h 57m 48.50s */
export function fmtRa(ra) {
  let [h, m, s] = sexa((((ra % 360) + 360) % 360) / 15, 2)
  if (s >= 60) [s, m] = [0, m + 1]
  if (m >= 60) [m, h] = [0, h + 1]
  return `${pad(h % 24, 2)}h ${pad(m, 2)}m ${pad(s, 2, 2)}s`
}
/** Dec in degrees: +04° 41′ 36.2″ (with a real minus sign) */
export function fmtDec(dec) {
  let [d, m, s] = sexa(Math.abs(dec), 1)
  if (s >= 60) [s, m] = [0, m + 1]
  if (m >= 60) [m, d] = [0, d + 1]
  return `${dec < 0 ? '−' : '+'}${pad(d, 2)}° ${pad(m, 2)}′ ${pad(s, 2, 1)}″`
}
/** "15 Aug 2025, 03:12 UTC" */
export const fmtDateTime = (mjd) =>
  `${fmtDate(mjd)}, ${mjdToDate(mjd).toISOString().slice(11, 16)} UTC`

/**
 * Photometry (ported verbatim from the old site's verified util.ts `measure`): aperture photometry on the
 * raw cutout (MJy/sr), the sum inside a 1.6-pixel radius minus the median of a sky ring (r+1.5 … r+4.5
 * pixels), converted to flux density in µJy. No aperture correction: this is not the total flux.
 */
import { BANDS, PIXEL_ARCSEC } from './astro'

export const APERTURE_PX = 1.6
/** Solid angle of one SPHEREx pixel, steradians: 1 MJy/sr over one pixel = 888.996 µJy. */
export const PIX_SR = (PIXEL_ARCSEC / 206264.806) ** 2

/**
 * @param {Float32Array} raw n×n surface brightness, MJy/sr (NaN = blank)
 * @param {number} x @param {number} y grid pixel (0-based; pixel i is centred on i)
 * @returns {{flux:number, err:number}} µJy; err ≈ 1σ from the sky ring's scatter: σ_sky·√(N_ap + N_ap²/N_ring)
 */
export function measure(raw, n, x, y, r = APERTURE_PX) {
  let sum = 0
  let cnt = 0
  const ann = []
  const R2 = (r + 4.5) ** 2
  const r1 = (r + 1.5) ** 2
  for (let j = Math.floor(y - r - 5); j <= Math.ceil(y + r + 5); j++) {
    for (let i = Math.floor(x - r - 5); i <= Math.ceil(x + r + 5); i++) {
      if (i < 0 || j < 0 || i >= n || j >= n) continue
      const v = raw[j * n + i]
      if (!Number.isFinite(v)) continue
      const d2 = (i - x) ** 2 + (j - y) ** 2
      if (d2 <= r * r) {
        sum += v
        cnt++
      } else if (d2 >= r1 && d2 <= R2) ann.push(v)
    }
  }
  if (cnt < 3 || ann.length < 8) return { flux: NaN, err: NaN }
  ann.sort((a, b) => a - b)
  const bg = ann[ann.length >> 1]
  const dev = ann.map((v) => Math.abs(v - bg)).sort((a, b) => a - b)
  const sky = 1.4826 * dev[dev.length >> 1]
  return { flux: (sum - bg * cnt) * PIX_SR * 1e12, err: sky * Math.sqrt(cnt + (cnt * cnt) / ann.length) * PIX_SR * 1e12 }
}

export function median(xs) {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const k = s.length >> 1
  return s.length & 1 ? s[k] : (s[k - 1] + s[k]) / 2
}

/**
 * Brightness over time: per band and visit, the median of that visit's exposures, with its error (scatter
 * of the exposures, 1.253·MAD/√k, or the median error when fewer than 3).
 * @param {Array<{f:object, v:number, flux:number, err:number}>} pts
 */
export function lightCurve(pts, visits) {
  return BANDS.map((b) => {
    const points = visits
      .map((v) => {
        const fl = pts.filter((x) => x.v === v.i && x.f.det === b.det)
        if (!fl.length) return null
        const ys = fl.map((x) => x.flux)
        const m = median(ys)
        const mad = 1.4826 * median(ys.map((y) => Math.abs(y - m)))
        const dy = fl.length >= 3 ? (1.253 * mad) / Math.sqrt(fl.length) : median(fl.map((x) => x.err))
        return { x: v.mjd, y: m, dy, k: fl.length, v: v.i }
      })
      .filter(Boolean)
    return { band: b, points }
  }).filter((s) => s.points.length)
}

/** Where well-known molecules absorb in this range (µm). Shown as "would absorb here", never as detections. */
export const FEATURES = [
  { x: 3.05, name: 'H₂O ice', long: 'water ice' },
  { x: 3.3, name: 'CH₄', long: 'methane' },
  { x: 4.27, name: 'CO₂ ice', long: 'carbon dioxide ice' },
  { x: 4.67, name: 'CO', long: 'carbon monoxide' },
]

/** Colour for a moment in the data: earliest blue (like B) through violet and pink to latest amber (like A). */
const TIME_STOPS = [
  [110, 195, 255],
  [166, 154, 255],
  [255, 143, 220],
  [255, 184, 77],
]
export function timeColour(i, n) {
  const t = n > 1 ? i / (n - 1) : 1
  const x = t * (TIME_STOPS.length - 1)
  const k = Math.min(TIME_STOPS.length - 2, Math.floor(x))
  const f = x - k
  return `rgb(${TIME_STOPS[k].map((c, j) => Math.round(c + (TIME_STOPS[k + 1][j] - c) * f)).join(',')})`
}

/** Numbers for people: 3 significant figures, thousands separated. */
export function fmtNum(v, sig = 3) {
  if (!Number.isFinite(v)) return '–'
  if (Math.abs(v) >= 10 ** sig) return Math.round(v).toLocaleString('en-US')
  return (+v.toPrecision(sig)).toLocaleString('en-US', { maximumFractionDigits: 8 })
}
/** A flux in µJy in the unit that reads best (µJy, mJy or Jy). */
export const fluxUnit = (maxAbs) => (maxAbs >= 1e6 ? [1e6, 'Jy'] : maxAbs >= 1e3 ? [1e3, 'mJy'] : [1, 'µJy'])
export function fmtFlux(v, err) {
  const [k, u] = fluxUnit(Math.abs(v))
  return `${fmtNum(v / k)}${err !== undefined && Number.isFinite(err) ? ` ± ${fmtNum(err / k, 2)}` : ''} ${u}`
}

/** Save text as a file in the browser. */
export function download(name, type, text) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Overlays on the image (target ring, Gaia DR3, CatWISE2020, bad pixels) and the hover read-out maths.
 * Ported from the old site's verified scene.ts / render.ts. Everything here is drawn ON TOP of the SPHEREx
 * pixels; nothing changes the data.
 */
import { gridOffset, positionAt } from './astro'
import { BAD_MASK } from './render'

const D = Math.PI / 180

/** Where a catalogue star is on a date: its catalogue position moved by its proper motion (mas/yr). */
export function starAt(row, epochMjd, mjd) {
  if (!row.pmra && !row.pmdec) return [row.ra, row.dec]
  const yrs = (mjd - epochMjd) / 365.25
  return [row.ra + ((row.pmra ?? 0) * yrs) / 3.6e6 / Math.cos(row.dec * D), row.dec + ((row.pmdec ?? 0) * yrs) / 3.6e6]
}

/**
 * Sky position -> grid pixel (fractional; pixel i spans i..i+1, so its centre is i + 0.5).
 * @param {[number, number]} center grid centre (RA, Dec), degrees
 */
export function skyToGrid(center, n, ra, dec) {
  const c0 = (n - 1) / 2
  const [dx, dy] = gridOffset(center[0], center[1], ra, dec)
  return [c0 + dx + 0.5, c0 + dy + 0.5]
}

/** Gaia stars faster than this (mas/yr) get an arrow showing where they go over the data's dates. */
export const FAST_MAS_YR = 150

/**
 * Fraction of the exposures (that have flag information) in which each pixel is flagged bad.
 * @returns {Float32Array|null} null when none of these exposures has flags loaded
 */
export function badFraction(images, ids) {
  const list = []
  for (const id of ids) {
    const c = images.get(id)
    if (c?.flags) list.push(c.flags)
  }
  if (!list.length) return null
  const out = new Float32Array(list[0].length)
  for (const f of list) for (let i = 0; i < f.length; i++) if (f[i] > 0 && f[i] & BAD_MASK) out[i]++
  for (let i = 0; i < out.length; i++) out[i] /= list.length
  return out
}

/**
 * Tint bad pixels cyan (the old site's colour). The strength grows with the share of exposures that flag the
 * pixel (√f), so in one exposure every flagged pixel shows clearly, while in a stack of hundreds a single
 * cosmic-ray hit stays faint and pixels bad in most exposures stand out.
 */
export function paintBad(px, off, frac, n, w) {
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const f = frac[j * n + i]
      if (!(f > 0)) continue
      const q = (off + j * w + i) * 4
      const a = 0.85 * Math.sqrt(Math.min(1, f))
      px[q] = px[q] * (1 - a)
      px[q + 1] = px[q + 1] * (1 - a) + 230 * a
      px[q + 2] = px[q + 2] * (1 - a) + 255 * a
    }
  }
}

/**
 * The SPHEREx numbers behind one grid pixel, over a set of exposures.
 * mean: average surface brightness (MJy/sr) of the exposures with a value there;
 * noise: 1σ of that mean from each file's VARIANCE layer, √(Σ var) / k;
 * flags: how many exposures set each flag bit (-1 = no flag information for that exposure).
 */
export function readPixel(images, ids, i) {
  let k = 0
  let sum = 0
  let varSum = 0
  let nVar = 0
  let loaded = 0
  let withFlags = 0
  const counts = new Map()
  for (const id of ids) {
    const c = images.get(id)
    if (!c) continue
    loaded++
    const v = c.image[i]
    if (Number.isFinite(v)) {
      sum += v
      k++
      const vr = c.variance?.[i]
      if (Number.isFinite(vr) && vr >= 0) {
        varSum += vr
        nVar++
      }
    }
    const fl = c.flags?.[i]
    if (fl !== undefined && fl >= 0) {
      withFlags++
      for (let b = 0; b < 31; b++) if (fl & (1 << b)) counts.set(b, (counts.get(b) ?? 0) + 1)
    }
  }
  return {
    loaded,
    used: k,
    mean: k ? sum / k : NaN,
    noise: nVar && nVar === k ? Math.sqrt(varSum) / nVar : NaN, // only when every value used has its variance
    withFlags,
    flags: [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]),
  }
}

/** A minus B for two read-outs: noise adds in quadrature, σ_D = √(σ_A² + σ_B²). */
export function differenceOf(a, b) {
  return { ...a, mean: a.mean - b.mean, noise: Math.hypot(a.noise, b.noise), ref: b }
}

/** The Details panel is a side panel from this width; below it a drawer, and a bottom sheet on phones (OV-7). */
export const WIDE_PX = 1200
export const PHONE_PX = 768

/** Flag bit -> the name written in the files on screen (one name per release; they normally agree). */
export function flagName(bit, namesByRelease) {
  const names = [...new Set(Object.values(namesByRelease ?? {}).map((m) => m?.[String(bit)]).filter(Boolean))]
  return names.length ? names.join(' / ') : `bit ${bit}`
}

/** Is this flag bit one that means "do not trust this pixel"? */
export const isBadBit = (b) => (BAD_MASK & (1 << b)) !== 0

/** Signed number with a real minus sign. */
export const signed = (v, digits) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`

/** Surface brightness with enough digits for its size: 0.0123 / 1.234 / 123.4 MJy/sr. */
export function fmtMJy(v) {
  if (!Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  const d = a >= 100 ? 1 : a >= 1 ? 3 : 4
  return `${v < 0 ? '−' : ''}${a.toFixed(d)}`
}

// ── drawing ─────────────────────────────────────────────────────────────

function arrow(x, x0, y0, x1, y1, color) {
  const a = Math.atan2(y1 - y0, x1 - x0)
  if (Math.hypot(x1 - x0, y1 - y0) < 4) return
  x.strokeStyle = color
  x.fillStyle = color
  x.lineWidth = 1.6
  x.beginPath()
  x.moveTo(x0, y0)
  x.lineTo(x1, y1)
  x.stroke()
  x.beginPath()
  x.moveTo(x1, y1)
  x.lineTo(x1 - 7 * Math.cos(a - 0.45), y1 - 7 * Math.sin(a - 0.45))
  x.lineTo(x1 - 7 * Math.cos(a + 0.45), y1 - 7 * Math.sin(a + 0.45))
  x.closePath()
  x.fill()
}

export const OVERLAY_COLOURS = { ring: '#ffb84d', gaia: 'rgba(110,195,255,.95)', wise: 'rgba(127,220,164,.9)' }

/**
 * Draw the catalogue and target overlays of one panel (the context is already translated to the panel's
 * top-left corner and clipped to it).
 * @param {CanvasRenderingContext2D} x
 * @param {{ center:[number,number], mjd:number, span?:[number,number]|null, target?:object|null,
 *   gaia?:{rows:Array, epoch_mjd:number}|null, wise?:{rows:Array, epoch_mjd:number}|null }} o
 */
export function drawOverlays(x, o, n, scale) {
  const toPx = (ra, dec) => skyToGrid(o.center, n, ra, dec).map((v) => v * scale)
  if (o.wise) {
    x.strokeStyle = OVERLAY_COLOURS.wise
    x.lineWidth = 1.2
    for (const r of o.wise.rows) {
      const [px, py] = toPx(...starAt(r, o.wise.epoch_mjd, o.mjd))
      const h = Math.max(3, scale * (r.mag < 12 ? 1.5 : 1))
      x.strokeRect(px - h, py - h, 2 * h, 2 * h)
    }
  }
  if (o.gaia) {
    x.lineWidth = 1.3
    for (const r of o.gaia.rows) {
      const [px, py] = toPx(...starAt(r, o.gaia.epoch_mjd, o.mjd))
      const rad = Math.max(3, scale * (r.mag < 13 ? 1.7 : r.mag < 17 ? 1.2 : 0.8))
      x.strokeStyle = OVERLAY_COLOURS.gaia
      x.lineWidth = 1.3
      x.beginPath()
      x.arc(px, py, rad, 0, Math.PI * 2)
      x.stroke()
      if (o.span && Math.hypot(r.pmra ?? 0, r.pmdec ?? 0) > FAST_MAS_YR) {
        // a fast mover: where it goes from the first exposure to the last
        const a = toPx(...starAt(r, o.gaia.epoch_mjd, o.span[0]))
        const b = toPx(...starAt(r, o.gaia.epoch_mjd, o.span[1]))
        arrow(x, a[0], a[1], b[0], b[1], OVERLAY_COLOURS.gaia)
      }
    }
  }
  // movers (MV-8): pink arrows from the first to the last visit used; "appeared once" as dashed circles;
  // your own marks as corner crosses. A find Gaia ruled out is drawn only when selected.
  for (const f of o.finds ?? []) {
    if (f.dismissed && f.id !== o.pick) continue
    const on = f.id === o.pick
    const col = on ? '#ffffff' : f.kind === 'yours' ? '#ff7a6b' : '#ff5cf0'
    const g = (v) => (v + 0.5) * scale
    x.strokeStyle = col
    x.lineWidth = on ? 2.4 : 1.8
    if (f.kind === 'moving') {
      // stretched to at least ~4 px so a one-pixel shift is still visible
      const k2 = Math.max(1, 4 / Math.max(0.3, f.shift))
      x.beginPath()
      x.arc(g(f.x0), g(f.y0), Math.max(6, scale * 1.2), 0, Math.PI * 2)
      x.stroke()
      arrow(x, g(f.x0), g(f.y0), g(f.x0 + (f.x1 - f.x0) * k2), g(f.y0 + (f.y1 - f.y0) * k2), col)
    } else if (f.kind === 'once') {
      x.setLineDash([3, 3])
      x.beginPath()
      x.arc(g(f.x0), g(f.y0), Math.max(9, scale * 2), 0, Math.PI * 2)
      x.stroke()
      x.setLineDash([])
    } else {
      const px = g(f.x0)
      const py = g(f.y0)
      const r = Math.max(7, scale * 1.6)
      x.beginPath()
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        x.moveTo(px + sx * r, py + sy * r)
        x.lineTo(px + (sx * r) / 2.5, py + (sy * r) / 2.5)
      }
      x.stroke()
    }
  }
  if (o.probe) {
    // the point being measured (Spectrum): a dashed circle the size of the photometry aperture's sky ring
    const px = (o.probe[0] + 0.5) * scale
    const py = (o.probe[1] + 0.5) * scale
    x.strokeStyle = 'rgba(255,255,255,.95)'
    x.lineWidth = 1.5
    x.setLineDash([4, 3])
    x.beginPath()
    x.arc(px, py, Math.max(8, scale * 1.6), 0, Math.PI * 2)
    x.stroke()
    x.setLineDash([])
  }
  if (o.target) {
    const t = o.target
    if ((t.pmra || t.pmdec) && o.span) {
      // its track over the data's dates
      const a = toPx(...positionAt(t, o.span[0]))
      const b = toPx(...positionAt(t, o.span[1]))
      x.setLineDash([3, 4])
      x.strokeStyle = 'rgba(255,184,77,.6)'
      x.lineWidth = 1.5
      x.beginPath()
      x.moveTo(a[0], a[1])
      x.lineTo(b[0], b[1])
      x.stroke()
      x.setLineDash([])
    }
    const [px, py] = toPx(...positionAt(t, o.mjd))
    x.strokeStyle = OVERLAY_COLOURS.ring
    x.lineWidth = 2
    x.beginPath()
    x.arc(px, py, Math.max(10, scale * 2.6), 0, Math.PI * 2)
    x.stroke()
  }
}

/**
 * The mover finder (ported line for line from the old site's verified movers.ts) and candidate handling.
 *
 * 1. Each visit's stack is turned into a significance map (divided by its own noise).
 * 2. Sources are found in the deep map (all visits together).
 * 3. Each source's centroid is measured in every visit where it is bright enough; a straight-line fit of
 *    position against time gives its motion. It counts as moving when it shifts more than ~0.5 px over the
 *    data AND that shift is ≥ 4× the expected centroid noise.
 * 4. Peaks seen in only one well-sampled visit, with nothing there in the others, "appeared once": an
 *    asteroid or comet passing through, or an artefact. Candidates are evidence, never discoveries.
 */
import { PIXEL_ARCSEC, gridToSky } from './astro'
import { skyToGrid, starAt } from './overlays'

function robustNoise(a) {
  const v = []
  for (let i = 0; i < a.length; i += Math.max(1, Math.floor(a.length / 3000))) if (Number.isFinite(a[i])) v.push(a[i])
  if (v.length < 20) return NaN
  v.sort((p, q) => p - q)
  const med = v[v.length >> 1]
  const dev = v.map((x) => Math.abs(x - med)).sort((p, q) => p - q)
  return 1.4826 * dev[dev.length >> 1] || 1e-6
}

/** A visit needs at least this many exposures to claim "something appeared only here". */
const MIN_FRAMES_ONCE = 6
/** Systematic floor on a visit's centroid error (pixels): visits mix wavelengths, so the PSF differs. */
const FLOOR = 0.15

/**
 * @param {Array<{i:number, mjd:number, s:Float32Array, frames:number}>} visits one stack per visit
 * @returns {Array<{kind:'moving'|'once', x0:number, y0:number, x1:number, y1:number, rate:number, pa:number,
 *   sig:number, shift:number, visits:number[]}>} rate in ″/yr, pa in degrees east of north
 */
export function findMovers(visits, n) {
  const vs = visits.filter((v) => Number.isFinite(robustNoise(v.s)))
  if (vs.length < 2) return []
  const z = vs.map((v) => {
    const sig = robustNoise(v.s)
    const out = new Float32Array(v.s.length)
    const vals = Array.from(v.s)
      .filter(Number.isFinite)
      .sort((p, q) => p - q)
    const med = vals[vals.length >> 1] ?? 0
    for (let i = 0; i < out.length; i++) out[i] = (v.s[i] - med) / sig
    return out
  })
  const deep = new Float32Array(n * n)
  for (let i = 0; i < deep.length; i++) {
    let s = 0
    let c = 0
    for (const m of z) {
      if (Number.isFinite(m[i])) {
        s += m[i]
        c++
      }
    }
    deep[i] = c ? s / Math.sqrt(c) : NaN
  }
  const B = 3
  const at = (m, x, y) => m[y * n + x]
  const peaks = (m, thr, R) => {
    const out = []
    for (let y = B; y < n - B; y++) {
      for (let x = B; x < n - B; x++) {
        const v = at(m, x, y)
        if (!(v > thr)) continue
        let top = true
        for (let dy = -R; dy <= R && top; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            if ((dx || dy) && at(m, x + dx, y + dy) > v) {
              top = false
              break
            }
          }
        }
        if (top) out.push([x, y, v])
      }
    }
    return out.sort((a, b) => b[2] - a[2])
  }
  /** background-subtracted centroid and signal within r of (x, y) */
  const centroid = (m, x, y, r = 2.2) => {
    const ann = []
    for (let j = Math.floor(y - r - 3); j <= Math.ceil(y + r + 3); j++) {
      for (let i = Math.floor(x - r - 3); i <= Math.ceil(x + r + 3); i++) {
        if (i < 0 || j < 0 || i >= n || j >= n) continue
        const d = Math.hypot(i - x, j - y)
        if (d > r + 1 && d <= r + 3 && Number.isFinite(at(m, i, j))) ann.push(at(m, i, j))
      }
    }
    ann.sort((p, q) => p - q)
    const bg = ann.length ? ann[ann.length >> 1] : 0
    let sw = 0
    let sx = 0
    let sy = 0
    let cnt = 0
    for (let j = Math.floor(y - r); j <= Math.ceil(y + r); j++) {
      for (let i = Math.floor(x - r); i <= Math.ceil(x + r); i++) {
        if (i < 0 || j < 0 || i >= n || j >= n || Math.hypot(i - x, j - y) > r) continue
        const w = at(m, i, j) - bg
        if (!Number.isFinite(w)) continue
        cnt++
        if (w > 0) {
          sw += w
          sx += w * i
          sy += w * j
        }
      }
    }
    return sw > 0 ? { x: sx / sw, y: sy / sw, snr: sw / Math.sqrt(Math.max(1, cnt)) } : null
  }

  const found = []
  const t0 = vs[0].mjd
  for (const [px, py, pv] of peaks(deep, 8, 2).slice(0, 80)) {
    // skip faint sources in the glare of a much brighter neighbour: their centroids get dragged
    let brightest = 0
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        const x = px + dx
        const y = py + dy
        if (x >= 0 && y >= 0 && x < n && y < n && Number.isFinite(at(deep, x, y))) brightest = Math.max(brightest, at(deep, x, y))
      }
    }
    if (pv < 0.15 * brightest) continue
    // and the cores of saturated stars (blank pixels at the centre)
    let holes = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!Number.isFinite(at(deep, px + dx, py + dy))) holes++
    if (holes > 0) continue
    const pts = []
    vs.forEach((v, k) => {
      // follow the source: re-centre twice so a mover of a pixel or two is still captured
      let c = centroid(z[k], px, py)
      if (c) c = centroid(z[k], c.x, c.y) ?? c
      if (c && c.snr > 5) pts.push({ t: (v.mjd - t0) / 365.25, x: c.x, y: c.y, e: Math.max(FLOOR, 1.2 / c.snr), i: v.i })
    })
    if (pts.length < 2) continue
    // weighted straight-line fit x(t), y(t)
    const W = pts.reduce((s, p) => s + 1 / p.e ** 2, 0)
    const tm = pts.reduce((s, p) => s + p.t / p.e ** 2, 0) / W
    const st = pts.reduce((s, p) => s + (p.t - tm) ** 2 / p.e ** 2, 0)
    if (st <= 0) continue
    const xm = pts.reduce((s, p) => s + p.x / p.e ** 2, 0) / W
    const ym = pts.reduce((s, p) => s + p.y / p.e ** 2, 0) / W
    const vx = pts.reduce((s, p) => s + ((p.t - tm) * (p.x - xm)) / p.e ** 2, 0) / st
    const vy = pts.reduce((s, p) => s + ((p.t - tm) * (p.y - ym)) / p.e ** 2, 0) / st
    const span = Math.max(...pts.map((p) => p.t)) - Math.min(...pts.map((p) => p.t))
    const ev = 1 / Math.sqrt(st)
    const shift = Math.hypot(vx, vy) * span
    const sig = Math.hypot(vx, vy) / ev
    if (shift < 0.5 || sig < 4) continue
    // with 3+ visits the positions must follow a straight line; a zig-zag is noise, not motion
    if (pts.length >= 3) {
      const chi2 = pts.reduce((s, p) => s + ((p.x - (xm + vx * (p.t - tm))) ** 2 + (p.y - (ym + vy * (p.t - tm))) ** 2) / p.e ** 2, 0)
      if (chi2 / (2 * pts.length - 4) > 4) continue
    }
    const ta = Math.min(...pts.map((p) => p.t))
    const tb = Math.max(...pts.map((p) => p.t))
    // grid x grows to the west, y to the south
    const east = -vx * PIXEL_ARCSEC
    const north = -vy * PIXEL_ARCSEC
    found.push({
      kind: 'moving',
      x0: xm + vx * (ta - tm),
      y0: ym + vy * (ta - tm),
      x1: xm + vx * (tb - tm),
      y1: ym + vy * (tb - tm),
      rate: Math.hypot(east, north),
      pa: ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360,
      sig,
      shift,
      visits: pts.map((p) => p.i),
    })
  }
  // drop duplicates (one star found twice)
  const movers = found.filter((f, k) => !found.some((g, j) => j < k && Math.hypot(g.x1 - f.x1, g.y1 - f.y1) < 2))

  // appeared once: strong in one well-sampled visit, nothing there in the others
  const once = []
  vs.forEach((v, k) => {
    if (v.frames < MIN_FRAMES_ONCE) return
    for (const [x, y, val] of peaks(z[k], 10, 2).slice(0, 40)) {
      // a blank (saturated) pixel elsewhere means "can't tell", not "nothing there"
      const near = (m) => [at(m, x, y), at(m, x + 1, y), at(m, x - 1, y), at(m, x, y + 1), at(m, x, y - 1)]
      const others = z.filter((_, j) => j !== k)
      if (others.some((m) => near(m).some((q) => !Number.isFinite(q)))) continue
      const elsewhere = others.length > 0 && others.every((m) => !(Math.max(...near(m)) > 3))
      const nearDeep = Math.abs(at(deep, x, y)) > 0 && movers.some((m) => Math.hypot(m.x1 - x, m.y1 - y) < 3)
      if (elsewhere && !nearDeep) once.push({ kind: 'once', x0: x, y0: y, x1: x, y1: y, rate: 0, pa: 0, sig: val, shift: 0, visits: [v.i] })
    }
  })
  return [...movers.sort((a, b) => b.sig - a.sig).slice(0, 12), ...once.sort((a, b) => b.sig - a.sig).slice(0, 8)]
}

// ── candidates ──────────────────────────────────────────────────────────

export const REVIEWS = [
  ['new', 'New candidate'],
  ['review', 'Under review'],
  ['interesting', 'Interesting'],
  ['rejected', 'Rejected'],
  ['insufficient', 'Insufficient evidence'],
]

/**
 * Finds -> candidates with sky positions and a Gaia check (nearest Gaia star within 15″ at the data's mid
 * date). Gaia rows null = Gaia not reachable.
 */
export function toCandidates(finds, { center, n, midMjd, gaia }) {
  const c0 = (n - 1) / 2
  const D = Math.PI / 180
  return finds.map((f, k) => {
    const [ra, dec] = gridToSky(center[0], center[1], (f.x0 + f.x1) / 2 - c0, (f.y0 + f.y1) / 2 - c0)
    let best = gaia ? null : undefined
    let bd = 15
    for (const g of gaia?.rows ?? []) {
      const [gr, gd] = starAt(g, gaia.epoch_mjd, midMjd)
      const d = Math.hypot((gr - ra) * Math.cos(dec * D), gd - dec) * 3600
      if (d < bd) {
        bd = d
        best = { pm: Math.hypot(g.pmra ?? 0, g.pmdec ?? 0), g: g.mag, sep: d }
      }
    }
    // Gaia measured this star and it does not move: our "motion" is an artefact (glare, blends);
    // and a star Gaia always sees cannot have "appeared once"
    const dismissed = !!best && (f.kind === 'moving' ? best.pm < 50 : best.g < 18)
    return { ...f, id: `C${k + 1}`, ra, dec, gaia: best, dismissed }
  })
}

/** Your own marks for this target, as candidates (grid positions from their sky positions). */
export function marksAsCandidates(marks, targetName, center, n) {
  if (!center) return []
  return marks
    .filter((m) => m.target === targetName)
    .map((m, k) => {
      const [gx, gy] = skyToGrid(center, n, m.ra, m.dec).map((v) => v - 0.5)
      return { id: `Y${k + 1}`, kind: 'yours', ra: m.ra, dec: m.dec, x0: gx, y0: gy, x1: gx, y1: gy, rate: 0, pa: 0, sig: 0, shift: 0, visits: [], seen: m.seen, created: m.created, markId: m.id }
    })
}

export const reviewKey = (target, c) => `${target}|${c.kind}|${c.ra.toFixed(4)}|${c.dec.toFixed(4)}`

export const compass = (pa) => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(pa / 45) % 8]

export function describe(c) {
  if (c.kind === 'moving') return `Moving ${c.rate.toFixed(1)}″ per year toward the ${compass(c.pa)}`
  if (c.kind === 'once') return `Seen only in visit ${c.visits[0] + 1}`
  return 'Marked by you'
}

/** Why it was selected, in plain words. */
export function why(c) {
  if (c.kind === 'moving')
    return `Its position shifted by ${c.shift.toFixed(1)} SPHEREx pixels (${(c.shift * PIXEL_ARCSEC).toFixed(1)}″) along a straight line across ${c.visits.length} visits. That shift is ${Math.min(99, c.sig).toFixed(0)}× bigger than the expected measurement noise, and more than half a pixel.`
  if (c.kind === 'once')
    return `A bright spot (${c.sig.toFixed(0)}× the noise) in visit ${c.visits[0] + 1}, which has enough exposures to trust, with nothing at that exact place in any other visit. It could be an asteroid or comet passing through, or a glitch.`
  return `You marked this spot${c.seen ? ` while looking at ${c.seen}` : ''}.`
}

/** The Gaia check in words: known mover, known star, steady star, not in Gaia, or not reachable. */
export function gaiaVerdict(c) {
  if (c.kind === 'yours') return { tone: 'mute', text: 'Not checked' }
  if (c.gaia === undefined) return { tone: 'mute', text: 'Gaia not reachable' }
  if (c.gaia === null) return { tone: 'hot', text: 'Not in Gaia (worth a closer look)' }
  if (c.kind === 'moving' && c.gaia.pm < 50) return { tone: 'warn', text: 'Gaia: steady star' }
  return { tone: 'ok', text: c.gaia.pm > 50 ? `Known mover (${(c.gaia.pm / 1000).toFixed(2)}″/yr)` : 'Known star' }
}

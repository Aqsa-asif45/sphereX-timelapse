/**
 * Image maths (ported from the old site's verified render.ts).
 *
 * Frames are put in "sigma units": background (median) subtracted and divided by the noise (robust MAD).
 * That removes the very different zodiacal-light levels at different wavelengths, so frames can be blinked,
 * stacked and subtracted fairly. Raw values (MJy/sr) are kept separately for measurements.
 */

/** @param {Float32Array} raw @returns {{s: Float32Array, med: number, sig: number} | null} */
export function normalize(raw) {
  const v = []
  const step = Math.max(1, Math.floor(raw.length / 4000))
  for (let i = 0; i < raw.length; i += step) if (Number.isFinite(raw[i])) v.push(raw[i])
  if (v.length < 20) return null
  v.sort((a, b) => a - b)
  const med = v[v.length >> 1]
  const dev = v.map((x) => Math.abs(x - med)).sort((a, b) => a - b)
  const sig = 1.4826 * dev[dev.length >> 1] || 1e-6
  const s = new Float32Array(raw.length)
  for (let i = 0; i < raw.length; i++) s[i] = (raw[i] - med) / sig
  return { s, med, sig }
}

/** Flag bits that mean "do not trust this pixel" (informational bits SOURCE and FULLSAMPLE are left out). */
export const BAD_BITS = {
  0: 'Transient (cosmic ray)',
  1: 'Overflow (saturated)',
  2: 'On-board processing error',
  4: 'Phantom pixel',
  5: 'Reference pixel',
  6: 'Permanently unusable',
  7: 'Low efficiency (dichroic)',
  9: 'Data lost on board',
  10: 'Hot pixel',
  11: 'Cold pixel',
  14: 'Phantom correction missing',
  15: 'Nonlinear (too bright)',
  17: 'Persistent charge',
  19: 'Outlier',
}
export const BAD_MASK = Object.keys(BAD_BITS).reduce((m, b) => m | (1 << +b), 0)

/**
 * Combine normalised frames pixel by pixel with a sigma-clipped mean: values more than 4σ (robust, from the
 * median absolute deviation) from the pixel's median are dropped, removing cosmic-ray hits and hot pixels
 * a plain mean would keep. Gaps and (when flags are loaded) bad pixels are skipped. Noise drops as 1/√N.
 * @param {Array<{s: Float32Array, flags?: Int32Array}>} list
 */
export function stack(list) {
  if (!list.length) return null
  const n = list[0].s.length
  const out = new Float32Array(n)
  const buf = new Float32Array(list.length)
  const dev = new Float32Array(list.length)
  for (let i = 0; i < n; i++) {
    let k = 0
    for (const f of list) {
      const x = f.s[i]
      if (Number.isFinite(x) && !(f.flags && f.flags[i] > 0 && f.flags[i] & BAD_MASK)) buf[k++] = x
    }
    if (k === 0) {
      out[i] = NaN
      continue
    }
    if (k < 3) {
      out[i] = k === 1 ? buf[0] : (buf[0] + buf[1]) / 2
      continue
    }
    const v = buf.subarray(0, k).sort()
    const med = k & 1 ? v[k >> 1] : (v[k / 2 - 1] + v[k / 2]) / 2
    for (let j = 0; j < k; j++) dev[j] = Math.abs(v[j] - med)
    const d = dev.subarray(0, k).sort()
    const lim = Math.max(4 * 1.4826 * d[k >> 1], 1.5)
    let s = 0
    let c = 0
    for (let j = 0; j < k; j++) {
      if (Math.abs(v[j] - med) <= lim) {
        s += v[j]
        c++
      }
    }
    out[i] = c ? s / c : med
  }
  return out
}

/** A minus B, or (A + B)/√2 (a sum of two σ-maps rescaled to unit noise). A visit minus itself is exactly 0. */
export function combine(a, b, op) {
  const o = new Float32Array(a.length)
  for (let i = 0; i < a.length; i++) o[i] = op === 'sub' ? a[i] - b[i] : (a[i] + b[i]) / Math.SQRT2
  return o
}

// ── colour ──────────────────────────────────────────────────────────────

/** Inferno colour map (deciles): black -> purple -> orange -> pale yellow. */
const INFERNO = ['#000004', '#160b39', '#420a68', '#6a176e', '#932667', '#bc3754', '#dd513a', '#f37819', '#fca50a', '#f6d746', '#fcffa4'].map(
  (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)),
)
export const LUT = new Uint8Array(256 * 3)
for (let k = 0; k < 256; k++) {
  const t = (k / 255) * 10
  const i = Math.min(9, Math.floor(t))
  const f = t - i
  for (let c = 0; c < 3; c++) LUT[k * 3 + c] = Math.round(INFERNO[i][c] + (INFERNO[i + 1][c] - INFERNO[i][c]) * f)
}

export const GAP = [18, 22, 32] // blank pixels: drawn in this colour, never filled in
const SOFT = 3
export const STRETCHES = ['asinh', 'linear', 'log', 'sqrt']

/**
 * Brightness (sigma units) -> 0..1 for display. asinh (default): faint detail visible, bright stars not
 * blown out. `contrast` is the sigma level shown as full white.
 */
export function level(v, contrast, stretch = 'asinh') {
  if (stretch === 'asinh') {
    return Math.max(0, Math.min(1, Math.asinh(Math.max(0, v + 1.5) / SOFT) / Math.asinh((contrast + 1.5) / SOFT)))
  }
  const t = Math.max(0, Math.min(1, (v + 1.5) / (contrast + 1.5)))
  if (stretch === 'log') return Math.log(1 + 1000 * t) / Math.log(1001)
  if (stretch === 'sqrt') return Math.sqrt(t)
  return t
}

const put = (p, q, r, g, b) => {
  p[q] = r
  p[q + 1] = g
  p[q + 2] = b
  p[q + 3] = 255
}

/**
 * Blank pixels inside a bright star: NASA blanks a star's core when it is too bright to measure (saturated).
 * Drawn in the gap colour they looked like a dark hole in the star. A blank pixel whose real neighbours are
 * all bright (and at least two of them) is marked, and the marks grow inwards a few pixels, so it can be drawn
 * as "saturated" (the brightest colour), as WiseView does. Display only: the data stay blank and unmeasured.
 * Blank pixels in ordinary sky (dead pixels, detector edges) are not marked and keep the gap colour.
 * @param {(v:number) => boolean} isBright
 * @returns {Uint8Array} 1 = saturated core
 */
export function saturatedCores(data, n, isBright) {
  const sat = new Uint8Array(n * n)
  for (let pass = 0, changed = true; pass < 4 && changed; pass++) {
    changed = false
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i
        if (sat[k] || Number.isFinite(data[k])) continue
        let bright = 0
        let real = 0
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const x = i + di
            const y = j + dj
            if ((!di && !dj) || x < 0 || y < 0 || x >= n || y >= n) continue
            const q = y * n + x
            if (sat[q]) bright++, real++
            else if (Number.isFinite(data[q])) {
              real++
              if (isBright(data[q])) bright++
            }
          }
        }
        if (bright >= 2 && bright === real) {
          sat[k] = 1
          changed = true
        }
      }
    }
  }
  return sat
}

/** Paint a σ-map with the inferno colour map into RGBA `p` (row width w), starting at pixel offset o. */
export function paintHeat(p, o, data, n, w, contrast, stretch) {
  const sat = saturatedCores(data, n, (v) => level(v, contrast, stretch) >= 0.8)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = data[j * n + i]
      const q = (o + j * w + i) * 4
      if (!Number.isFinite(v)) {
        if (sat[j * n + i]) put(p, q, LUT[765], LUT[766], LUT[767])
        else put(p, q, ...GAP)
      } else {
        const k = Math.round(level(v, contrast, stretch) * 255) * 3
        put(p, q, LUT[k], LUT[k + 1], LUT[k + 2])
      }
    }
  }
}

/** Diverging: brighter in A than in B = orange, fainter = blue, unchanged = black. */
export function paintDiff(p, o, data, n, w, contrast) {
  const top = Math.asinh(Math.max(2, contrast / 3) / SOFT)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = data[j * n + i]
      const q = (o + j * w + i) * 4
      if (!Number.isFinite(v)) {
        put(p, q, ...GAP)
        continue
      }
      const t = Math.max(-1, Math.min(1, Math.asinh(v / SOFT) / top))
      const a = Math.abs(t)
      if (t >= 0) put(p, q, 255 * a, 165 * a, 40 * a)
      else put(p, q, 60 * a, 170 * a, 255 * a)
    }
  }
}

/** False colour: short wavelengths blue, middle green, long red. Very red sources (cold brown dwarfs) stand out. */
export function paintRgb(p, o, r, g, b, n, w, contrast, stretch) {
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i
      const q = (o + j * w + i) * 4
      const ch = [r, g, b].map((a) => (a && Number.isFinite(a[k]) ? level(a[k], contrast, stretch) : NaN))
      if (ch.every((x) => !Number.isFinite(x))) put(p, q, ...GAP)
      else put(p, q, 255 * (ch[0] || 0), 255 * (ch[1] || 0), 255 * (ch[2] || 0))
    }
  }
}

/**
 * Catmull-Rom bicubic upscale of an RGBA image by a whole factor k, for the optional smooth display only:
 * the measured data are not touched.
 */
export function upscaleBicubic(src, w, h, k) {
  const W = w * k
  const H = h * k
  const out = new Uint8ClampedArray(W * H * 4)
  const taps = (n, N) => {
    const idx = new Int32Array(N * 4)
    const wt = new Float32Array(N * 4)
    for (let I = 0; I < N; I++) {
      const u = (I + 0.5) / k - 0.5
      const i0 = Math.floor(u)
      const t = u - i0
      const t2 = t * t
      const t3 = t2 * t
      const c = [(-t3 + 2 * t2 - t) / 2, (3 * t3 - 5 * t2 + 2) / 2, (-3 * t3 + 4 * t2 + t) / 2, (t3 - t2) / 2]
      for (let m = 0; m < 4; m++) {
        idx[I * 4 + m] = Math.min(n - 1, Math.max(0, i0 - 1 + m))
        wt[I * 4 + m] = c[m]
      }
    }
    return { idx, wt }
  }
  const tx = taps(w, W)
  const ty = taps(h, H)
  const tmp = new Float32Array(W * h * 3)
  for (let j = 0; j < h; j++) {
    for (let I = 0; I < W; I++) {
      let r = 0
      let g = 0
      let b = 0
      for (let m = 0; m < 4; m++) {
        const s = (j * w + tx.idx[I * 4 + m]) * 4
        const q = tx.wt[I * 4 + m]
        r += q * src[s]
        g += q * src[s + 1]
        b += q * src[s + 2]
      }
      const o = (j * W + I) * 3
      tmp[o] = r
      tmp[o + 1] = g
      tmp[o + 2] = b
    }
  }
  for (let J = 0; J < H; J++) {
    for (let I = 0; I < W; I++) {
      let r = 0
      let g = 0
      let b = 0
      for (let m = 0; m < 4; m++) {
        const s = (ty.idx[J * 4 + m] * W + I) * 3
        const q = ty.wt[J * 4 + m]
        r += q * tmp[s]
        g += q * tmp[s + 1]
        b += q * tmp[s + 2]
      }
      put(out, (J * W + I) * 4, r, g, b)
    }
  }
  return out
}

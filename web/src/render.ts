/**
 * Image maths in the browser.
 *
 * Frames are put in "sigma units": background (median) subtracted and divided by the noise
 * (robust MAD). That removes the very different zodiacal-light levels at different
 * wavelengths, so frames can be blinked, stacked and subtracted fairly. Raw values (MJy/sr)
 * are kept too, for photometry and spectra.
 */

export interface FrameData { raw: Float32Array; s: Float32Array; med: number; sig: number; flags?: Int32Array }

export function normalize(raw: Float32Array): FrameData | null {
  const v: number[] = [];
  const step = Math.max(1, Math.floor(raw.length / 4000));
  for (let i = 0; i < raw.length; i += step) if (Number.isFinite(raw[i])) v.push(raw[i]);
  if (v.length < 20) return null;
  v.sort((a, b) => a - b);
  const med = v[v.length >> 1];
  const dev = v.map((x) => Math.abs(x - med)).sort((a, b) => a - b);
  const sig = 1.4826 * dev[dev.length >> 1] || 1e-6;
  const s = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) s[i] = (raw[i] - med) / sig;
  return { raw, s, med, sig };
}

/** Flag bits that mean "do not trust this pixel" (informational bits SOURCE and FULLSAMPLE are left out). */
export const BAD_BITS: Record<number, string> = {
  0: 'Transient (cosmic ray)', 1: 'Overflow (saturated)', 2: 'On-board processing error', 4: 'Phantom pixel', 5: 'Reference pixel',
  6: 'Permanently unusable', 7: 'Low efficiency (dichroic)', 9: 'Data lost on board', 10: 'Hot pixel', 11: 'Cold pixel',
  14: 'Phantom correction missing', 15: 'Nonlinear (too bright)', 17: 'Persistent charge', 19: 'Outlier',
};
export const INFO_BITS: Record<number, string> = { 12: 'Full sample history', 21: 'Known source here' };
export const BAD_MASK = Object.keys(BAD_BITS).reduce((m, b) => m | (1 << +b), 0);

/**
 * Combine normalized frames pixel by pixel with a sigma-clipped mean: values more than 4σ
 * (robust, from the median absolute deviation) from the pixel's median are dropped, which
 * removes cosmic-ray hits and hot pixels that a plain mean would keep. Gaps and (when flags
 * are loaded) bad pixels are skipped. Noise drops roughly as 1/√N.
 */
export function stack(list: FrameData[]): Float32Array | null {
  if (!list.length) return null;
  const n = list[0].s.length, out = new Float32Array(n), buf = new Float32Array(list.length), dev = new Float32Array(list.length);
  for (let i = 0; i < n; i++) {
    let k = 0;
    for (const f of list) {
      const x = f.s[i];
      if (Number.isFinite(x) && !(f.flags && f.flags[i] > 0 && f.flags[i] & BAD_MASK)) buf[k++] = x;
    }
    if (k === 0) { out[i] = NaN; continue; }
    if (k < 3) { out[i] = k === 1 ? buf[0] : (buf[0] + buf[1]) / 2; continue; }
    const v = buf.subarray(0, k).sort(), med = k & 1 ? v[k >> 1] : (v[k / 2 - 1] + v[k / 2]) / 2;
    for (let j = 0; j < k; j++) dev[j] = Math.abs(v[j] - med);
    const d = dev.subarray(0, k).sort(), lim = Math.max(4 * 1.4826 * d[k >> 1], 1.5);
    let s = 0, c = 0;
    for (let j = 0; j < k; j++) if (Math.abs(v[j] - med) <= lim) { s += v[j]; c++; }
    out[i] = c ? s / c : med;
  }
  return out;
}

/** Fraction of frames in which each pixel is flagged bad (null if flags are not loaded). */
export function badFraction(list: FrameData[]): Float32Array | null {
  const withFlags = list.filter((f) => f.flags);
  if (!withFlags.length) return null;
  const n = withFlags[0].s.length, out = new Float32Array(n);
  for (const f of withFlags) for (let i = 0; i < n; i++) if (f.flags![i] > 0 && f.flags![i] & BAD_MASK) out[i]++;
  for (let i = 0; i < n; i++) out[i] /= withFlags.length;
  return out;
}

export const combine = (a: Float32Array, b: Float32Array, op: 'sub' | 'add') => {
  const o = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = op === 'sub' ? a[i] - b[i] : (a[i] + b[i]) / Math.SQRT2; // a sum of two σ-maps, rescaled to unit noise
  return o;
};

// ── colour ──────────────────────────────────────────────────────────────────

/** "Infrared" palette: black → purple → orange → white (the inferno colour map's deciles). */
const INFERNO = ['#000004', '#160b39', '#420a68', '#6a176e', '#932667', '#bc3754', '#dd513a', '#f37819', '#fca50a', '#f6d746', '#fcffa4']
  .map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
export const LUT = new Uint8Array(256 * 3);
for (let k = 0; k < 256; k++) {
  const t = (k / 255) * 10, i = Math.min(9, Math.floor(t)), f = t - i;
  for (let c = 0; c < 3; c++) LUT[k * 3 + c] = Math.round(INFERNO[i][c] + (INFERNO[i + 1][c] - INFERNO[i][c]) * f);
}
export const lutCss = (t: number) => { const k = Math.round(Math.max(0, Math.min(1, t)) * 255) * 3; return `rgb(${LUT[k]},${LUT[k + 1]},${LUT[k + 2]})`; };

const SOFT = 3;
/** asinh stretch in sigma units: faint detail visible, bright stars not blown out. */
const level = (v: number, contrast: number) => Math.max(0, Math.min(1, Math.asinh(Math.max(0, v + 1.5) / SOFT) / Math.asinh((contrast + 1.5) / SOFT)));
const GAP: [number, number, number] = [18, 22, 32];

export function paintHeat(p: Uint8ClampedArray, o: number, data: Float32Array, n: number, w: number, contrast: number) {
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const v = data[j * n + i], q = (o + j * w + i) * 4;
    if (!Number.isFinite(v)) { p[q] = GAP[0]; p[q + 1] = GAP[1]; p[q + 2] = GAP[2]; p[q + 3] = 255; continue; }
    const k = Math.round(level(v, contrast) * 255) * 3;
    p[q] = LUT[k]; p[q + 1] = LUT[k + 1]; p[q + 2] = LUT[k + 2]; p[q + 3] = 255;
  }
}

/** Diverging: brighter in A than in B = warm, fainter = blue, unchanged = black. */
export function paintDiff(p: Uint8ClampedArray, o: number, data: Float32Array, n: number, w: number, contrast: number) {
  const top = Math.asinh(Math.max(2, contrast / 3) / SOFT);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const v = data[j * n + i], q = (o + j * w + i) * 4;
    if (!Number.isFinite(v)) { p[q] = GAP[0]; p[q + 1] = GAP[1]; p[q + 2] = GAP[2]; p[q + 3] = 255; continue; }
    const t = Math.max(-1, Math.min(1, Math.asinh(v / SOFT) / top)), a = Math.abs(t);
    if (t >= 0) { p[q] = 255 * a; p[q + 1] = 165 * a; p[q + 2] = 40 * a; } else { p[q] = 60 * a; p[q + 1] = 170 * a; p[q + 2] = 255 * a; }
    p[q + 3] = 255;
  }
}

/** False colour: short wavelengths blue, middle green, long red. Very red sources (cold brown dwarfs) stand out. */
export function paintRgb(p: Uint8ClampedArray, o: number, r: Float32Array | null, g: Float32Array | null, b: Float32Array | null, n: number, w: number, contrast: number) {
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, q = (o + j * w + i) * 4;
    const ch = [r, g, b].map((a) => (a && Number.isFinite(a[k]) ? level(a[k], contrast) : NaN));
    if (ch.every((x) => !Number.isFinite(x))) { p[q] = GAP[0]; p[q + 1] = GAP[1]; p[q + 2] = GAP[2]; p[q + 3] = 255; continue; }
    p[q] = 255 * (ch[0] || 0); p[q + 1] = 255 * (ch[1] || 0); p[q + 2] = 255 * (ch[2] || 0); p[q + 3] = 255;
  }
}

/** Tint pixels flagged bad (alpha = fraction of frames flagged). */
export function paintBad(p: Uint8ClampedArray, o: number, frac: Float32Array, n: number, w: number) {
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const f = frac[j * n + i];
    if (!(f > 0)) continue;
    const q = (o + j * w + i) * 4, a = Math.min(0.85, 0.25 + 0.6 * f);
    p[q] = p[q] * (1 - a) + 0 * a; p[q + 1] = p[q + 1] * (1 - a) + 230 * a; p[q + 2] = p[q + 2] * (1 - a) + 255 * a;
  }
}

// ── photometry ──────────────────────────────────────────────────────────────

const PIX_SR = (6.15 / 206264.806) ** 2; // solid angle of one SPHEREx pixel, steradians

/**
 * Aperture photometry at (x, y) grid pixels: sum inside radius r minus the median of an
 * annulus (r+1.5 … r+4.5). Returns flux density in µJy (MJy/sr × sr × 10¹²), or NaN.
 */
export function aperture(raw: Float32Array, n: number, x: number, y: number, r = 1.6): number {
  let sum = 0, cnt = 0;
  const ann: number[] = [], R2 = (r + 4.5) ** 2, r1 = (r + 1.5) ** 2;
  for (let j = Math.floor(y - r - 5); j <= Math.ceil(y + r + 5); j++) for (let i = Math.floor(x - r - 5); i <= Math.ceil(x + r + 5); i++) {
    if (i < 0 || j < 0 || i >= n || j >= n) continue;
    const v = raw[j * n + i];
    if (!Number.isFinite(v)) continue;
    const d2 = (i - x) ** 2 + (j - y) ** 2;
    if (d2 <= r * r) { sum += v; cnt++; } else if (d2 >= r1 && d2 <= R2) ann.push(v);
  }
  if (cnt < 3 || ann.length < 8) return NaN;
  ann.sort((a, b) => a - b);
  const bg = ann[ann.length >> 1];
  return (sum - bg * cnt) * PIX_SR * 1e12;
}

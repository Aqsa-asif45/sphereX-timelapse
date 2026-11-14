/**
 * Cutouts: a small north-up, east-left image of one frame around a sky position, on a
 * common grid shared by every frame, so frames can be blinked, subtracted and stacked.
 *
 * Bytes are the bottleneck, so we fetch only the pixels needed: one HTTP range per detector
 * row covering just the columns under the output grid (a 6′ cutout ≈ 80 rows × ~330 bytes),
 * then resample with a Lanczos-3 kernel through the frame's own TAN-SIP solution.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CACHE, NPIX } from './config.js';
import type { FrameRec } from './finder.js';
import { flagsDataStart } from './layout.js';
import { getRange, PRIO } from './net.js';
import { skyToPix, tanToSky } from './wcs.js';

export interface Cutout { n: number; img: Float32Array; flags?: Int32Array }

const dir = path.join(CACHE, 'cut');

/** Output grid: n×n pixels of `scale` deg, centred on (ra, dec), north up, east left. Row 0 is the top. */
function gridToInput(fr: FrameRec, ra: number, dec: number, n: number, scale: number) {
  const c = (n - 1) / 2, xs = new Float64Array(n * n), ys = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const [r, d] = tanToSky(ra, dec, -(i - c) * scale, (c - j) * scale);
    const p = skyToPix(fr.wcs, r, d);
    xs[j * n + i] = p ? p[0] : NaN;
    ys[j * n + i] = p ? p[1] : NaN;
  }
  return { xs, ys };
}

async function readBlock(key: string, dataOff: number, bytesPer: 4, x0: number, x1: number, y0: number, y1: number, prio: (typeof PRIO)[keyof typeof PRIO]) {
  const w = x1 - x0 + 1, rows: Buffer[] = [];
  await Promise.all(Array.from({ length: y1 - y0 + 1 }, async (_, k) => {
    const y = y0 + k, start = dataOff + ((y - 1) * NPIX + (x0 - 1)) * bytesPer;
    rows[k] = await getRange(key, start, start + w * bytesPer - 1, prio);
  }));
  return rows;
}

/** Lanczos-3 kernel: the sharp, standard choice for aligning astronomical images (keeps detail bilinear blurs). */
const lanczos = (t: number) => {
  if (t === 0) return 1;
  if (t <= -3 || t >= 3) return 0;
  const p = Math.PI * t;
  return (3 * Math.sin(p) * Math.sin(p / 3)) / (p * p);
};

/** Raw detector pixels (no resampling) around FITS pixel (x, y): for checking the data against other sources. */
export async function rawPixels(fr: FrameRec, x: number, y: number, r: number) {
  const x0 = Math.max(1, x - r), x1 = Math.min(NPIX, x + r), y0 = Math.max(1, y - r), y1 = Math.min(NPIX, y + r);
  const rows = await readBlock(fr.key, fr.data, 4, x0, x1, y0, y1, PRIO.view);
  const values = rows.map((b) => Array.from({ length: x1 - x0 + 1 }, (_, c) => b.readFloatBE(c * 4)));
  return { key: fr.key, x0, y0, values, crpix: fr.wcs.crpix };
}

/** Cutouts being made right now, by cache file: a second request for the same one waits for it. */
const making = new Map<string, Promise<Cutout>>();
const cutoutFile = (fr: FrameRec, ra: number, dec: number, n: number, scale: number, withFlags: boolean) =>
  path.join(dir, crypto.createHash('sha1').update(`${fr.key}|${ra.toFixed(6)}|${dec.toFixed(6)}|${n}|${scale}|${withFlags ? 1 : 0}|L3`).digest('hex') + '.bin');

/** Already on disk? (Used to skip work when preparing a whole view.) */
export const cutoutCached = (fr: FrameRec, ra: number, dec: number, n: number, scale: number, withFlags: boolean) => fs.existsSync(cutoutFile(fr, ra, dec, n, scale, withFlags));

export function cutout(fr: FrameRec, ra: number, dec: number, n: number, scale: number, withFlags: boolean, prio: (typeof PRIO)[keyof typeof PRIO] = PRIO.view): Promise<Cutout> {
  const file = cutoutFile(fr, ra, dec, n, scale, withFlags);
  let p = making.get(file);
  if (!p) { p = makeCutout(fr, ra, dec, n, scale, withFlags, prio, file).finally(() => making.delete(file)); making.set(file, p); }
  return p;
}

async function makeCutout(fr: FrameRec, ra: number, dec: number, n: number, scale: number, withFlags: boolean, prio: (typeof PRIO)[keyof typeof PRIO], file: string): Promise<Cutout> {
  try {
    const b = fs.readFileSync(file);
    const img = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + n * n * 4));
    const flags = withFlags ? new Int32Array(b.buffer.slice(b.byteOffset + n * n * 4, b.byteOffset + n * n * 8)) : undefined;
    return { n, img, flags };
  } catch { /* not cached */ }
  // flags asked for an image the viewer already has (or is making): read only the FLAGS rows (half the requests)
  const plain = cutoutFile(fr, ra, dec, n, scale, false);
  if (withFlags) await making.get(plain)?.catch(() => undefined);
  const fileFor = (f: boolean) => (f ? file : plain);
  let have: Float32Array | null = null;
  if (withFlags) try { const b = fs.readFileSync(fileFor(false)); if (b.length === n * n * 4) have = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + n * n * 4)); } catch { /* not cached */ }

  const { xs, ys } = gridToInput(fr, ra, dec, n, scale);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let k = 0; k < xs.length; k++) if (Number.isFinite(xs[k])) {
    x0 = Math.min(x0, xs[k]); x1 = Math.max(x1, xs[k]); y0 = Math.min(y0, ys[k]); y1 = Math.max(y1, ys[k]);
  }
  const img = have ?? new Float32Array(n * n).fill(NaN);
  const flags = withFlags ? new Int32Array(n * n).fill(-1) : undefined;
  x0 = Math.max(1, Math.floor(x0) - 3); x1 = Math.min(NPIX, Math.ceil(x1) + 3); // ±3 px for the Lanczos-3 kernel
  y0 = Math.max(1, Math.floor(y0) - 3); y1 = Math.min(NPIX, Math.ceil(y1) + 3);
  if (x0 <= x1 && y0 <= y1) {
    const [rows, frows] = await Promise.all([
      have ? Promise.resolve(null) : readBlock(fr.key, fr.data, 4, x0, x1, y0, y1, prio),
      withFlags ? flagsDataStart(fr.key, fr.data, prio).then((at) => readBlock(fr.key, at, 4, x0, x1, y0, y1, prio)) : Promise.resolve(null),
    ]);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const block = new Float32Array(w * h);
    if (rows) for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) block[r * w + c] = rows[r].readFloatBE(c * 4);
    const fblock = frows ? new Int32Array(w * h) : null;
    if (fblock && frows) for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) fblock[r * w + c] = frows[r].readInt32BE(c * 4);
    for (let k = 0; k < xs.length; k++) {
      const fx = xs[k] - x0, fy = ys[k] - y0; // 0-based within the block (FITS pixel centres are integers)
      if (!(fx >= 0 && fy >= 0 && fx <= w - 1 && fy <= h - 1)) continue;
      const nx = Math.round(fx), ny = Math.round(fy);
      if (fblock && flags) flags[k] = fblock[ny * w + nx];
      if (have) continue; // image already resampled
      // a blank (saturated / missing) original pixel stays blank: never invent data
      if (!Number.isFinite(block[ny * w + nx])) continue;
      let s = 0, ws = 0;
      for (let j = Math.ceil(fy - 3); j <= Math.floor(fy + 3); j++) {
        if (j < 0 || j >= h) continue;
        const wy = lanczos(fy - j);
        if (!wy) continue;
        for (let i = Math.ceil(fx - 3); i <= Math.floor(fx + 3); i++) {
          if (i < 0 || i >= w) continue;
          const v = block[j * w + i], wgt = wy * lanczos(fx - i);
          if (wgt && Number.isFinite(v)) { s += wgt * v; ws += wgt; }
        }
      }
      img[k] = ws > 0.2 ? s / ws : block[ny * w + nx];
    }
  }
  fs.mkdirSync(dir, { recursive: true });
  const out = Buffer.alloc(n * n * (withFlags ? 8 : 4));
  Buffer.from(img.buffer).copy(out, 0);
  if (flags) Buffer.from(flags.buffer).copy(out, n * n * 4);
  fs.writeFileSync(file, out);
  return { n, img, flags };
}

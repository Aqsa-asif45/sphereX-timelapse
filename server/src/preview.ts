/**
 * Animated previews for the welcome page: a small looping GIF per challenge target, one
 * frame per SPHEREx visit, built on the server from cutouts already in the cache. Uses the
 * web app's own stacking, colour map and GIF encoder, so previews match the viewer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { groupVisits, REF_MJD } from '../../web/src/astro';
import { encodeGif, makePalette, quantize } from '../../web/src/gif';
import { LUT, normalize, paintHeat, stack, type FrameData } from '../../web/src/render';
import { CACHE, PIXEL_ARCSEC } from './config.js';
import { cutout } from './cutout.js';
import { findFrames } from './finder.js';
import { PRIO } from './net.js';
import { FEATURED, resolve } from './resolve.js';

const dir = path.join(CACHE, 'preview');
const N = 39, UP = 4, SIZE = N * UP; // 4′ field, shown at 156 px
const pending = new Map<string, Promise<Buffer>>();

const D = Math.PI / 180;
function at(t: { ra: number; dec: number; epoch: number; pmra?: number; pmdec?: number }, mjd: number): [number, number] {
  const yr = (mjd - t.epoch) / 365.25;
  return [t.ra + ((t.pmra ?? 0) * yr) / 3.6e6 / Math.cos(t.dec * D), t.dec + ((t.pmdec ?? 0) * yr) / 3.6e6];
}

/** Nearest-neighbour upscale: each SPHEREx pixel becomes a sharp square, as in the viewer. */
function upscale(src: Uint8ClampedArray, n: number, k: number): Uint8ClampedArray {
  const m = n * k, out = new Uint8ClampedArray(m * m * 4);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    const s = (Math.floor(j / k) * n + Math.floor(i / k)) * 4, o = (j * m + i) * 4;
    out[o] = src[s]; out[o + 1] = src[s + 1]; out[o + 2] = src[s + 2]; out[o + 3] = 255;
  }
  return out;
}

function ring(img: Uint8ClampedArray, m: number, cx: number, cy: number, r: number) {
  for (let j = Math.floor(cy - r - 2); j <= cy + r + 2; j++) for (let i = Math.floor(cx - r - 2); i <= cx + r + 2; i++) {
    if (i < 0 || j < 0 || i >= m || j >= m) continue;
    const a = Math.max(0, 1 - Math.abs(Math.hypot(i - cx, j - cy) - r) / 1.1);
    if (a <= 0) continue;
    const o = (j * m + i) * 4;
    img[o] = img[o] * (1 - a) + 255 * a; img[o + 1] = img[o + 1] * (1 - a) + 184 * a; img[o + 2] = img[o + 2] * (1 - a) + 77 * a;
  }
}

async function build(slug: string): Promise<Buffer> {
  const f = FEATURED.find((x) => x.slug === slug);
  if (!f) throw new Error('unknown target');
  const t = await resolve(f.name);
  const [ra, dec] = at(t, REF_MJD);
  const r = await findFrames(Number(ra.toFixed(6)), Number(dec.toFixed(6)));
  const data = new Map<string, FrameData>();
  await Promise.all(r.frames.map(async (fr) => {
    try { const c = await cutout(fr, Number(ra.toFixed(6)), Number(dec.toFixed(6)), N, PIXEL_ARCSEC / 3600, false, PRIO.background); const d = normalize(c.img); if (d) data.set(fr.id, d); } catch { /* skip */ }
  }));
  const pal = makePalette(LUT), cache = new Map<number, number>(), frames: Uint8Array[] = [];
  for (const v of groupVisits(r.frames)) {
    const s = stack(v.frames.map((x) => data.get(x.id)).filter((x): x is FrameData => !!x));
    if (!s) continue;
    const px = new Uint8ClampedArray(N * N * 4);
    paintHeat(px, 0, s, N, N, 25);
    const big = upscale(px, N, UP);
    const [pr, pd] = at(t, v.mjd), c0 = (N - 1) / 2;
    const gx = c0 - ((((pr - ra + 540) % 360) - 180) * Math.cos(dec * D) * 3600) / PIXEL_ARCSEC, gy = c0 - ((pd - dec) * 3600) / PIXEL_ARCSEC;
    ring(big, SIZE, (gx + 0.5) * UP, (gy + 0.5) * UP, 11);
    frames.push(quantize(big, pal, cache));
  }
  if (!frames.length) throw new Error('no images yet');
  const blob = encodeGif(frames, SIZE, SIZE, pal, 70);
  const buf = Buffer.from(await blob.arrayBuffer());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, slug + '.gif'), buf);
  return buf;
}

export function preview(slug: string): Promise<Buffer> {
  const file = path.join(dir, slug.replace(/[^\w-]/g, '') + '.gif');
  if (fs.existsSync(file)) return Promise.resolve(fs.readFileSync(file));
  if (!pending.has(slug)) pending.set(slug, build(slug).finally(() => pending.delete(slug)));
  return pending.get(slug)!;
}

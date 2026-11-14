/** Builds what to draw for one item (panels of image data) and draws it with overlays.
 *  Used by the on-screen viewer and by the GIF/video exporter, so exports match the screen. */
import type { Frame, Target } from './api';
import { BANDS, gridOffset, PIXEL_ARCSEC, positionAt } from './astro';
import type { FrameStore } from './data';
import { badFraction, combine, paintBad, paintDiff, paintHeat, paintRgb, stack, upscaleBicubic, type FrameData } from './render';

export type Colours = 'all' | 'six' | 'rgb' | 'd1' | 'd2' | 'd3' | 'd4' | 'd5' | 'd6';
export const bandOf = (c: Colours) => (c[0] === 'd' ? +c[1] : 0);

export interface Item { key: string; label: string; sub: string; mjd: number; frames: Frame[]; ref?: Frame[]; op?: 'sub' | 'add'; lambda?: number }

export interface Panel { label?: string; kind: 'heat' | 'diff' | 'rgb'; data?: Float32Array | null; rgb?: Array<Float32Array | null>; bad?: Float32Array | null }

const data = (store: FrameStore, fs: Frame[]) => fs.map((f) => store.get(f.id)).filter((x): x is FrameData => !!x);
const byDet = (fs: Frame[], dets: number[]) => fs.filter((f) => dets.includes(f.det));

/** Stacks are cached until more data arrive, so playback only redraws, never recomputes. */
const stackCache = new Map<string, Float32Array | null>();
let cacheVersion = -1;
function cachedStack(store: FrameStore, fs: Frame[], showBad: boolean) {
  if (store.version !== cacheVersion || stackCache.size > 400) { stackCache.clear(); cacheVersion = store.version; }
  const key = `${fs.length}|${fs[0]?.id}|${fs[fs.length - 1]?.id}|${fs.reduce((h, f) => (h * 31 + f.det + f.obs) | 0, 7)}|${showBad ? 1 : 0}`;
  if (!stackCache.has(key)) stackCache.set(key, stack(data(store, fs)));
  return stackCache.get(key)!;
}

/** Panels for one item. Frames mode always shows a single exposure. */
export function buildPanels(it: Item, colours: Colours, store: FrameStore, showBad: boolean): Panel[] {
  const img = (fs: Frame[]) => {
    const a = cachedStack(store, fs, showBad);
    if (!it.ref) return a;
    const b = cachedStack(store, byDet(it.ref, [...new Set(fs.map((f) => f.det))]), showBad);
    return a && b ? combine(a, b, it.op ?? 'sub') : null;
  };
  const kind = it.ref && it.op !== 'add' ? 'diff' : 'heat';
  const bad = (fs: Frame[]) => (showBad ? badFraction(data(store, fs)) : null);
  if (it.frames.length === 1 || colours === 'all' || colours[0] === 'd') return [{ kind, data: img(it.frames), bad: bad(it.frames) }];
  if (colours === 'six') {
    return BANDS.map((b) => {
      const fs = byDet(it.frames, [b.det]);
      return { kind, label: `${b.lo.toFixed(2)}–${b.hi.toFixed(2)} µm`, data: fs.length ? img(fs) : null, bad: bad(fs) };
    });
  }
  // false colour: blue = detectors 1–2 (0.75–1.6 µm), green = 3–4 (1.6–3.8 µm), red = 5–6 (3.8–5 µm)
  const ch = [[5, 6], [3, 4], [1, 2]].map((d) => { const fs = byDet(it.frames, d); return fs.length ? img(fs) : null; });
  if (kind === 'diff') return [{ kind: 'diff', data: img(it.frames), bad: bad(it.frames) }]; // a colour difference is unreadable
  return [{ kind: 'rgb', rgb: ch, bad: bad(it.frames) }];
}

export const gridOf = (count: number) => (count === 6 ? { cols: 3, rows: 2 } : { cols: 1, rows: 1 });
export const GAP = 3; // data pixels between panels

export interface Overlay {
  contrast: number;
  /** true (the default) = sharp SPHEREx pixels, exactly as recorded; false = smoothed for a softer look */
  pixels?: boolean;
  target: Target | null; center: [number, number]; mjd: number; spanMjd: [number, number] | null;
  ring: boolean;
  gaia?: { rows: Array<{ ra: number; dec: number; mag: number; pmra?: number; pmdec?: number }>; epoch: number } | null;
  wise?: { rows: Array<{ ra: number; dec: number; mag: number; pmra?: number; pmdec?: number }>; epoch: number } | null;
  probe?: [number, number] | null;
  marks?: Array<[number, number]>;
  /** auto-found movers (arrows) and one-visit objects (dashed circles), grid pixels */
  finds?: Array<{ kind: 'moving' | 'once'; x0: number; y0: number; x1: number; y1: number; shift: number; dismissed?: boolean }> | null;
  pick?: number;
  compass?: boolean;
}

/** Upscaled frames are cached (blinking alternates a few scenes; panning and zooming redraw the same one). */
const clearCache: Array<{ refs: unknown[]; key: string; canvas: OffscreenCanvas }> = [];
function clearCanvas(panels: Panel[], im: ImageData, Wd: number, Hd: number, k: number, contrast: number): OffscreenCanvas {
  const refs = panels.flatMap((p) => [p.data, p.rgb?.[0], p.rgb?.[1], p.rgb?.[2], p.bad]);
  const key = `${Wd}x${Hd}|${k}|${contrast}`;
  const hit = clearCache.find((c) => c.key === key && c.refs.length === refs.length && c.refs.every((r, i) => r === refs[i]));
  if (hit) return hit.canvas;
  const canvas = new OffscreenCanvas(Wd * k, Hd * k);
  const up = k > 1 ? upscaleBicubic(im.data, Wd, Hd, k) : im.data;
  canvas.getContext('2d')!.putImageData(new ImageData(up, Wd * k, Hd * k), 0, 0);
  clearCache.unshift({ refs, key, canvas });
  if (clearCache.length > 6) clearCache.pop();
  return canvas;
}

/** Draw panels at `scale` CSS px per data pixel into ctx (already DPR-scaled); callers pick scale × DPR as a whole number so every pixel is an exact square. */
export function drawScene(x: CanvasRenderingContext2D, panels: Panel[], n: number, scale: number, o: Overlay) {
  const { cols, rows } = gridOf(panels.length);
  const Wd = cols * n + (cols - 1) * GAP, Hd = rows * n + (rows - 1) * GAP;
  const im = new ImageData(Wd, Hd);
  im.data.fill(0);
  for (let i = 3; i < im.data.length; i += 4) { im.data[i - 3] = 11; im.data[i - 2] = 14; im.data[i - 1] = 20; im.data[i] = 255; }
  panels.forEach((p, k) => {
    const off = Math.floor(k / cols) * (n + GAP) * Wd + (k % cols) * (n + GAP);
    if (p.kind === 'rgb' && p.rgb) paintRgb(im.data, off, p.rgb[0], p.rgb[1], p.rgb[2], n, Wd, o.contrast);
    else if (p.data) (p.kind === 'diff' ? paintDiff : paintHeat)(im.data, off, p.data, n, Wd, o.contrast);
    if (p.bad) paintBad(im.data, off, p.bad, n, Wd);
  });
  if (o.pixels) {
    const off = new OffscreenCanvas(Wd, Hd);
    off.getContext('2d')!.putImageData(im, 0, 0);
    x.imageSmoothingEnabled = false;
    x.drawImage(off, 0, 0, Wd * scale, Hd * scale);
  } else {
    // clear display: bicubic upscale to about one image pixel per device pixel, then a light final resize
    const k = Math.min(8, Math.max(1, Math.ceil(scale * (globalThis.devicePixelRatio || 1))));
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.drawImage(clearCanvas(panels, im, Wd, Hd, k, o.contrast), 0, 0, Wd * scale, Hd * scale);
  }

  const c0 = (n - 1) / 2;
  const toPx = (ra: number, dec: number): [number, number] => { const g = gridOffset(o.center[0], o.center[1], ra, dec, PIXEL_ARCSEC); return [(c0 + g[0] + 0.5) * scale, (c0 + g[1] + 0.5) * scale]; };
  panels.forEach((p, k) => {
    const ox = (k % cols) * (n + GAP) * scale, oy = Math.floor(k / cols) * (n + GAP) * scale, S = n * scale;
    x.save(); x.translate(ox, oy); x.beginPath(); x.rect(0, 0, S, S); x.clip();
    // catalogue overlays
    if (o.wise) {
      x.strokeStyle = 'rgba(127,220,164,.85)'; x.lineWidth = 1.2;
      for (const r of o.wise.rows) {
        // moved to this image's date when CatWISE measured a significant motion
        const yrs = (o.mjd - o.wise.epoch) / 365.25, D = Math.PI / 180;
        const ra = r.ra + ((r.pmra ?? 0) * yrs) / 3.6e6 / Math.cos(r.dec * D), dec = r.dec + ((r.pmdec ?? 0) * yrs) / 3.6e6;
        const [px, py] = toPx(ra, dec), h = Math.max(3, scale * (r.mag < 12 ? 1.5 : 1));
        x.strokeRect(px - h, py - h, 2 * h, 2 * h);
      }
    }
    if (o.gaia) {
      x.lineWidth = 1.3;
      for (const r of o.gaia.rows) {
        const yrs = (o.mjd - o.gaia.epoch) / 365.25, D = Math.PI / 180;
        const ra = r.ra + ((r.pmra ?? 0) * yrs) / 3.6e6 / Math.cos(r.dec * D), dec = r.dec + ((r.pmdec ?? 0) * yrs) / 3.6e6;
        const [px, py] = toPx(ra, dec), rad = Math.max(3, scale * (r.mag < 13 ? 1.7 : r.mag < 17 ? 1.2 : 0.8));
        x.strokeStyle = 'rgba(110,195,255,.9)'; x.beginPath(); x.arc(px, py, rad, 0, Math.PI * 2); x.stroke();
        const pm = Math.hypot(r.pmra ?? 0, r.pmdec ?? 0);
        if (pm > 150 && o.spanMjd) { // fast movers: where the star goes across the whole data set
          const span = (o.spanMjd[1] - o.spanMjd[0]) / 365.25, ex = toPx(ra + ((r.pmra ?? 0) * span) / 3.6e6 / Math.cos(r.dec * D), dec + ((r.pmdec ?? 0) * span) / 3.6e6);
          arrow(x, px, py, ex[0], ex[1], 'rgba(110,195,255,.95)');
        }
      }
    }
    // the target: predicted position at this image's date, and its track over the data
    if (o.ring && o.target) {
      if ((o.target.pmra || o.target.pmdec) && o.spanMjd) {
        const a = toPx(...positionAt(o.target, o.spanMjd[0])), b = toPx(...positionAt(o.target, o.spanMjd[1]));
        x.setLineDash([3, 4]); x.strokeStyle = 'rgba(255,184,77,.6)'; x.lineWidth = 1.5;
        x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke(); x.setLineDash([]);
      }
      const [px, py] = toPx(...positionAt(o.target, o.mjd));
      x.strokeStyle = '#ffb84d'; x.lineWidth = 2; x.beginPath(); x.arc(px, py, Math.max(10, scale * 2.6), 0, Math.PI * 2); x.stroke();
    }
    for (const m of o.marks ?? []) { const [px, py] = toPx(m[0], m[1]); x.strokeStyle = '#ff7a6b'; x.lineWidth = 2; cross(x, px, py, Math.max(7, scale * 1.6)); }
    (o.finds ?? []).forEach((f, k) => {
      if (f.dismissed && k !== o.pick) return; // Gaia says it does not move: not drawn unless selected
      const col = k === o.pick ? '#ffffff' : '#ff5cf0', g = (v: number) => (v + 0.5) * scale;
      x.strokeStyle = col; x.lineWidth = k === o.pick ? 2.4 : 1.8;
      if (f.kind === 'moving') {
        // arrows are stretched to at least ~4 px so a one-pixel shift is still visible
        const k2 = Math.max(1, 4 / Math.max(0.3, f.shift)), ex = f.x0 + (f.x1 - f.x0) * k2, ey = f.y0 + (f.y1 - f.y0) * k2;
        x.beginPath(); x.arc(g(f.x0), g(f.y0), Math.max(6, scale * 1.2), 0, Math.PI * 2); x.stroke();
        arrow(x, g(f.x0), g(f.y0), g(ex), g(ey), col);
      } else { x.setLineDash([3, 3]); x.beginPath(); x.arc(g(f.x0), g(f.y0), Math.max(9, scale * 2), 0, Math.PI * 2); x.stroke(); x.setLineDash([]); }
    });
    if (o.probe) {
      const px = (o.probe[0] + 0.5) * scale, py = (o.probe[1] + 0.5) * scale;
      x.strokeStyle = 'rgba(255,255,255,.95)'; x.lineWidth = 1.5; x.setLineDash([4, 3]);
      x.beginPath(); x.arc(px, py, Math.max(8, scale * 1.6), 0, Math.PI * 2); x.stroke(); x.setLineDash([]);
    }
    if (p.label) { x.font = '600 12px system-ui, sans-serif'; const w = x.measureText(p.label).width; x.fillStyle = 'rgba(11,14,20,.75)'; x.fillRect(6, 6, w + 12, 20); x.fillStyle = '#e8ecf3'; x.fillText(p.label, 12, 20); }
    if (p.data === null && p.kind !== 'rgb') { x.fillStyle = 'rgba(154,166,187,.9)'; x.font = '12px system-ui, sans-serif'; x.textAlign = 'center'; x.fillText('no exposures in this band', S / 2, S / 2); x.textAlign = 'left'; }
    x.restore();
  });
  if (o.compass !== false) {
    const W = cols * n * scale + (cols - 1) * GAP * scale, H = rows * n * scale + (rows - 1) * GAP * scale;
    x.fillStyle = 'rgba(232,236,243,.9)'; x.strokeStyle = 'rgba(232,236,243,.9)'; x.lineWidth = 1.5; x.font = '12px system-ui, sans-serif';
    const cx = W - 30, cy = H - 16;
    x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx, cy - 20); x.moveTo(cx, cy); x.lineTo(cx - 20, cy); x.stroke();
    x.fillText('N', cx - 4, cy - 24); x.fillText('E', cx - 32, cy + 4);
    const one = (60 / PIXEL_ARCSEC) * scale;
    if (one < W / 2) { x.beginPath(); x.moveTo(10, H - 12); x.lineTo(10 + one, H - 12); x.stroke(); x.fillText('1′', 10 + one / 2 - 5, H - 18); }
  }
}

function arrow(x: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string) {
  const a = Math.atan2(y1 - y0, x1 - x0), L = Math.hypot(x1 - x0, y1 - y0);
  if (L < 4) return;
  x.strokeStyle = color; x.fillStyle = color; x.lineWidth = 1.6;
  x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke();
  x.beginPath(); x.moveTo(x1, y1); x.lineTo(x1 - 7 * Math.cos(a - 0.45), y1 - 7 * Math.sin(a - 0.45)); x.lineTo(x1 - 7 * Math.cos(a + 0.45), y1 - 7 * Math.sin(a + 0.45)); x.closePath(); x.fill();
}
function cross(x: CanvasRenderingContext2D, px: number, py: number, r: number) {
  x.beginPath(); x.moveTo(px - r, py - r); x.lineTo(px - r / 2.5, py - r / 2.5); x.moveTo(px + r, py - r); x.lineTo(px + r / 2.5, py - r / 2.5);
  x.moveTo(px - r, py + r); x.lineTo(px - r / 2.5, py + r / 2.5); x.moveTo(px + r, py + r); x.lineTo(px + r / 2.5, py + r / 2.5); x.stroke();
}

/** Size in CSS px for a panel count at a scale. */
export const sceneSize = (count: number, n: number, scale: number) => {
  const { cols, rows } = gridOf(count);
  return [(cols * n + (cols - 1) * GAP) * scale, (rows * n + (rows - 1) * GAP) * scale] as const;
};

/** All-colour stack of a set of frames (cached), for the mover finder. */
export const visitStack = (store: FrameStore, fs: Frame[]) => cachedStack(store, fs, false);

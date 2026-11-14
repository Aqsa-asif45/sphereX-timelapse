/**
 * The sky viewer: one canvas that draws one scene (or two side by side) with the original app's
 * verified renderer, plus zoom, pan, a pointer readout, scale bar and compass.
 *
 * Sharp pixels: the zoom is always a whole number of *device* pixels per SPHEREx pixel and the
 * image is placed on whole device pixels, so every SPHEREx pixel is an exact square, also on
 * displays scaled to 125 % or 150 %. Zoom and pan live here, so they survive every change of
 * visit, band or mode (the viewer is never remounted).
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { gridToSky, PIXEL_ARCSEC } from '../../web/src/astro';
import { drawScene, gridOf, GAP, sceneSize, type Overlay, type Panel } from '../../web/src/scene';
import { Icon } from './icons';
import { isTyping } from './util';

export interface Scene { panels: Panel[]; overlay: Overlay; tag?: string; tagClass?: string }

interface Props {
  n: number;
  scenes: Scene[];
  /** blink cross-fade: draw `scene` over scenes[0] at opacity t */
  fade?: { scene: Scene; t: number } | null;
  center: [number, number] | null;
  zoom: number; onZoom: (z: number) => void;
  /** changing it re-centres the view (new target or field) */
  resetKey: string;
  /** grid pixel to bring to the centre (a selected candidate) */
  focus?: [number, number] | null;
  picking?: boolean;
  onPick?: (gx: number, gy: number) => void;
  caption?: ComponentChildren;
  alt: string;
  children?: ComponentChildren;
}

const SG = 4; // data pixels between side-by-side scenes
const ZMAX = 16;
const BARS = [5, 10, 20, 30, 60, 120, 300, 600, 900]; // arcsec

export function Viewer(p: Props) {
  const box = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<[number, number]>([800, 520]);
  const [view, setView] = useState<{ cx: number; cy: number } | null>(null);
  const [hover, setHover] = useState<{ pos: string; val: string } | null>(null);
  const [full, setFull] = useState(false);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean; id: number } | null>(null);

  useLayoutEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setSize([Math.max(1, e.contentRect.width), Math.max(1, e.contentRect.height)]));
    ro.observe(box.current);
    const fs = () => setFull(document.fullscreenElement === box.current);
    document.addEventListener('fullscreenchange', fs);
    return () => { ro.disconnect(); document.removeEventListener('fullscreenchange', fs); };
  }, []);

  const dims = p.scenes.map((s) => sceneSize(Math.max(1, s.panels.length), p.n, 1));
  const dataW = Math.max(1, dims.reduce((a, d) => a + d[0], 0) + SG * Math.max(0, dims.length - 1));
  const dataH = Math.max(1, ...dims.map((d) => d[1]));
  const dpr = window.devicePixelRatio || 1;
  const fitDev = Math.max(1, Math.floor(Math.min((size[0] - 24) / dataW, (size[1] - 24) / dataH) * dpr));
  const devScaleFor = (z: number) => Math.max(1, Math.round(fitDev * z));
  const scale = devScaleFor(p.zoom) / dpr; // CSS px per SPHEREx pixel
  const cx = view?.cx ?? dataW / 2, cy = view?.cy ?? dataH / 2;
  const ox = Math.round((size[0] / 2 - cx * scale) * dpr) / dpr;
  const oy = Math.round((size[1] / 2 - cy * scale) * dpr) / dpr;
  const sceneX = (k: number) => dims.slice(0, k).reduce((a, d) => a + d[0] + SG, 0);

  useEffect(() => { setView(null); }, [p.resetKey]);
  useEffect(() => { if (p.focus) setView({ cx: p.focus[0] + 0.5, cy: p.focus[1] + 0.5 }); }, [p.focus?.[0], p.focus?.[1]]);

  // draw every render: cheap (stacks are cached), and keeps the picture in step with state
  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const W = Math.round(size[0] * dpr), H = Math.round(size[1] * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const x = c.getContext('2d')!;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, W, H);
    const draw = (s: Scene, k: number) => {
      x.setTransform(dpr, 0, 0, dpr, Math.round((ox + sceneX(k) * scale) * dpr), Math.round(oy * dpr));
      drawScene(x, s.panels, p.n, scale, { ...s.overlay, compass: false });
    };
    p.scenes.forEach((s, k) => { x.globalAlpha = 1; draw(s, k); });
    if (p.fade && p.fade.t > 0.001) { x.globalAlpha = Math.min(1, p.fade.t); draw(p.fade.scene, 0); x.globalAlpha = 1; }
  });

  // latest geometry for the native wheel and key handlers
  const geo = useRef({ ox, oy, scale, dataW, dataH, size, zoom: p.zoom, fitDev });
  geo.current = { ox, oy, scale, dataW, dataH, size, zoom: p.zoom, fitDev };
  const onZoom = useRef(p.onZoom);
  onZoom.current = p.onZoom;

  const zoomTo = (z: number, at?: [number, number]) => {
    const g = geo.current;
    const z2 = Math.min(ZMAX, Math.max(1, +z.toFixed(3)));
    if (z2 === 1) { setView(null); onZoom.current(1); return; }
    const s2 = Math.max(1, Math.round(g.fitDev * z2)) / dpr;
    const m = at ?? [g.size[0] / 2, g.size[1] / 2];
    const ptX = (m[0] - g.ox) / g.scale, ptY = (m[1] - g.oy) / g.scale;
    const clamp = (v: number, hi: number) => Math.min(hi, Math.max(0, v));
    setView({ cx: clamp(ptX - (m[0] - g.size[0] / 2) / s2, g.dataW), cy: clamp(ptY - (m[1] - g.size[1] / 2) / s2, g.dataH) });
    onZoom.current(z2);
  };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomTo(geo.current.zoom * (e.deltaY < 0 ? 1.25 : 0.8), [e.clientX - r.left, e.clientY - r.top]);
    };
    const key = (e: KeyboardEvent) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '+' || e.key === '=') zoomTo(geo.current.zoom * 1.5);
      else if (e.key === '-' || e.key === '_') zoomTo(geo.current.zoom / 1.5);
      else if (e.key === '0') zoomTo(1);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    addEventListener('keydown', key);
    return () => { el.removeEventListener('wheel', wheel); removeEventListener('keydown', key); };
  }, []);

  /** box point → which scene, panel and grid pixel */
  const hit = (mx: number, my: number) => {
    const dx = (mx - ox) / scale, dy = (my - oy) / scale;
    for (let k = 0; k < p.scenes.length; k++) {
      const x0 = sceneX(k), [w, h] = dims[k];
      if (dx < x0 || dx >= x0 + w || dy < 0 || dy >= h) continue;
      const s = p.scenes[k], { cols } = gridOf(Math.max(1, s.panels.length));
      const lx = dx - x0, col = Math.floor(lx / (p.n + GAP)), row = Math.floor(dy / (p.n + GAP));
      const gx = lx - col * (p.n + GAP) - 0.5, gy = dy - row * (p.n + GAP) - 0.5;
      if (gx < -0.5 || gy < -0.5 || gx > p.n - 0.5 || gy > p.n - 0.5) return null;
      return { k, panel: s.panels[row * cols + col], gx, gy };
    }
    return null;
  };

  const local = (e: PointerEvent): [number, number] => { const r = box.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const onDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input, select, .vw-hud-block')) return;
    const [mx, my] = local(e);
    drag.current = { x: mx, y: my, cx, cy, moved: false, id: e.pointerId };
    box.current!.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    const [mx, my] = local(e), d = drag.current;
    if (d && d.id === e.pointerId) {
      if (!d.moved && Math.hypot(mx - d.x, my - d.y) > 4) d.moved = true;
      if (d.moved && p.zoom > 1) {
        const clamp = (v: number, hi: number) => Math.min(hi, Math.max(0, v));
        setView({ cx: clamp(d.cx - (mx - d.x) / scale, dataW), cy: clamp(d.cy - (my - d.y) / scale, dataH) });
        return;
      }
    }
    const h = hit(mx, my);
    if (!h || !p.center) { setHover(null); return; }
    const c0 = (p.n - 1) / 2, [ra, dec] = gridToSky(p.center[0], p.center[1], h.gx - c0, h.gy - c0, PIXEL_ARCSEC);
    const i = Math.round(h.gy) * p.n + Math.round(h.gx), v = h.panel?.data?.[i];
    setHover({
      pos: `RA ${ra.toFixed(4)}°  Dec ${dec >= 0 ? '+' : '−'}${Math.abs(dec).toFixed(4)}°`,
      val: v === undefined ? '' : Number.isFinite(v) ? `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} σ` : 'blank (not measured)',
    });
  };
  const onUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || d.id !== e.pointerId) return;
    const [mx, my] = local(e), h = hit(mx, my);
    if (h && p.onPick) p.onPick(h.gx, h.gy);
  };

  // a scale bar of a round length, 50–150 px long
  const pxPerArcsec = scale / PIXEL_ARCSEC;
  const bar = BARS.find((b) => b * pxPerArcsec >= 50 && b * pxPerArcsec <= 150) ?? BARS.find((b) => b * pxPerArcsec >= 30) ?? 60;
  const barLabel = bar < 60 ? `${bar}″` : `${bar / 60}′`;
  const hasImage = p.scenes.length > 0;

  return (
    <div class={'viewer' + (p.picking ? ' picking' : '') + (p.zoom > 1 ? ' pannable' : '')} ref={box} data-tour="viewer"
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; }} onPointerLeave={() => setHover(null)}>
      <canvas ref={cv} class="vw-canvas" style={{ width: `${size[0]}px`, height: `${size[1]}px`, visibility: hasImage ? 'visible' : 'hidden' }} role="img" aria-label={p.alt} />
      {hasImage && p.scenes.map((s, k) => s.tag && (
        <span class={'vw-tag ' + (s.tagClass ?? '')} style={{ left: `${Math.max(8, ox + sceneX(k) * scale + 8)}px`, top: `${Math.max(8, oy + 8)}px` }}>{s.tag}</span>
      ))}
      {hasImage && (
        <>
          {p.caption && <div class="vw-caption">{p.caption}</div>}
          <div class="vw-zoom vw-hud-block" role="group" aria-label="Zoom">
            <button class="iconbtn" aria-label="Zoom in (+)" title="Zoom in (+)" onClick={() => zoomTo(p.zoom * 1.5)} disabled={p.zoom >= ZMAX}><Icon name="plus" /></button>
            <span class="vw-zoom-v mono" aria-live="polite">{p.zoom === 1 ? 'Fit' : `${p.zoom < 10 ? p.zoom.toFixed(1) : Math.round(p.zoom)}×`}</span>
            <button class="iconbtn" aria-label="Zoom out (−)" title="Zoom out (−)" onClick={() => zoomTo(p.zoom / 1.5)} disabled={p.zoom <= 1}><Icon name="minus" /></button>
            <button class="iconbtn" aria-label="Fit to view (0)" title="Fit to view (0)" onClick={() => zoomTo(1)} disabled={p.zoom === 1 && !view}><Icon name="fit" /></button>
            <button class="iconbtn" aria-label={full ? 'Exit full screen' : 'Full screen'} title={full ? 'Exit full screen' : 'Full screen'}
              onClick={() => (full ? document.exitFullscreen?.() : box.current?.requestFullscreen?.())}><Icon name={full ? 'fit' : 'full'} /></button>
          </div>
          <div class="vw-readout mono" aria-hidden="true">
            {hover ? <><span>{hover.pos}</span>{hover.val && <span class="vw-val">{hover.val}</span>}</> : <span class="vw-hint">Scroll to zoom · drag to pan · click to measure</span>}
          </div>
          <div class="vw-scale" aria-hidden="true">
            <svg width="44" height="44" viewBox="0 0 44 44" class="vw-compass">
              <path d="M30 32V12M30 32H10" stroke="currentColor" stroke-width="1.5" fill="none" />
              <path d="M27 15l3-4 3 4M13 29l-4 3 4 3" stroke="currentColor" stroke-width="1.5" fill="none" />
              <text x="26" y="9" class="vw-ct">N</text><text x="0" y="36" class="vw-ct">E</text>
            </svg>
            <span class="vw-bar"><i style={{ width: `${Math.round(bar * pxPerArcsec)}px` }} /><span class="mono">{barLabel}</span></span>
          </div>
        </>
      )}
      {p.children}
    </div>
  );
}

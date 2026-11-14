/**
 * A scientific scatter chart (dependency-free SVG): points with ±1σ error bars, a robust
 * vertical range (one cosmic-ray hit must not flatten everything; points beyond it are pinned
 * to the edge as triangles), optional SPHEREx band regions and molecule markers, hover and
 * keyboard selection. Points are never joined by smooth curves: lines (when asked for) are
 * straight segments between real measurements.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { BANDS } from '../../web/src/astro';
import { fluxUnit, fmtNum } from './util';

export interface Pt { x: number; y: number; dy?: number; id: string; label: string }
/** `line`: join points with straight segments, but never across an x gap wider than `breakAbove` (no data there) */
export interface Series { name: string; color: string; points: Pt[]; line?: boolean; breakAbove?: number }

/** Where well-known molecules absorb in this range (µm). Shown as "expected position", never as detections. */
export const FEATURES = [
  { x: 3.05, name: 'H₂O ice', long: 'water ice' },
  { x: 3.3, name: 'CH₄', long: 'methane' },
  { x: 4.27, name: 'CO₂ ice', long: 'carbon dioxide ice' },
  { x: 4.67, name: 'CO', long: 'carbon monoxide' },
];

interface Props {
  series: Series[];
  /** yLabel gets the flux unit appended, chosen from the data (µJy, mJy or Jy); values are in µJy */
  xLabel: string; yLabel: string;
  xDomain?: [number, number];
  xTicks?: (lo: number, hi: number) => Array<{ v: number; label: string }>;
  xFmt?: (x: number) => string;
  bands?: boolean; features?: boolean;
  selected?: string | null;
  onSelect?: (p: (Pt & { series: string }) | null) => void;
  height?: number;
  ariaLabel: string;
}

const nice = (lo: number, hi: number, n = 4) => {
  const span = hi - lo || Math.abs(hi) || 1, raw = span / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toPrecision(10));
  return out;
};

/** split sorted points where consecutive x differ by more than `gap` */
function runs(ps: Pt[], gap = Infinity): Pt[][] {
  const out: Pt[][] = [];
  for (const q of ps) { const last = out[out.length - 1]; if (last && q.x - last[last.length - 1].x <= gap) last.push(q); else out.push([q]); }
  return out;
}

export function Chart(p: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  const [hover, setHover] = useState<(Pt & { series: string; sx: number; sy: number }) | null>(null);
  useLayoutEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const H = p.height ?? 250, L = 60, R = 14, T = p.bands || p.features ? 24 : 10, B = 38;
  const all = useMemo(() => p.series.flatMap((s) => s.points.filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y)).map((q) => ({ ...q, series: s.name, color: s.color }))), [p.series]);
  const ordered = useMemo(() => [...all].sort((a, b) => a.x - b.x), [all]);
  if (!all.length) return <div class="chart-empty" ref={wrap}>Nothing measured here yet.</div>;

  const x0 = p.xDomain?.[0] ?? Math.min(...all.map((q) => q.x)), x1 = p.xDomain?.[1] ?? Math.max(...all.map((q) => q.x));
  const xs = x1 - x0 || 1;
  const ys = all.map((q) => q.y).sort((a, b) => a - b), q = (f: number) => ys[Math.min(ys.length - 1, Math.max(0, Math.round(f * (ys.length - 1))))];
  let y0 = ys.length >= 12 ? q(0.02) : ys[0], y1 = ys.length >= 12 ? q(0.98) : ys[ys.length - 1];
  if (ys.length >= 12) { const iqr = q(0.75) - q(0.25); y0 = Math.max(ys[0], Math.min(y0, q(0.25) - 3 * iqr)); y1 = Math.min(ys[ys.length - 1], Math.max(y1, q(0.75) + 3 * iqr)); }
  const pad = (y1 - y0) * 0.1 || Math.abs(y1) * 0.1 || 1; y0 -= pad; y1 += pad;
  const sx = (x: number) => L + ((x - x0) / xs) * (W - L - R);
  const syRaw = (y: number) => T + (1 - (y - y0) / (y1 - y0 || 1)) * (H - T - B);
  const sy = (y: number) => Math.min(H - B, Math.max(T, syRaw(y)));
  const off = (y: number) => y > y1 || y < y0;
  const [yk, yu] = fluxUnit(Math.max(Math.abs(y0), Math.abs(y1)));
  const fmtY = (y: number) => fmtNum(y / yk, 3);
  const xt = p.xTicks ? p.xTicks(x0, x1) : nice(x0, x1, 5).map((v) => ({ v, label: (p.xFmt ?? ((x) => String(x)))(v) }));
  const sel = p.selected ? all.find((a) => a.id === p.selected) : undefined;

  const nearest = (e: MouseEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const mx = ((e.clientX - r.left) / r.width) * W, my = ((e.clientY - r.top) / r.height) * H;
    let best: (typeof all)[number] | null = null, bd = 16;
    for (const a of all) { const d = Math.hypot(sx(a.x) - mx, sy(a.y) - my); if (d < bd) { bd = d; best = a; } }
    return best;
  };
  const key = (e: KeyboardEvent) => {
    if (!p.onSelect || !ordered.length) return;
    const k = sel ? ordered.findIndex((a) => a.id === sel.id) : -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault(); e.stopPropagation();
      const nk = e.key === 'ArrowRight' ? Math.min(ordered.length - 1, k + 1) : Math.max(0, k < 0 ? 0 : k - 1);
      p.onSelect(ordered[nk]);
    } else if (e.key === 'Escape') p.onSelect(null);
  };
  const tip = hover ?? (sel ? { ...sel, sx: sx(sel.x), sy: sy(sel.y) } : null);

  return (
    <div class="chart" ref={wrap}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={p.ariaLabel} tabIndex={p.onSelect ? 0 : undefined}
        onMouseMove={(e) => { const b = nearest(e as unknown as MouseEvent); setHover(b ? { ...b, sx: sx(b.x), sy: sy(b.y) } : null); }}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => { if (p.onSelect) p.onSelect(nearest(e as unknown as MouseEvent)); }}
        onKeyDown={(e) => key(e as unknown as KeyboardEvent)}>
        {p.bands && BANDS.map((b, k) => {
          const a = Math.max(L, sx(b.lo)), z = Math.min(W - R, sx(b.hi));
          return z > a && <g><rect x={a} y={T} width={z - a} height={H - T - B} class={k % 2 ? 'band-b' : 'band-a'} /><text x={(a + z) / 2} y={T - 8} text-anchor="middle" class="band-l">Band {b.det}</text></g>;
        })}
        {nice(y0, y1).map((y) => <g><line x1={L} x2={W - R} y1={sy(y)} y2={sy(y)} class="grid" /><text x={L - 8} y={sy(y) + 4} text-anchor="end" class="tick">{fmtY(y)}</text></g>)}
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} class="axis" />
        {xt.map((t) => t.v >= x0 && t.v <= x1 && <text x={sx(t.v)} y={H - B + 16} text-anchor="middle" class="tick">{t.label}</text>)}
        <text x={(L + W - R) / 2} y={H - 4} text-anchor="middle" class="axis-l">{p.xLabel}</text>
        <text x={14} y={(T + H - B) / 2} text-anchor="middle" class="axis-l" transform={`rotate(-90 14 ${(T + H - B) / 2})`}>{p.yLabel} ({yu})</text>
        {p.features && FEATURES.map((f, k) => (
          <g class="feat"><line x1={sx(f.x)} x2={sx(f.x)} y1={T} y2={H - B} /><text x={sx(f.x) + 3} y={T + 11 + (k % 2) * 12} class="feat-l">{f.name}</text></g>
        ))}
        {p.series.map((s) => {
          const ps = s.points.filter((a) => Number.isFinite(a.x) && Number.isFinite(a.y)).sort((a, b) => a.x - b.x);
          return (
            <g>
              {s.line && ps.length > 1 && runs(ps.filter((a) => !off(a.y)), s.breakAbove).map((run) => run.length > 1 && <polyline points={run.map((a) => `${sx(a.x)},${sy(a.y)}`).join(' ')} fill="none" stroke={s.color} stroke-width="1.2" opacity=".55" />)}
              {ps.map((a) => {
                const X = sx(a.x), Y = sy(a.y);
                if (off(a.y)) { const d = a.y > y1 ? -1 : 1; return <path d={`M${X - 4} ${Y - d * 3} L${X + 4} ${Y - d * 3} L${X} ${Y + d * 3}Z`} fill="none" stroke={s.color} stroke-width="1.3" />; }
                return (
                  <g>
                    {a.dy !== undefined && Number.isFinite(a.dy) && a.dy > 0 && (
                      <path d={`M${X} ${sy(a.y - a.dy)}V${sy(a.y + a.dy)}M${X - 2.5} ${sy(a.y - a.dy)}h5M${X - 2.5} ${sy(a.y + a.dy)}h5`} stroke={s.color} stroke-width="1" opacity=".6" fill="none" />
                    )}
                    <circle cx={X} cy={Y} r="3" fill={s.color} stroke="#07090e" stroke-width=".8" />
                  </g>
                );
              })}
            </g>
          );
        })}
        {sel && !off(sel.y) && <circle cx={sx(sel.x)} cy={sy(sel.y)} r="7" fill="none" stroke="#edf1f6" stroke-width="1.6" />}
      </svg>
      {tip && (
        <div class="chart-tip mono" style={{ left: `${Math.max(4, Math.min(tip.sx + 12, W - 236))}px`, top: `${Math.max(4, tip.sy - 52)}px` }} aria-hidden="true">
          <b>{tip.series}</b>{tip.label}{off(tip.y) ? ' (off scale)' : ''}
        </div>
      )}
      {p.series.length > 1 && <div class="chart-keys">{p.series.map((s) => <span><i style={{ background: s.color }} />{s.name}</span>)}</div>}
    </div>
  );
}

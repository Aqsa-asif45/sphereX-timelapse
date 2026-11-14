/** Small dependency-free SVG scatter/line chart for spectra and light curves. */
import { useState } from 'preact/hooks';

export interface Series { name: string; color: string; points: Array<{ x: number; y: number; dy?: number; label?: string }>; line?: boolean }

interface Props {
  series: Series[]; xLabel: string; yLabel: string; height?: number;
  xFmt?: (x: number) => string; xMin?: number; xMax?: number; ariaLabel: string;
}

const nice = (lo: number, hi: number, n = 4) => {
  const span = hi - lo || Math.abs(hi) || 1, raw = span / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toPrecision(10));
  return out;
};

export function Chart({ series, xLabel, yLabel, height = 170, xFmt = (x) => String(+x.toFixed(2)), xMin, xMax, ariaLabel }: Props) {
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const W = 300, H = height, L = 46, R = 8, T = 10, B = 30;
  const pts = series.flatMap((s) => s.points).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!pts.length) return <p class="note">Not enough data here yet.</p>;
  const x0 = xMin ?? Math.min(...pts.map((p) => p.x)), x1 = xMax ?? Math.max(...pts.map((p) => p.x));
  // robust vertical range: one cosmic-ray hit should not flatten everything else.
  // Outliers beyond it are drawn as triangles pinned to the edge.
  const ys = pts.map((p) => p.y).sort((a, b) => a - b), q = (f: number) => ys[Math.min(ys.length - 1, Math.max(0, Math.round(f * (ys.length - 1))))];
  let y0 = ys.length >= 12 ? q(0.02) : ys[0], y1 = ys.length >= 12 ? q(0.98) : ys[ys.length - 1];
  if (ys.length >= 12) { const iqr = q(0.75) - q(0.25); y0 = Math.max(ys[0], Math.min(y0, q(0.25) - 3 * iqr)); y1 = Math.min(ys[ys.length - 1], Math.max(y1, q(0.75) + 3 * iqr)); }
  const pad = (y1 - y0) * 0.08 || Math.abs(y1) * 0.1 || 1; y0 -= pad; y1 += pad;
  const sx = (x: number) => L + ((x - x0) / (x1 - x0 || 1)) * (W - L - R), syRaw = (y: number) => T + (1 - (y - y0) / (y1 - y0 || 1)) * (H - T - B);
  const sy = (y: number) => Math.min(H - B, Math.max(T, syRaw(y)));
  const out = (y: number) => y > y1 || y < y0;
  const fmtY = (y: number) => (Math.abs(y) >= 1000 ? `${+(y / 1000).toPrecision(3)}k` : String(+y.toPrecision(3)));
  return (
    <div class="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        {nice(y0, y1).map((y) => <g><line x1={L} x2={W - R} y1={sy(y)} y2={sy(y)} class="grid" /><text x={L - 6} y={sy(y) + 3.5} text-anchor="end" class="tl">{fmtY(y)}</text></g>)}
        {nice(x0, x1, 5).map((x) => <text x={sx(x)} y={H - B + 14} text-anchor="middle" class="tl">{xFmt(x)}</text>)}
        <text x={(L + W - R) / 2} y={H - 3} text-anchor="middle" class="al">{xLabel}</text>
        <text x={11} y={(T + H - B) / 2} text-anchor="middle" class="al" transform={`rotate(-90 11 ${(T + H - B) / 2})`}>{yLabel}</text>
        {series.map((s) => {
          const ps = s.points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).sort((a, b) => a.x - b.x);
          return (
            <g>
              {s.line && ps.length > 1 && <polyline points={ps.filter((p) => !out(p.y)).map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')} fill="none" stroke={s.color} stroke-width="1.4" opacity=".75" />}
              {ps.map((p) => {
                const hov = () => setHover({ x: sx(p.x), y: sy(p.y), text: (p.label ?? `${xFmt(p.x)}: ${fmtY(p.y)}`) + (out(p.y) ? ' (off scale)' : '') });
                if (out(p.y)) {
                  const X = sx(p.x), Y = sy(p.y), d = p.y > y1 ? -1 : 1;
                  return <path d={`M${X - 3.5} ${Y - d * 3} L${X + 3.5} ${Y - d * 3} L${X} ${Y + d * 2}Z`} fill="none" stroke={s.color} stroke-width="1.2" onMouseEnter={hov} />;
                }
                return <circle cx={sx(p.x)} cy={sy(p.y)} r="2.6" fill={s.color} stroke="#0b0e14" stroke-width=".6" onMouseEnter={hov} />;
              })}
            </g>
          );
        })}
        {hover && <g pointer-events="none"><rect x={Math.min(hover.x + 6, W - 150)} y={Math.max(0, hover.y - 22)} width="144" height="18" rx="4" fill="#0b0e14" stroke="#253048" /><text x={Math.min(hover.x + 12, W - 144)} y={Math.max(0, hover.y - 22) + 12.5} class="tt">{hover.text}</text></g>}
      </svg>
      {series.length > 1 && <div class="keys">{series.map((s) => <span><i style={{ background: s.color }} />{s.name}</span>)}</div>}
    </div>
  );
}

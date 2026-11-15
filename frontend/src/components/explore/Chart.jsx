import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BANDS } from '../../lib/astro'
import { FEATURES, fluxUnit, fmtNum } from '../../lib/photometry'

const nice = (lo, hi, n = 4) => {
  const span = hi - lo || Math.abs(hi) || 1
  const raw = span / n
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const out = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toPrecision(10))
  return out
}

/** Split sorted points where consecutive x differ by more than `gap` (no line across months without data). */
function runs(ps, gap = Infinity) {
  const out = []
  for (const q of ps) {
    const last = out[out.length - 1]
    if (last && q.x - last[last.length - 1].x <= gap) last.push(q)
    else out.push([q])
  }
  return out
}

/**
 * A scientific scatter chart in SVG (ported from the old site): points with ±1σ error bars, a robust
 * vertical range (points beyond it are pinned to the edge as triangles), optional SPHEREx band regions and
 * molecule markers, hover, click and keyboard selection. Lines, when asked for, are straight segments
 * between real measurements and never cross a gap wider than `breakAbove`.
 * Values are in µJy; the unit shown (µJy, mJy, Jy) is chosen from the data.
 * @param {{ series: Array<{name:string, color:string, points:Array<{x:number,y:number,dy?:number,id:string,label:string}>,
 *   line?:boolean, breakAbove?:number}>, xLabel:string, yLabel:string, xDomain?:[number,number],
 *   xTicks?:(lo:number,hi:number)=>Array<{v:number,label:string}>, bands?:boolean, features?:boolean,
 *   selected?:string|null, onSelect?:(p:object|null)=>void, ariaLabel:string }} p
 */
export default function Chart(p) {
  const wrap = useRef(null)
  const [W, setW] = useState(640)
  const [hover, setHover] = useState(null)
  useLayoutEffect(() => {
    if (!wrap.current || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)))
    ro.observe(wrap.current)
    return () => ro.disconnect()
  }, [])
  const all = useMemo(
    () => p.series.flatMap((s) => s.points.filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y)).map((q) => ({ ...q, series: s.name, color: s.color }))),
    [p.series],
  )
  const ordered = useMemo(() => [...all].sort((a, b) => a.x - b.x), [all])
  if (!all.length)
    return (
      <div ref={wrap} className="py-7 text-center text-sm text-ink-3">
        Nothing measured here yet.
      </div>
    )

  const H = 250
  const L = 60
  const R = 14
  const T = p.bands || p.features ? 24 : 10
  const B = 38
  const x0 = p.xDomain?.[0] ?? Math.min(...all.map((q) => q.x))
  const x1 = p.xDomain?.[1] ?? Math.max(...all.map((q) => q.x))
  const xs = x1 - x0 || 1
  const ys = all.map((q) => q.y).sort((a, b) => a - b)
  const q = (f) => ys[Math.min(ys.length - 1, Math.max(0, Math.round(f * (ys.length - 1))))]
  let y0 = ys.length >= 12 ? q(0.02) : ys[0]
  let y1 = ys.length >= 12 ? q(0.98) : ys[ys.length - 1]
  if (ys.length >= 12) {
    const iqr = q(0.75) - q(0.25)
    y0 = Math.max(ys[0], Math.min(y0, q(0.25) - 3 * iqr))
    y1 = Math.min(ys[ys.length - 1], Math.max(y1, q(0.75) + 3 * iqr))
  }
  const pad = (y1 - y0) * 0.1 || Math.abs(y1) * 0.1 || 1
  y0 -= pad
  y1 += pad
  const sx = (x) => L + ((x - x0) / xs) * (W - L - R)
  const sy = (y) => Math.min(H - B, Math.max(T, T + (1 - (y - y0) / (y1 - y0 || 1)) * (H - T - B)))
  const off = (y) => y > y1 || y < y0
  const [yk, yu] = fluxUnit(Math.max(Math.abs(y0), Math.abs(y1)))
  const xt = p.xTicks ? p.xTicks(x0, x1) : nice(x0, x1, 5).map((v) => ({ v, label: String(v) }))
  const sel = p.selected ? all.find((a) => a.id === p.selected) : undefined

  const nearest = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const mx = ((e.clientX - r.left) / r.width) * W
    const my = ((e.clientY - r.top) / r.height) * H
    let best = null
    let bd = 16
    for (const a of all) {
      const d = Math.hypot(sx(a.x) - mx, sy(a.y) - my)
      if (d < bd) {
        bd = d
        best = a
      }
    }
    return best
  }
  const key = (e) => {
    if (!p.onSelect || !ordered.length) return
    const k = sel ? ordered.findIndex((a) => a.id === sel.id) : -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      e.stopPropagation()
      p.onSelect(ordered[e.key === 'ArrowRight' ? Math.min(ordered.length - 1, k + 1) : Math.max(0, k < 0 ? 0 : k - 1)])
    } else if (e.key === 'Escape') p.onSelect(null)
  }
  const tip = hover ?? (sel ? { ...sel, sx: sx(sel.x), sy: sy(sel.y) } : null)
  const tick = { fontSize: 11, fontFamily: 'var(--font-mono)', fill: 'var(--color-ink-3)' }

  return (
    <div ref={wrap} className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className="block max-w-full overflow-visible"
        role="img"
        aria-label={p.ariaLabel}
        tabIndex={p.onSelect ? 0 : undefined}
        onMouseMove={(e) => {
          const b = nearest(e)
          setHover(b ? { ...b, sx: sx(b.x), sy: sy(b.y) } : null)
        }}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => p.onSelect?.(nearest(e))}
        onKeyDown={key}
        data-testid="chart"
      >
        {p.bands &&
          BANDS.map((b, k) => {
            const a = Math.max(L, sx(b.lo))
            const z = Math.min(W - R, sx(b.hi))
            return (
              z > a && (
                <g key={b.det}>
                  <rect x={a} y={T} width={z - a} height={H - T - B} fill={`rgba(166,154,255,${k % 2 ? 0.018 : 0.055})`} />
                  <text x={(a + z) / 2} y={T - 8} textAnchor="middle" style={{ ...tick, fontSize: 10 }}>
                    Band {b.det}
                  </text>
                </g>
              )
            )
          })}
        {nice(y0, y1).map((y) => (
          <g key={y}>
            <line x1={L} x2={W - R} y1={sy(y)} y2={sy(y)} stroke="var(--color-line)" />
            <text x={L - 8} y={sy(y) + 4} textAnchor="end" style={tick}>
              {fmtNum(y / yk, 3)}
            </text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="var(--color-line-2)" />
        {xt.map(
          (t) =>
            t.v >= x0 &&
            t.v <= x1 && (
              <text key={t.v} x={sx(t.v)} y={H - B + 16} textAnchor="middle" style={tick}>
                {t.label}
              </text>
            ),
        )}
        <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle" fontSize="12" fill="var(--color-ink-2)">
          {p.xLabel}
        </text>
        <text x={14} y={(T + H - B) / 2} textAnchor="middle" fontSize="12" fill="var(--color-ink-2)" transform={`rotate(-90 14 ${(T + H - B) / 2})`}>
          {p.yLabel} ({yu})
        </text>
        {p.features &&
          FEATURES.map((f, k) => (
            <g key={f.x}>
              <line x1={sx(f.x)} x2={sx(f.x)} y1={T} y2={H - B} stroke="#a69aff" strokeDasharray="3 3" opacity=".75" />
              <text x={sx(f.x) + 3} y={T + 11 + (k % 2) * 12} fontSize="10.5" fontWeight="500" fill="#a69aff">
                {f.name}
              </text>
            </g>
          ))}
        {p.series.map((s) => {
          const ps = s.points.filter((a) => Number.isFinite(a.x) && Number.isFinite(a.y)).sort((a, b) => a.x - b.x)
          return (
            <g key={s.name}>
              {s.line &&
                ps.length > 1 &&
                runs(
                  ps.filter((a) => !off(a.y)),
                  s.breakAbove,
                ).map(
                  (run, k) =>
                    run.length > 1 && (
                      <polyline key={k} points={run.map((a) => `${sx(a.x)},${sy(a.y)}`).join(' ')} fill="none" stroke={s.color} strokeWidth="1.2" opacity=".55" />
                    ),
                )}
              {ps.map((a) => {
                const X = sx(a.x)
                const Y = sy(a.y)
                if (off(a.y)) {
                  const d = a.y > y1 ? -1 : 1
                  return <path key={a.id} d={`M${X - 4} ${Y - d * 3} L${X + 4} ${Y - d * 3} L${X} ${Y + d * 3}Z`} fill="none" stroke={s.color} strokeWidth="1.3" />
                }
                return (
                  <g key={a.id}>
                    {Number.isFinite(a.dy) && a.dy > 0 && (
                      <path
                        d={`M${X} ${sy(a.y - a.dy)}V${sy(a.y + a.dy)}M${X - 2.5} ${sy(a.y - a.dy)}h5M${X - 2.5} ${sy(a.y + a.dy)}h5`}
                        stroke={s.color}
                        strokeWidth="1"
                        opacity=".6"
                        fill="none"
                      />
                    )}
                    <circle cx={X} cy={Y} r="3" fill={s.color} stroke="#07090e" strokeWidth=".8" />
                  </g>
                )
              })}
            </g>
          )
        })}
        {sel && !off(sel.y) && <circle cx={sx(sel.x)} cy={sy(sel.y)} r="7" fill="none" stroke="#edf1f6" strokeWidth="1.6" />}
      </svg>
      {tip && (
        <div
          className="pointer-events-none absolute z-10 max-w-[232px] rounded-ctl border border-line-2 bg-raised px-2 py-1 font-mono text-[11.5px] text-ink-2 shadow-lg"
          style={{ left: `${Math.max(4, Math.min(tip.sx + 12, W - 236))}px`, top: `${Math.max(4, tip.sy - 52)}px` }}
          aria-hidden="true"
        >
          <b className="block font-sans text-xs text-ink">{tip.series}</b>
          {tip.label}
          {off(tip.y) ? ' (off scale)' : ''}
        </div>
      )}
      {p.series.length > 1 && (
        <div className="mt-1 flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-ink-2">
          {p.series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <i className="h-2.5 w-2.5 rounded-[2px]" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

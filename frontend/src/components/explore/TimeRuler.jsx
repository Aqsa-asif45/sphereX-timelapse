import { Fragment, useLayoutEffect, useRef, useState } from 'react'
import { fmtGap, fmtMonth, fmtSpan, plural, wlColor } from '../../lib/astro'

const MIN_W = 84
const PAD = 10
/** a long gap (a new survey pass) gets a labelled break; a short one (a pass cut into months) a thin seam */
const gapW = (days) => (days > 45 ? 62 : 10)

/**
 * The time ruler. SPHEREx visits a spot for days to weeks, then not for about six months, so a linear time
 * axis would be mostly empty. Each visit gets its own block (true time inside it) and long gaps are breaks
 * labelled with their real length. Ticks are single exposures, coloured by the wavelength they measured.
 */
export default function TimeRuler({ visits, band, view, cur, exposures, a, b, onVisit, onExposure }) {
  const wrap = useRef(null)
  const [W, setW] = useState(600)
  useLayoutEffect(() => {
    if (!wrap.current || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(wrap.current)
    return () => ro.disconnect()
  }, [])

  const nv = visits.length
  if (!nv) return null
  const gaps = visits.slice(1).map((v, i) => gapW(v.start - visits[i].end))
  const before = gaps.reduce((acc, g) => [...acc, acc[acc.length - 1] + g], [0])
  const inner = Math.max(W, nv * MIN_W + before[nv - 1])
  const cw = (inner - before[nv - 1]) / nv
  const vx = (i) => i * cw + before[i]
  const within = (v, mjd) => PAD + (v.end - v.start < 0.01 ? (cw - 2 * PAD) / 2 : ((mjd - v.start) / (v.end - v.start)) * (cw - 2 * PAD))
  const inBand = (f) => !band || f.det === band
  const compare = ['blink', 'side', 'diff', 'combine'].includes(view)
  const curFrame = view === 'exposures' ? exposures[cur] : undefined
  const curVisit = curFrame ? visits.findIndex((v) => curFrame.mjd >= v.start - 1e-6 && curFrame.mjd <= v.end + 1e-6) : -1

  const click = (v, e) => {
    if (view !== 'exposures') return onVisit(v.i, e.shiftKey)
    // the exposure (in the shown band) nearest the clicked time inside this visit
    const r = e.currentTarget.getBoundingClientRect()
    const t = v.start + Math.min(1, Math.max(0, (e.clientX - r.left - PAD) / Math.max(1, cw - 2 * PAD))) * (v.end - v.start)
    let best = -1
    let bd = Infinity
    exposures.forEach((f, k) => {
      if (f.mjd >= v.start - 1e-6 && f.mjd <= v.end + 1e-6 && Math.abs(f.mjd - t) < bd) {
        bd = Math.abs(f.mjd - t)
        best = k
      }
    })
    if (best >= 0) onExposure(best)
  }

  return (
    <div ref={wrap} className="overflow-x-auto pb-1" data-testid="time-ruler">
      <div className="relative h-20" style={{ width: `${inner}px` }}>
        {visits.map((v, i) => {
          const fs = v.frames.filter(inBand)
          const on = view === 'play' ? i === cur : view === 'exposures' ? i === curVisit : false
          const pinA = compare && i === a
          const pinB = compare && i === b
          const label = `Visit ${i + 1}, ${fmtSpan(v.start, v.end)}, ${plural(fs.length, 'exposure')}${pinA ? ', compared as A' : ''}${pinB ? ', compared as B' : ''}`
          return (
            <Fragment key={i}>
              <button
                type="button"
                aria-label={label}
                aria-pressed={view === 'play' ? on : compare ? pinA || pinB : undefined}
                onClick={(e) => click(v, e)}
                style={{ left: `${vx(i)}px`, width: `${cw}px` }}
                className={`absolute top-0 h-full rounded-ctl border text-left ${on ? 'border-focus bg-focus/10' : pinA ? 'border-time bg-time/10' : pinB ? 'border-earlier bg-earlier/10' : 'border-line-2 bg-panel hover:bg-hover'}`}
              >
                <span aria-hidden="true" className="absolute inset-x-0 top-2 h-4">
                  {fs.map((f) => (
                    <i key={f.id} className="absolute top-0 h-4 w-px" style={{ left: `${within(v, f.mjd)}px`, background: wlColor(f.lambda_um) }} />
                  ))}
                </span>
                {(pinA || pinB) && (
                  <span aria-hidden="true" className="absolute top-1 right-1 flex gap-0.5 text-[10px] font-semibold">
                    {pinB && <span className="rounded bg-earlier px-1 text-bg">B</span>}
                    {pinA && <span className="rounded bg-time px-1 text-bg">A</span>}
                  </span>
                )}
                <span className="absolute inset-x-2 bottom-1.5 grid text-xs leading-tight">
                  <b className="font-medium text-ink">Visit {i + 1}</b>
                  <span className="truncate text-ink-3">{cw >= 112 ? fmtSpan(v.start, v.end) : fmtMonth(v.mjd)}</span>
                </span>
              </button>
              {i < nv - 1 && gaps[i] > 20 && (
                <span
                  className="absolute top-0 flex h-full flex-col items-center justify-center text-center text-[10px] leading-tight text-ink-3"
                  style={{ left: `${vx(i) + cw}px`, width: `${gaps[i]}px` }}
                >
                  <span aria-hidden="true">⫽</span>
                  {fmtGap(visits[i + 1].start - v.end)}
                </span>
              )}
            </Fragment>
          )
        })}
        {curFrame && curVisit >= 0 && (
          <span
            aria-hidden="true"
            className="absolute top-0 h-full w-0.5 bg-focus"
            style={{ left: `${vx(curVisit) + within(visits[curVisit], curFrame.mjd)}px` }}
          />
        )}
      </div>
    </div>
  )
}

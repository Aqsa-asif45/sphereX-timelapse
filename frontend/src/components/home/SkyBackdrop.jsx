import { useEffect, useRef, useState } from 'react'

/**
 * The home backdrop (docs/HOME_REDESIGN_PLAN.md, H3): NASA's SPHEREx DR1 all-sky map in false colour (three wavelengths), built by
 * `python -m app.cli backdrop` (H1) into public/backdrop/. Decoration only, never for measurements
 * (science rule 6). The map is two layers that add back to it exactly ("stars" drawn over "faint" with
 * plus-lighter), so they can move by different amounts for depth.
 *
 * Motion: a slow drift, plus a small shift and a few degrees of tilt that follow the cursor (fine pointers
 * only; phones get the drift without motion-sensor prompts). Only transform and opacity change (SRS 8.7).
 * It pauses while the tab is hidden or the backdrop is off screen, and stands still with "reduce motion"
 * (NF-11). A tiny blurred poster paints first; the layers fade in over it when they arrive (NF-1).
 */

export const BACKDROP_LABEL =
  'SPHEREx all-sky map in false colour (4.6, 2.1, 1.1 µm as red, green, blue; DR1)'
/** The short version shown on the page; the long one is on hover. */
export const BACKDROP_SHORT =
  'NASA SPHEREx all-sky map'

const DIR = '/backdrop/'
const srcSet = (layer) =>
  `${DIR}sky-phone-${layer}.webp 1200w, ${DIR}sky-desktop-${layer}.webp 2400w`

const DRIFT_PERIOD_S = 140 // one slow sway left and back
const LAYERS = {
  faint: { drift: 10, cursor: 10 }, // px at the extremes
  stars: { drift: 22, cursor: 26 },
}
const TILT_DEG = 2.5

const media = (q) =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(q)

/** @param {{ dim?: boolean, className?: string }} props  dim: still and darker (the splash) */
export default function SkyBackdrop({ dim = false, className = '' }) {
  const root = useRef(null)
  const stack = useRef(null)
  const faint = useRef(null)
  const stars = useRef(null)
  const [loaded, setLoaded] = useState({ faint: false, stars: false })

  useEffect(() => {
    if (dim) return undefined
    const reduce = media('(prefers-reduced-motion: reduce)')
    const fine = media('(hover: hover) and (pointer: fine)')
    let raf = 0
    let visible = true
    let t0 = performance.now()
    const target = { x: 0, y: 0 }
    const now = { x: 0, y: 0 }

    const place = (drift) => {
      if (stack.current) {
        stack.current.style.transform = `perspective(1400px) rotateY(${now.x * TILT_DEG}deg) rotateX(${-now.y * TILT_DEG * 0.6}deg)`
      }
      for (const [name, el] of [
        ['faint', faint.current],
        ['stars', stars.current],
      ]) {
        if (!el) continue
        const L = LAYERS[name]
        const x = drift * L.drift + now.x * L.cursor
        const y = drift * L.drift * 0.25 + now.y * L.cursor * 0.6
        el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`
      }
    }

    const frame = (t) => {
      now.x += (target.x - now.x) * 0.05
      now.y += (target.y - now.y) * 0.05
      place(Math.sin(((t - t0) / 1000 / DRIFT_PERIOD_S) * 2 * Math.PI))
      raf = requestAnimationFrame(frame)
    }

    const running = () => !reduce?.matches && visible && document.visibilityState === 'visible'
    const sync = () => {
      cancelAnimationFrame(raf)
      raf = 0
      if (running()) raf = requestAnimationFrame(frame)
      else if (reduce?.matches) {
        now.x = now.y = target.x = target.y = 0
        t0 = performance.now()
        place(0)
      }
    }

    const onPointer = (e) => {
      if (!fine?.matches) return
      target.x = (e.clientX / window.innerWidth) * 2 - 1
      target.y = (e.clientY / window.innerHeight) * 2 - 1
    }
    const onLeave = () => {
      target.x = target.y = 0
    }

    const io =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting
            sync()
          })
        : null
    if (io && root.current) io.observe(root.current)
    window.addEventListener('pointermove', onPointer, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
    document.addEventListener('visibilitychange', sync)
    reduce?.addEventListener?.('change', sync)
    sync()
    return () => {
      cancelAnimationFrame(raf)
      io?.disconnect()
      window.removeEventListener('pointermove', onPointer)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      document.removeEventListener('visibilitychange', sync)
      reduce?.removeEventListener?.('change', sync)
    }
  }, [dim])

  const img =
    // which part of the sky shows: chosen on the real map to avoid NASA's masked holes (phones: none at all;
    // portrait tablets: one small one); wide screens zoom in instead (below)
    'absolute inset-0 h-full w-full object-cover object-[32%_50%] sm:object-[40%_50%] lg:object-center transition-opacity duration-1000 ease-out'
  return (
    <div
      ref={root}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden bg-bg ${className}`}
    >
      {/* a little larger than the box, so drifting and tilting never show an edge */}
      <div ref={stack} className="absolute -inset-[6%] will-change-transform">
        {/* wide screens: 1.25× zoom, with the galactic centre (and its masked holes) behind the dark text side */}
        <div className="absolute inset-0 lg:origin-[104%_50%] lg:scale-125">
          <img
            src={`${DIR}sky-poster.webp`}
            alt=""
            className={`${img} scale-105 blur-md ${loaded.faint ? 'opacity-0' : 'opacity-100'}`}
            decoding="async"
          />
          <img
            ref={faint}
            srcSet={srcSet('faint')}
            sizes="112vw"
            src={`${DIR}sky-desktop-faint.webp`}
            alt=""
            decoding="async"
            fetchPriority="high"
            onLoad={() => setLoaded((s) => ({ ...s, faint: true }))}
            className={`${img} will-change-transform ${loaded.faint ? 'opacity-100' : 'opacity-0'}`}
          />
          <img
            ref={stars}
            srcSet={srcSet('stars')}
            sizes="112vw"
            src={`${DIR}sky-desktop-stars.webp`}
            alt=""
            decoding="async"
            onLoad={() => setLoaded((s) => ({ ...s, stars: true }))}
            style={{ mixBlendMode: 'plus-lighter' }}
            className={`${img} will-change-transform ${loaded.stars && loaded.faint ? 'opacity-100' : 'opacity-0'}`}
          />
        </div>
      </div>
      {/* dark veil: keeps hero text at 8:1 or more and the navbar at 5:1 or more over the bright galactic
          centre (NF-10, measured on the real map at 390, 1024 and 1440 px); phones darker, text spans the width */}
      <div className={`absolute inset-0 ${dim ? 'bg-bg/70' : 'bg-bg/55 sm:bg-bg/10'}`} />
      <div className="absolute inset-0 bg-gradient-to-r from-bg/90 via-bg/75 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-bg" />
    </div>
  )
}

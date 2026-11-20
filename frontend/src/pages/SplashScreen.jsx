import { motion } from 'motion/react'
import { useEffect, useRef } from 'react'

const DURATION_MS = 2500
const GATHER_S = 1.3 // when the stars meet
const COUNT = 170
// cool starlight: white, ice-blue, violet and teal (the amber is kept for the TimeLens ring only)
const TINTS = ['255,255,255', '200,225,255', '165,190,255', '190,170,255', '150,230,240']

/** Ease-in: slow at the edges, fast as the stars reach the centre. */
const easeIn = (t) => t * t * t

/**
 * Stars stream in from every edge and gather at the centre, with short light trails. Drawn cheaply: one path
 * per colour per frame, normal blending, and the glow painted only around the centre.
 */
function Gather() {
  const canvas = useRef(null)
  useEffect(() => {
    const c = canvas.current
    const x = c?.getContext?.('2d')
    if (!x) return undefined
    const dpr = Math.min(1.5, window.devicePixelRatio || 1)
    const stars = Array.from({ length: COUNT }, () => ({
      a: Math.random() * Math.PI * 2,
      r: 0.55 + Math.random() * 0.5, // start distance, in half-diagonals
      delay: Math.random() * 0.45,
      dur: GATHER_S - 0.45 + Math.random() * 0.4,
      wide: Math.random() < 0.3, // a few brighter, thicker ones
      tint: (Math.random() * TINTS.length) | 0,
      swirl: (Math.random() - 0.5) * 0.9, // a slight spiral on the way in
    }))
    let raf = 0
    let W = 0
    let H = 0
    const size = () => {
      W = c.clientWidth
      H = c.clientHeight
      c.width = Math.round(W * dpr)
      c.height = Math.round(H * dpr)
      x.setTransform(dpr, 0, 0, dpr, 0, 0)
      x.lineCap = 'round'
    }
    size()
    const t0 = performance.now()
    const draw = (now) => {
      x.clearRect(0, 0, W, H)
      const cx = W / 2
      const cy = H / 2 - 40
      const R = Math.hypot(W, H) / 2
      const t = (now - t0) / 1000
      // one path per colour and width: a few strokes per frame instead of one per star
      for (let k = 0; k < TINTS.length; k++) {
        for (const wide of [false, true]) {
          x.beginPath()
          let any = false
          for (const s of stars) {
            if (s.tint !== k || s.wide !== wide) continue
            const p = Math.min(1, Math.max(0, (t - s.delay) / s.dur))
            if (p <= 0 || p >= 1) continue
            const e = easeIn(p)
            const eb = easeIn(Math.max(0, p - 0.07))
            const a = s.a + s.swirl * e
            const ab = s.a + s.swirl * eb
            x.moveTo(cx + Math.cos(ab) * s.r * R * (1 - eb), cy + Math.sin(ab) * s.r * R * (1 - eb))
            x.lineTo(cx + Math.cos(a) * s.r * R * (1 - e), cy + Math.sin(a) * s.r * R * (1 - e))
            any = true
          }
          if (!any) continue
          x.strokeStyle = `rgba(${TINTS[k]},${wide ? 0.95 : 0.6})`
          x.lineWidth = wide ? 1.8 : 0.9
          x.stroke()
        }
      }
      // the gathering point glows brighter as stars arrive (painted only around the centre)
      const g = Math.min(1, t / GATHER_S)
      const r = 40 + 90 * g
      const glow = x.createRadialGradient(cx, cy, 0, cx, cy, r)
      glow.addColorStop(0, `rgba(225,235,255,${0.12 + 0.55 * g * g})`)
      glow.addColorStop(1, 'rgba(150,160,255,0)')
      x.fillStyle = glow
      x.fillRect(cx - r, cy - r, r * 2, r * 2)
      if (t < GATHER_S + 0.6) raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    window.addEventListener('resize', size)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', size)
    }
  }, [])
  return <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-hidden="true" />
}

/**
 * The first-visit splash: stars stream in from every edge and gather into one point, it flares, the
 * TimeLens ring opens out of the flare, and the name rises; then it fades into Home. Solid behind, so the page
 * never shows through until it fades. Click, Enter, Escape or Space skips it; it is never shown to people who
 * prefer reduced motion (App.jsx). Home is loaded underneath, so it never blocks.
 */
export default function SplashScreen({ onDone }) {
  useEffect(() => {
    const timer = setTimeout(onDone, DURATION_MS)
    const onKey = (e) => {
      if (['Enter', 'Escape', ' '].includes(e.key)) {
        e.preventDefault()
        onDone()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('keydown', onKey)
    }
  }, [onDone])

  const after = (s) => ({ delay: GATHER_S + s, duration: 0.6, ease: [0.22, 1, 0.36, 1] })

  return (
    <motion.div
      role="dialog"
      aria-label="SPHEREx TimeLens"
      data-testid="splash"
      onClick={onDone}
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.08, transition: { duration: 0.45, ease: [0.4, 0, 1, 1] } }}
      className="fixed inset-0 z-50 isolate cursor-pointer overflow-hidden"
      style={{ background: 'radial-gradient(120% 90% at 50% 45%, #0b1020 0%, #05070c 70%)' }}
    >
      <Gather />

      {/* the flare where the stars meet */}
      <motion.div
        aria-hidden="true"
        className="absolute top-[calc(50%-40px)] left-1/2 h-[55vmin] w-[55vmin] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(235,242,255,.8) 0%, rgba(140,170,255,.3) 18%, rgba(124,92,255,.12) 40%, transparent 65%)' }}
        initial={{ opacity: 0, scale: 0.2 }}
        animate={{ opacity: [0, 1, 0.35], scale: [0.2, 1, 1.15] }}
        transition={{ delay: GATHER_S - 0.1, duration: 1.1, times: [0, 0.3, 1], ease: 'easeOut' }}
      />

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 pb-20 text-center">
        <motion.svg
          width="104"
          height="104"
          viewBox="0 0 32 32"
          aria-hidden="true"
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={after(0)}
        >
          <motion.circle
            cx="16"
            cy="16"
            r="10"
            fill="none"
            stroke="#ffb84d"
            strokeWidth="1.6"
            initial={{ pathLength: 0, rotate: -90 }}
            animate={{ pathLength: 1 }}
            transition={after(0.05)}
          />
          <motion.circle
            cx="22"
            cy="11.5"
            r="2.4"
            fill="#ffe2ad"
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={after(0.35)}
          />
        </motion.svg>
        <motion.h1
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={after(0.15)}
          className="text-3xl font-semibold whitespace-nowrap sm:text-4xl"
        >
          SPHEREx TimeLens
        </motion.h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={after(0.4)} className="text-ink-2">
          Explore the invisible. Discover what moves.
        </motion.p>
      </div>
      <p className="absolute inset-x-0 bottom-6 text-center text-xs text-ink-3">Click or press Enter to skip</p>
    </motion.div>
  )
}

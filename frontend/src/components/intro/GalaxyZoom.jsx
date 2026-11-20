import { motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

const ZOOM_MS = 2300 // the dive; the page underneath changes just before the flash fades
const ARMS = 4
const DISC = 3200 // points of light in the disc
const FIELD = 260 // background stars

const media = (q) => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(q)
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

/** A spiral galaxy as points: a warm core, bluish arms and a few pink knots. Coordinates in disc units (-1…1). */
function makeGalaxy() {
  const pts = []
  for (let i = 0; i < DISC; i++) {
    const core = Math.random() < 0.22
    const r = core ? Math.random() ** 2 * 0.22 : 0.08 + Math.random() ** 0.7 * 0.92
    const arm = (i % ARMS) * ((Math.PI * 2) / ARMS)
    const a = arm + r * 5.2 + (Math.random() - 0.5) * (core ? Math.PI * 2 : 0.55 / (0.4 + r))
    const knot = !core && Math.random() < 0.04
    const col = core ? '255,220,170' : knot ? '255,140,200' : Math.random() < 0.7 ? '175,200,255' : '235,240,255'
    pts.push({ r, a, col, size: core ? 0.9 : knot ? 1.4 : 0.5 + Math.random() * 0.7, b: core ? 0.5 : 0.18 + Math.random() * 0.4 })
  }
  const field = Array.from({ length: FIELD }, () => ({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random() }))
  return { pts, field }
}

/**
 * The zoom into a galaxy between "Start" and /start (an illustration drawn in code, not SPHEREx data; it says
 * so). The camera starts far and tilted, dives in faster and faster while nearby stars rush past, the core
 * flares, and the next page fades in behind. A click or Esc goes straight on; "reduce motion" skips it.
 * @param {{ to: string, onDone: () => void }} props
 */
export default function GalaxyZoom({ to, onDone }) {
  const navigate = useNavigate()
  const canvas = useRef(null)
  const [flash, setFlash] = useState(false)
  const gone = useRef(false)

  const finish = useCallback(() => {
    if (gone.current) return
    gone.current = true
    navigate(to)
    onDone()
  }, [navigate, onDone, to])

  useEffect(() => {
    if (media('(prefers-reduced-motion: reduce)')?.matches) {
      finish()
      return undefined
    }
    const c = canvas.current
    const x = c?.getContext?.('2d')
    const { pts, field } = makeGalaxy()
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    let raf = 0
    const t0 = performance.now()
    const draw = (now) => {
      const t = Math.min(1, (now - t0) / ZOOM_MS)
      const k = ease(t)
      const W = c.clientWidth
      const H = c.clientHeight
      if (c.width !== Math.round(W * dpr)) c.width = Math.round(W * dpr)
      if (c.height !== Math.round(H * dpr)) c.height = Math.round(H * dpr)
      x.setTransform(dpr, 0, 0, dpr, 0, 0)
      x.clearRect(0, 0, W, H)
      const cx = W / 2
      const cy = H / 2
      const base = Math.min(W, H) * 0.42
      const scale = base * (0.35 * Math.exp(k * Math.log(26))) // 0.35× → about 9× the screen
      const tilt = 0.45 + 0.5 * k // seen edge-on at first, face-on as we fall in
      const spin = (now - t0) / 1000 * 0.25 + k * 0.6
      x.globalCompositeOperation = 'lighter'

      // background stars rush outwards as we speed up
      for (const s of field) {
        const z = (s.z - k * 0.9 + 1) % 1 || 1
        const px = cx + (s.x * W) / (z * 2 + 0.15)
        const py = cy + (s.y * H) / (z * 2 + 0.15)
        const len = 1 + k * 18 * (1 - z)
        x.strokeStyle = `rgba(220,230,255,${0.25 + 0.6 * (1 - z)})`
        x.lineWidth = 0.6 + (1 - z) * 1.4
        x.beginPath()
        x.moveTo(px, py)
        x.lineTo(px + ((px - cx) / W) * len, py + ((py - cy) / H) * len)
        x.stroke()
      }
      // the disc
      for (const p of pts) {
        const a = p.a + spin * (1.2 - p.r)
        const px = cx + Math.cos(a) * p.r * scale
        const py = cy + Math.sin(a) * p.r * scale * tilt
        if (px < -20 || py < -20 || px > W + 20 || py > H + 20) continue
        const size = p.size * (1 + k * 1.2)
        x.fillStyle = `rgba(${p.col},${p.b})`
        x.beginPath()
        x.arc(px, py, size, 0, Math.PI * 2)
        x.fill()
      }
      // the core's glow grows into a flash at the end
      const glow = x.createRadialGradient(cx, cy, 0, cx, cy, Math.min(scale * 0.22, Math.max(W, H)))
      glow.addColorStop(0, `rgba(255,236,200,${0.35 + 0.3 * k})`)
      glow.addColorStop(0.4, `rgba(255,210,160,${0.08 + 0.1 * k})`)
      glow.addColorStop(1, 'rgba(255,200,140,0)')
      x.fillStyle = glow
      x.fillRect(0, 0, W, H)
      x.globalCompositeOperation = 'source-over'

      if (t < 1) raf = requestAnimationFrame(draw)
    }
    if (x) raf = requestAnimationFrame(draw)
    const flashAt = setTimeout(() => setFlash(true), ZOOM_MS - 350)
    const end = setTimeout(finish, ZOOM_MS)
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        finish()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(flashAt)
      clearTimeout(end)
      window.removeEventListener('keydown', onKey)
    }
  }, [finish])

  return (
    <motion.div
      role="dialog"
      aria-label="Entering TimeLens"
      data-testid="galaxy-zoom"
      onClick={finish}
      className="fixed inset-0 z-[60] cursor-pointer overflow-hidden"
      style={{ background: 'radial-gradient(120% 90% at 50% 50%, #0b1020 0%, #05070c 70%)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.35 } }}
      exit={{ opacity: 0, transition: { duration: 0.7, ease: 'easeOut' } }}
    >
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-hidden="true" />
      <motion.div
        className="pointer-events-none absolute inset-0 bg-[#fff4e0]"
        initial={{ opacity: 0 }}
        animate={{ opacity: flash ? 0.85 : 0 }}
        transition={{ duration: 0.35 }}
        aria-hidden="true"
      />
      <motion.p
        className="absolute inset-x-0 bottom-16 text-center text-sm tracking-[0.3em] text-ink-2 uppercase"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0, transition: { delay: 0.3, duration: 0.6 } }}
      >
        Entering TimeLens
      </motion.p>
      <p className="absolute right-4 bottom-4 text-[11px] text-ink-3">Illustration · click or press Esc to skip</p>
    </motion.div>
  )
}

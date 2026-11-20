import { useEffect, useRef } from 'react'

const COUNT = 420
const LAYERS = [
  { share: 0.55, size: 0.7, speed: 0.25, alpha: 0.55 }, // far
  { share: 0.33, size: 1.1, speed: 0.6, alpha: 0.8 }, // middle
  { share: 0.12, size: 1.7, speed: 1.2, alpha: 1 }, // near
]
// a few star tints (blue-white to warm), so it does not look like a single grey dust
const TINTS = ['255,255,255', '200,220,255', '255,240,220', '170,200,255', '255,214,170']

const media = (q) => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(q)

/**
 * A decorative starfield for Nova's intro (NOT SPHEREx data; the intro says so): stars on three depth layers
 * drift slowly out from the centre as if the ship were flying forward, and twinkle. While `warp` is true they
 * speed up and stretch into streaks (the jump between two targets). Stands still with "reduce motion", and
 * pauses while the tab is hidden.
 * @param {{ warp?: boolean, className?: string }} props
 */
export default function Starfield({ warp = false, className = '' }) {
  const canvas = useRef(null)
  const warpRef = useRef(warp)
  useEffect(() => {
    warpRef.current = warp
  }, [warp])

  useEffect(() => {
    const c = canvas.current
    const x = c?.getContext?.('2d')
    if (!x) return undefined
    const reduce = media('(prefers-reduced-motion: reduce)')?.matches
    let W = 0
    let H = 0
    let dpr = 1
    const stars = []
    const spawn = (s, anywhere) => {
      // position as a direction from the centre and a distance (0 centre … 1 edge)
      s.a = Math.random() * Math.PI * 2
      s.d = anywhere ? Math.sqrt(Math.random()) : 0.02 + Math.random() * 0.1
      s.tw = Math.random() * Math.PI * 2 // twinkle phase
      s.ts = 0.6 + Math.random() * 1.8 // twinkle speed
      s.tint = TINTS[(Math.random() * TINTS.length) | 0]
      return s
    }
    LAYERS.forEach((L, k) => {
      for (let i = 0; i < Math.round(COUNT * L.share); i++) stars.push(spawn({ layer: k }, true))
    })

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      W = c.clientWidth
      H = c.clientHeight
      c.width = Math.round(W * dpr)
      c.height = Math.round(H * dpr)
    }
    resize()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    ro?.observe(c)

    let raf = 0
    let last = performance.now()
    let speed = 1 // eases between cruising (1) and warp
    const draw = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const target = warpRef.current ? 14 : 1
      speed += (target - speed) * Math.min(1, dt * 3)
      x.setTransform(dpr, 0, 0, dpr, 0, 0)
      x.clearRect(0, 0, W, H)
      const cx = W / 2
      const cy = H / 2
      const R = Math.hypot(cx, cy)
      for (const s of stars) {
        const L = LAYERS[s.layer]
        const before = s.d
        if (!reduce) {
          s.d += L.speed * 0.012 * speed * dt * (0.3 + s.d) // faster further out: depth
          s.tw += s.ts * dt
        }
        if (s.d > 1.05) {
          spawn(s, false)
          continue
        }
        const px = cx + Math.cos(s.a) * s.d * R
        const py = cy + Math.sin(s.a) * s.d * R
        const twinkle = reduce ? 1 : 0.65 + 0.35 * Math.sin(s.tw)
        const a = L.alpha * twinkle * Math.min(1, s.d * 6) // fade in near the centre
        const size = L.size * (0.6 + s.d)
        if (speed > 2 && !reduce) {
          // streak from where it was a moment ago
          const back = Math.max(0, before - (s.d - before) * 6)
          x.strokeStyle = `rgba(${s.tint},${a})`
          x.lineWidth = size
          x.beginPath()
          x.moveTo(cx + Math.cos(s.a) * back * R, cy + Math.sin(s.a) * back * R)
          x.lineTo(px, py)
          x.stroke()
        } else {
          x.fillStyle = `rgba(${s.tint},${a})`
          x.beginPath()
          x.arc(px, py, size, 0, Math.PI * 2)
          x.fill()
        }
      }
      if (!reduce && !document.hidden) raf = requestAnimationFrame(draw)
    }
    const onVisible = () => {
      if (!document.hidden && !reduce) {
        cancelAnimationFrame(raf)
        last = performance.now()
        raf = requestAnimationFrame(draw)
      }
    }
    raf = requestAnimationFrame(draw)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelAnimationFrame(raf)
      ro?.disconnect()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return (
    <div className={`absolute inset-0 ${className}`} aria-hidden="true">
      {/* soft glow behind the stars: a colour wash, not a picture of anything */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 50% at 70% 35%, rgba(110,90,200,.18), transparent 70%), radial-gradient(50% 45% at 25% 70%, rgba(40,120,170,.16), transparent 70%), radial-gradient(120% 90% at 50% 50%, #0b1020 0%, #05070c 70%)',
        }}
      />
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" data-testid="starfield" />
    </div>
  )
}

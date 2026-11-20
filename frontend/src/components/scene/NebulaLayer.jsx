import { useEffect, useRef, useState } from 'react'
import { useBackdrop } from '../../store/backdropStore'

const media = (q) => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(q)

/**
 * The 3D nebula, fixed behind the splash, Home and /start (one scene for all three, so it never restarts
 * between them). A matching painted gradient shows first; the Three.js scene loads after the page and fades
 * in over it. Without WebGL the gradient stays. "Reduce motion": one still frame. Pauses when the tab is hidden.
 * An illustration, not data: the pages that show it say so.
 */
export default function NebulaLayer() {
  const canvas = useRef(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    let dead = false
    let nebula = null
    const still = !!media('(prefers-reduced-motion: reduce)')?.matches
    const fine = media('(hover: hover) and (pointer: fine)')
    const onPointer = (e) => {
      if (fine?.matches) nebula?.setPointer((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1)
    }
    const onLeave = () => nebula?.setPointer(0, 0)
    const onVisible = () => (document.visibilityState === 'visible' ? nebula?.start() : nebula?.stop())
    const onResize = () => nebula?.resize()
    const unsubscribe = useBackdrop.subscribe((s) => nebula?.setFlying(s.flying))

    import('../../lib/nebula.js')
      .then(({ createNebula }) => {
        if (dead || !canvas.current) return
        try {
          nebula = createNebula(canvas.current, { still })
        } catch {
          return // no WebGL: the painted gradient stays, and Start uses the 2D zoom instead
        }
        nebula.setFlying(useBackdrop.getState().flying)
        if (document.visibilityState === 'visible') nebula.start()
        useBackdrop.getState().setReady(!still)
        setShown(true)
        window.addEventListener('pointermove', onPointer, { passive: true })
        document.documentElement.addEventListener('pointerleave', onLeave)
        document.addEventListener('visibilitychange', onVisible)
        window.addEventListener('resize', onResize)
      })
      .catch(() => {})

    return () => {
      dead = true
      unsubscribe()
      window.removeEventListener('pointermove', onPointer)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('resize', onResize)
      nebula?.dispose()
      useBackdrop.getState().setReady(false)
    }
  }, [])

  return (
    <div className="pointer-events-none fixed inset-0 -z-20 bg-bg" aria-hidden="true" data-testid="nebula">
      {/* first paint, and the fallback without WebGL: the same colours, painted */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(40% 45% at 70% 40%, rgba(124,92,255,.28), transparent 70%), radial-gradient(35% 40% at 85% 70%, rgba(34,211,238,.18), transparent 70%), radial-gradient(30% 35% at 55% 75%, rgba(245,158,11,.12), transparent 70%), radial-gradient(120% 100% at 60% 50%, #0b1020 0%, #05070c 75%)',
        }}
      />
      <canvas
        ref={canvas}
        className={`absolute inset-0 h-full w-full transition-opacity duration-[1500ms] ease-out ${shown ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  )
}

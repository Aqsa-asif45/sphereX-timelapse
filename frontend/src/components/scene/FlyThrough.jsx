import { motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useBackdrop } from '../../store/backdropStore'

const FLY_MS = 1500 // the dive through the clouds; the next page opens at the brightest moment

/**
 * "Start your experience" with the 3D nebula running: the camera speeds forward through the clouds while the
 * stars rush past, the next page opens at the brightest moment, and the scene settles back to a slow drift
 * behind it (the same scene, so it is one continuous flight). Click, Esc, Enter or Space goes straight on.
 * @param {{ to: string, onDone: () => void }} props
 */
export default function FlyThrough({ to, onDone }) {
  const navigate = useNavigate()
  const [flash, setFlash] = useState(false)
  const gone = useRef(false)

  const finish = useCallback(() => {
    if (gone.current) return
    gone.current = true
    navigate(to)
    useBackdrop.getState().setFlying(false) // ease back to a drift behind the new page
    onDone()
  }, [navigate, onDone, to])

  useEffect(() => {
    useBackdrop.getState().setFlying(true)
    const flashAt = setTimeout(() => setFlash(true), FLY_MS - 300)
    const end = setTimeout(finish, FLY_MS)
    const onKey = (e) => {
      if (['Escape', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        finish()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(flashAt)
      clearTimeout(end)
      window.removeEventListener('keydown', onKey)
      useBackdrop.getState().setFlying(false)
    }
  }, [finish])

  return (
    <motion.div
      role="dialog"
      aria-label="Entering TimeLens"
      data-testid="fly-through"
      onClick={finish}
      className="fixed inset-0 z-[60] cursor-pointer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.2 } }}
      exit={{ opacity: 0, transition: { duration: 0.6, ease: 'easeOut' } }}
    >
      {/* the page fades away so only the flight is left, then a soft flash as we arrive */}
      <div className="absolute inset-0 bg-bg/55" />
      <motion.div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(60% 60% at 60% 50%, rgba(255,244,224,.9), rgba(160,140,255,.35) 60%, transparent 85%)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: flash ? 1 : 0 }}
        transition={{ duration: 0.3 }}
        aria-hidden="true"
      />
      <motion.p
        className="absolute inset-x-0 bottom-16 text-center text-sm tracking-[0.3em] text-ink-2 uppercase"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0, transition: { delay: 0.15, duration: 0.5 } }}
      >
        Entering TimeLens
      </motion.p>
      <p className="absolute right-4 bottom-4 text-[11px] text-ink-3">Illustration · click or press Esc to skip</p>
    </motion.div>
  )
}

import { motion } from 'motion/react'
import { useEffect } from 'react'

const DURATION_MS = 2200

/**
 * The first-visit intro: the logo ring draws itself, the name rises, then it fades into Home.
 * Click, Enter, Escape or Space skips it. Home is already loaded underneath, so it never blocks.
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

  return (
    <motion.div
      role="dialog"
      aria-label="SPHEREx TimeLens"
      data-testid="splash"
      onClick={onDone}
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.5 } }}
      className="fixed inset-0 z-50 grid cursor-pointer place-items-center bg-bg"
    >
      <div className="flex flex-col items-center gap-5 text-center">
        <svg width="96" height="96" viewBox="0 0 32 32" aria-hidden="true">
          <motion.circle
            cx="16"
            cy="16"
            r="10"
            fill="none"
            stroke="#ffb84d"
            strokeWidth="1.6"
            initial={{ pathLength: 0, rotate: -90 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
          />
          <motion.circle
            cx="22"
            cy="11.5"
            r="2.4"
            fill="#ffe2ad"
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.8, duration: 0.4 }}
          />
        </svg>
        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.6 }}
          className="text-3xl font-semibold tracking-tight"
        >
          SPHEREx TimeLens
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9, duration: 0.6 }}
          className="text-ink-2"
        >
          Explore the invisible. Discover what moves.
        </motion.p>
        <p className="text-xs text-ink-3">Click or press Enter to skip</p>
      </div>
    </motion.div>
  )
}

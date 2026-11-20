import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import TargetPreview from '../home/TargetPreview'
import Nova from './Nova'
import Starfield from './Starfield'
import { useGalaxy } from '../../store/galaxyStore'
import { BTN } from '../../lib/ui'

const SCENE_MS = 8000 // time per scene when it plays by itself
const WARP_MS = 1100 // the jump between two scenes
const EASE = [0.22, 1, 0.36, 1]

/** Each scene unfolds in turn: Nova glides in, then the words, then the scanner powers on. */
const sceneV = {
  hidden: {},
  show: { transition: { delayChildren: 0.35, staggerChildren: 0.22 } },
  exit: { opacity: 0, y: -12, transition: { duration: 0.5, ease: 'easeIn' } },
}
const novaV = {
  hidden: { opacity: 0, x: -90, rotate: -10 },
  show: { opacity: 1, x: 0, rotate: 0, transition: { duration: 1.2, ease: EASE } },
}
const panelV = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.9, ease: EASE, staggerChildren: 0.12 } },
}
const itemV = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
}
const scannerV = {
  hidden: { opacity: 0, scale: 0.85 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.9, ease: EASE, delay: 0.6 } },
}
const wordsV = { hidden: {}, show: { transition: { staggerChildren: 0.045 } } }
const wordV = { hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0, transition: { duration: 0.4 } } }

/** Nova's line, appearing word by word (screen readers get it whole). */
function Line({ text }) {
  return (
    <p className="text-base text-ink sm:text-lg">
      <span className="sr-only">“{text}”</span>
      <motion.span aria-hidden="true" variants={wordsV}>
        {`“${text}”`.split(' ').map((w, i) => (
          <motion.span key={i} variants={wordV} className="inline-block whitespace-pre">
            {w}{' '}
          </motion.span>
        ))}
      </motion.span>
    </p>
  )
}

/** The story (approved 2026-11-20). Targets carry their slug for the real SPHEREx preview. */
const SCENES = [
  {
    id: 'launch',
    title: 'Nova’s infrared voyage',
    pose: 'wave',
    line: 'My star map just updated. NASA’s SPHEREx telescope has mapped the whole sky in 102 infrared colours, again and again. Five signals look… different.',
  },
  {
    id: 'barnard',
    slug: 'barnard',
    q: "Barnard's Star",
    title: 'Barnard’s Star',
    kind: 'Red dwarf star',
    lookFor: 'Motion',
    pose: 'point',
    line: 'A red dwarf racing across the sky, the fastest star we know. It crosses about 10″ of sky every year: enough for SPHEREx to see it move.',
  },
  {
    id: 'eps-indi-b',
    slug: 'eps-indi-b',
    q: 'Epsilon Indi B',
    title: 'Epsilon Indi B',
    kind: 'Brown dwarf pair',
    lookFor: 'Motion',
    pose: 'point',
    line: 'Two brown dwarfs: too cold to shine as stars, circling a nearby sun.',
  },
  {
    id: 'wise-0855',
    slug: 'wise-0855',
    q: 'WISE 0855-0714',
    title: 'WISE 0855−0714',
    kind: 'Coldest known brown dwarf',
    lookFor: 'Motion',
    pose: 'point',
    line: 'The coldest brown dwarf we know, roughly as cold as a winter day on Earth. Only infrared eyes can see it.',
  },
  {
    id: 'rw-aur',
    slug: 'rw-aur',
    q: 'RW Aurigae',
    title: 'RW Aurigae',
    kind: 'Young variable star',
    lookFor: 'Brightness',
    pose: 'point',
    line: 'A young star that suddenly dims, as clouds of dust pass in front of it.',
  },
  {
    id: 'r-dra',
    slug: 'r-dra',
    q: 'R Draconis',
    title: 'R Draconis',
    kind: 'Pulsating red giant',
    lookFor: 'Brightness',
    pose: 'point',
    line: 'A giant red star that swells and fades about every 8 months.',
  },
  {
    id: 'your-turn',
    title: 'Your turn',
    pose: 'cheer',
    line: 'I can’t check them all alone. Blink the visits, read the light, hunt for movers. What you find is evidence to check, not a discovery yet.',
  },
]
const TARGETS = SCENES.filter((s) => s.slug)

/** The five stops as a route, with the ship at the current one. */
function RouteMap({ index }) {
  const stop = Math.min(TARGETS.length - 1, Math.max(0, index - 1))
  const at = index === 0 ? -0.6 : index > TARGETS.length ? TARGETS.length - 0.4 : stop // before the first / after the last
  const pct = (i) => `${(100 * (i + 0.5)) / TARGETS.length}%`
  return (
    <div className="relative mx-auto h-12 w-full max-w-3xl" aria-hidden="true">
      <div className="absolute inset-x-[10%] top-4 border-t border-dashed border-line-2" />
      {TARGETS.map((t, i) => {
        const done = index - 1 >= i
        return (
          <div key={t.id} className="absolute top-0 flex -translate-x-1/2 flex-col items-center gap-1" style={{ left: pct(i) }}>
            <span className={`mt-2.5 h-3 w-3 rounded-full border-2 ${done ? 'border-time bg-time' : 'border-ink-3 bg-bg'}`} />
            <span className={`hidden text-[11px] whitespace-nowrap sm:block ${index - 1 === i ? 'text-ink' : 'text-ink-3'}`}>{t.title}</span>
          </div>
        )
      })}
      <motion.span
        className="absolute top-0.5 -translate-x-1/2 text-lg"
        animate={{ left: `${(100 * (at + 0.5)) / TARGETS.length}%` }}
        transition={{ duration: WARP_MS / 1000, ease: [0.65, 0, 0.35, 1] }}
      >
        <svg width="26" height="22" viewBox="0 0 26 22">
          <path d="M2 11 L18 3 Q24 11 18 19 Z" fill="#e3e9f1" />
          <circle cx="15" cy="11" r="3" fill="#ffb84d" />
          <path d="M2 8 L-4 11 L2 14 Z" fill="#ffb84d" opacity="0.8" />
        </svg>
      </motion.span>
    </div>
  )
}

/**
 * Nova's intro (cutscenes after the splash): a space trooper charts the five challenge targets, each shown
 * with its real SPHEREx preview. Plays by itself (with Pause), steps with Back/Next or the arrow keys, and
 * Skip or Esc leaves at any time. With "reduce motion" it never plays by itself and nothing animates.
 * Nova is an illustration; only the scanner images are SPHEREx data, and they say so.
 * @param {{ onDone: () => void }} props
 */
export default function IntroCutscene({ onDone }) {
  const reduce = useReducedMotion()
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(!reduce)
  const panel = useRef(null)
  const scene = SCENES[index]
  const last = index === SCENES.length - 1

  // every move to another scene is a short warp jump
  const [warp, setWarp] = useState(false)
  const warpTimer = useRef(0)
  const go = useCallback((d) => {
    setIndex((i) => Math.min(SCENES.length - 1, Math.max(0, i + d)))
    setWarp(true)
    clearTimeout(warpTimer.current)
    warpTimer.current = setTimeout(() => setWarp(false), WARP_MS)
  }, [])
  useEffect(() => () => clearTimeout(warpTimer.current), [])

  useEffect(() => {
    if (!playing || last) return undefined
    const t = setTimeout(() => go(1), SCENE_MS)
    return () => clearTimeout(t)
  }, [playing, index, last, go])

  // keyboard: Esc skips, arrows step; Tab stays inside the intro
  useEffect(() => {
    panel.current?.querySelector('[data-autofocus]')?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onDone()
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault()
        setPlaying(false)
        go(e.key === 'ArrowRight' ? 1 : -1)
      } else if (e.key === 'Tab' && panel.current) {
        const els = [...panel.current.querySelectorAll('a[href], button')].filter((el) => !el.disabled)
        const first = els[0]
        const end = els[els.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          end.focus()
        } else if (!e.shiftKey && document.activeElement === end) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onDone, go])

  // the galaxy zoom plays over the intro as it closes, then opens the page
  const leaveTo = (to) => {
    useGalaxy.getState().go(to)
    onDone()
  }
  const btn = 'rounded-full border border-ctl bg-bg-2/70 px-4 py-2 text-sm text-ink backdrop-blur hover:bg-hover disabled:opacity-40'

  return (
    <motion.div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="intro-title"
      data-testid="intro"
      className="fixed inset-0 z-50 isolate flex flex-col overflow-hidden bg-bg"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 1.2, ease: 'easeOut' } }}
      exit={{ opacity: 0, transition: { duration: 0.8, ease: 'easeIn' } }}
    >
      <Starfield warp={warp} className="-z-20" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-bg/40 via-transparent to-bg/80" aria-hidden="true" />

      {/* top: route and Skip */}
      <div className="flex items-start gap-3 px-4 pt-4">
        <div className="min-w-0 flex-1">
          <RouteMap index={index} />
        </div>
        <button type="button" onClick={onDone} className={btn} data-autofocus>
          Skip intro
        </button>
      </div>

      {/* the scene */}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-x-hidden overflow-y-auto px-4 py-2">
        <AnimatePresence mode="wait">
          <motion.section
            key={scene.id}
            aria-live="polite"
            className="grid w-full max-w-5xl items-center gap-6 md:grid-cols-[auto_minmax(0,1fr)_auto]"
            variants={sceneV}
            initial="hidden"
            animate="show"
            exit="exit"
          >
            <motion.div variants={novaV} className="mx-auto">
              <Nova pose={scene.pose} size={150} className="h-auto w-[110px] sm:w-[150px]" />
            </motion.div>

            <motion.div variants={panelV} className="flex flex-col gap-3 rounded-panel border border-line-2 bg-bg-2/75 p-5 backdrop-blur-md">
              <motion.p variants={itemV} className="text-xs tracking-wide text-ink-3 uppercase">
                {scene.slug ? `Stop ${index} of ${TARGETS.length} · ${scene.kind}` : 'Nova, TimeLens space trooper'}
              </motion.p>
              <motion.h2 variants={itemV} id="intro-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">
                {scene.title}
              </motion.h2>
              <Line text={scene.line} />
              {scene.lookFor && (
                <motion.p variants={itemV} className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="rounded-full border border-time/60 px-2.5 py-0.5 text-time">Look for: {scene.lookFor}</span>
                  <Link to={`/explore?q=${encodeURIComponent(scene.q)}`} onClick={onDone} className={BTN.small}>
                    Open {scene.title} now <span aria-hidden="true">→</span>
                  </Link>
                </motion.p>
              )}
              {last && (
                <motion.div variants={itemV} className="flex flex-wrap gap-3 pt-1">
                  <button type="button" onClick={() => leaveTo('/start')} className="rounded-full bg-time px-6 py-2.5 font-semibold text-bg hover:brightness-110">
                    Start exploring →
                  </button>
                  <button type="button" onClick={onDone} className={btn}>
                    Back to home
                  </button>
                </motion.div>
              )}
            </motion.div>

            {scene.slug && (
              <motion.figure variants={scannerV} className="mx-auto flex flex-col items-center gap-1.5">
                <div className="relative rounded-panel border border-focus/50 p-1.5 shadow-[0_0_40px_-10px] shadow-focus/50">
                  <TargetPreview slug={scene.slug} size={180} alt={`${scene.title}: real SPHEREx images, one frame per visit`} />
                  {!reduce && (
                    <motion.span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-1.5 top-1.5 h-6 bg-gradient-to-b from-focus/40 to-transparent"
                      animate={{ y: [0, 170, 0] }}
                      transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  )}
                </div>
                <figcaption className="text-xs text-ink-2">Nova’s scanner · real SPHEREx data</figcaption>
              </motion.figure>
            )}
          </motion.section>
        </AnimatePresence>
      </div>

      {/* bottom: progress and controls */}
      <div className="flex flex-col items-center gap-3 px-4 pb-5">
        <div className="flex gap-1.5" aria-hidden="true">
          {SCENES.map((s, i) => (
            <span key={s.id} className={`h-1.5 rounded-full transition-all ${i === index ? 'w-6 bg-time' : 'w-1.5 bg-ink-3'}`} />
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            className={btn}
            disabled={index === 0}
            onClick={() => {
              setPlaying(false)
              go(-1)
            }}
          >
            ← Back
          </button>
          {!last && (
            <button type="button" className={btn} onClick={() => setPlaying((v) => !v)} aria-pressed={!playing}>
              {playing ? 'Pause' : 'Play'}
            </button>
          )}
          {!last && (
            <button
              type="button"
              className={btn}
              onClick={() => {
                setPlaying(false)
                go(1)
              }}
            >
              Next →
            </button>
          )}
        </div>
        <p className="text-center text-[11px] text-ink-3">
          Nova and the background stars are illustrations. Only the scanner images are real SPHEREx data (NASA/IPAC).
        </p>
      </div>
    </motion.div>
  )
}

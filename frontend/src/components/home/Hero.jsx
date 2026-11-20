import { motion } from 'motion/react'
import { Link } from 'react-router'
import { zoomOnClick } from '../../store/galaxyStore'
import { useIntro } from '../../store/introStore'
import { BTN } from '../../lib/ui'
import { rise, stagger } from './motion'
import { useBackdrop } from '../../store/backdropStore'
import BackdropSwitch from './BackdropSwitch'
import SkyBackdrop from './SkyBackdrop'

/** Full-screen hero over the real SPHEREx sky: name, a short intro and the Start button (SH-2); search is on /start. */
export default function Hero() {
  const real = useBackdrop((s) => s.mode) === 'real'
  return (
    <section className="relative isolate flex min-h-dvh items-center overflow-hidden">
      {real ? (
        <SkyBackdrop className="-z-10" />
      ) : (
        // the nebula is drawn behind the whole page (App.jsx); here only the veils that keep the text readable
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-bg/40 sm:bg-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-bg/85 via-bg/50 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-bg" />
        </div>
      )}

      <motion.div
        initial="hidden"
        animate="show"
        variants={stagger}
        className="mx-auto flex w-full max-w-7xl flex-col items-start gap-6 px-4 pt-36 pb-24"
      >
        <motion.p variants={rise} className="text-sm text-ink-2">
          NASA Space Apps 2026 · Planet X &amp; SPHEREx
        </motion.p>
        <motion.h1
          variants={rise}
          className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl"
        >
          Find what moves in the infrared sky.
        </motion.h1>
        <motion.p variants={rise} className="max-w-xl text-lg text-ink">
          NASA’s SPHEREx telescope maps the whole sky about every six months in 102 colours of
          infrared light. TimeLens lines up every visit to the spot you choose and plays them in
          order.
        </motion.p>
        <motion.div variants={rise} className="flex flex-wrap items-center gap-3">
          <Link
            to="/start"
            onClick={zoomOnClick('/start')}
            className="inline-flex items-center gap-2 rounded-full bg-time px-7 py-3.5 text-base font-semibold text-bg shadow-[0_0_40px_-8px] shadow-time/60 transition hover:brightness-110"
          >
            Start your experience
            <span aria-hidden="true">→</span>
          </Link>
          <button type="button" onClick={() => useIntro.getState().show()} className={`${BTN.secondary} px-6 py-3.5 text-base`}>
            <span aria-hidden="true">▶</span>
            Watch Nova’s intro
          </button>
        </motion.div>
      </motion.div>

      <BackdropSwitch className="absolute right-4 bottom-8" />
    </section>
  )
}

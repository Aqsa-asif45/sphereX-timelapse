import { motion } from 'motion/react'
import { Link } from 'react-router'
import { zoomOnClick } from '../../store/galaxyStore'
import { useIntro } from '../../store/introStore'
import { BTN } from '../../lib/ui'
import { rise, stagger } from './motion'
import SkyBackdrop, { BACKDROP_LABEL, BACKDROP_SHORT } from './SkyBackdrop'

/** Full-screen hero over the real SPHEREx sky: name, a short intro and the Start button (SH-2); search is on /start. */
export default function Hero() {
  return (
    <section className="relative isolate flex min-h-dvh items-center overflow-hidden">
      <SkyBackdrop className="-z-10" />

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

      {/* science rule: the all-sky map is for looking, never for measuring */}
      <p
        className="absolute right-4 bottom-8 max-w-[calc(100%-2rem)] text-right text-xs text-ink-3"
        title={`${BACKDROP_LABEL}, NASA/IPAC. Never used for measurements. Dark gaps are where NASA masked very bright stars: no data, nothing filled in.`}
      >
        Backdrop: {BACKDROP_SHORT}
      </p>
    </section>
  )
}

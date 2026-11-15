import { motion } from 'motion/react'
import { Link } from 'react-router'
import SearchBox from '../search/SearchBox'
import { rise, stagger } from './motion'
import SkyBackdrop, { BACKDROP_LABEL } from './SkyBackdrop'

/** Full-screen hero over the real SPHEREx sky: name, a short intro, the Start button and a search (SH-2, SR-5). */
export default function Hero() {
  return (
    <section className="relative isolate flex min-h-dvh items-center overflow-hidden">
      <SkyBackdrop className="-z-10" />

      <motion.div
        initial="hidden"
        animate="show"
        variants={stagger}
        className="mx-auto flex w-full max-w-7xl flex-col items-start gap-6 px-4 pt-28 pb-20"
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
          NASA&apos;s SPHEREx telescope maps the whole sky every six months in 102 colours of
          infrared light. TimeLens lines up every visit to the spot you choose and plays them in
          order.
        </motion.p>
        <motion.div variants={rise}>
          <Link
            to="/start"
            className="inline-flex items-center gap-2 rounded-full bg-time px-7 py-3.5 text-base font-semibold text-bg shadow-[0_0_40px_-8px] shadow-time/60 transition hover:brightness-110"
          >
            Start your experience
            <span aria-hidden="true">→</span>
          </Link>
        </motion.div>

        <motion.p variants={rise} className="text-sm">
          
        </motion.p>
      </motion.div>

    </section>
  )
}

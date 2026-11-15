import { motion } from 'motion/react'
import { Link } from 'react-router'
import SearchBox from '../search/SearchBox'
import { EASE, rise, stagger } from './motion'
import TargetPreview from './TargetPreview'

/** Headline, big search, and a real animated SPHEREx preview of Barnard's Star. */
export default function Hero() {
  return (
    <motion.section
      initial="hidden"
      animate="show"
      variants={stagger}
      className="grid items-center gap-10 py-12 md:grid-cols-[minmax(0,1fr)_312px] md:py-20"
    >
      <motion.div variants={stagger} className="flex flex-col gap-5">
        <motion.p variants={rise} className="text-sm text-ink-3">
          NASA Space Apps 2026 · Planet X &amp; SPHEREx
        </motion.p>
        <motion.h1 variants={rise} className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Find what moves in the infrared sky.
        </motion.h1>
        <motion.p variants={rise} className="max-w-xl text-lg text-ink-2">
          NASA&apos;s SPHEREx telescope photographs the whole sky about every six months, in 102 colours of infrared
          light. TimeLens finds every SPHEREx image of the spot you choose, lines them up, and plays them in date
          order.
        </motion.p>
        <motion.div variants={rise}>
          <SearchBox big id="home-search" />
        </motion.div>
        <motion.p variants={rise} className="flex gap-3 text-sm">
          <a href="#sky" className="text-focus underline underline-offset-2">
            See the whole sky
          </a>
          <span aria-hidden="true" className="text-ink-3">
            ·
          </span>
          <Link to="/about" className="text-focus underline underline-offset-2">
            Methods and data
          </Link>
        </motion.p>
      </motion.div>

      <motion.figure
        variants={{
          hidden: { opacity: 0, scale: 0.96 },
          show: { opacity: 1, scale: 1, transition: { duration: 0.7, ease: EASE, delay: 0.15 } },
        }}
        className="mx-auto flex w-full max-w-[312px] flex-col gap-3"
      >
        <div className="rounded-panel border border-line-2 bg-panel/70 p-2 backdrop-blur">
          <Link to={`/explore?q=${encodeURIComponent("Barnard's Star")}`} aria-label="Open Barnard's Star">
            <TargetPreview
              slug="barnard"
              size={296}
              alt="Barnard's Star: one frame per SPHEREx visit, looping. The star shifts between visits."
            />
          </Link>
        </div>
        <figcaption className="text-sm text-ink-2">
          <b className="font-medium text-ink">Barnard&apos;s Star</b>, a 4′ patch of sky. Each frame is one SPHEREx
          visit, months apart; the amber ring marks where the star should be.{' '}
          <span className="rounded-full border border-ok/40 px-2 py-0.5 text-xs whitespace-nowrap text-ok">
            Real SPHEREx data
          </span>
        </figcaption>
      </motion.figure>
    </motion.section>
  )
}

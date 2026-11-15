import { useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import SkyBackdrop from '../components/home/SkyBackdrop'
import SkyGlobe from '../components/home/SkyGlobe'
import StarPreview from '../components/home/StarPreview'
import TargetCards from '../components/home/TargetCards'
import TargetPreview from '../components/home/TargetPreview'
import SearchBox from '../components/search/SearchBox'
import { useTitle } from '../hooks/useTitle'

const explore = (q, extra = '') => `/explore?q=${encodeURIComponent(q)}${extra}`

const cta =
  'inline-flex items-center gap-2 self-start rounded-full bg-time px-5 py-2.5 font-semibold text-bg hover:brightness-110'

function Feature({ title, children, action, to, preview }) {
  return (
    <div className="grid items-center gap-8 md:grid-cols-[minmax(0,1fr)_auto]">
      <div className="flex flex-col gap-4">
        <h2 className="text-3xl font-semibold tracking-tight">{title}</h2>
        <div className="flex max-w-xl flex-col gap-3 text-lg text-ink-2">{children}</div>
        {action && (
          <Link to={to} className={cta}>
            {action} <span aria-hidden="true">→</span>
          </Link>
        )}
      </div>
      {preview}
    </div>
  )
}

function Preview({ slug, name }) {
  return (
    <div className="mx-auto w-full max-w-[312px] rounded-panel border border-line-2 bg-panel/70 p-2 backdrop-blur">
      <TargetPreview
        slug={slug}
        size={296}
        alt={`${name}: one frame per SPHEREx visit, looping.`}
      />
    </div>
  )
}

/** The seven features, each a deep link into TimeLens (SH-2 to SH-6, SR-5). */
const SLIDES = [
  {
    short: 'Search',
    title: 'Search any spot',
    body: (
      <Feature title="Search any spot">
        <p>
          Type a star&apos;s name or sky coordinates. TimeLens finds every SPHEREx image of that
          spot and lines them up by date. The five challenge targets are suggested as you type.
        </p>
        <div className="mt-2 text-base">
          <SearchBox big id="start-search" />
        </div>
      </Feature>
    ),
  },
  { short: 'Whole sky', title: 'The whole sky', body: <SkyGlobe /> },
  {
    short: 'A star moves',
    title: 'Watch a star move',
    body: (
      <Feature
        title="Watch a star move"
        action="Blink Barnard's Star"
        to={explore("Barnard's Star", '&view=blink')}
        preview={<StarPreview />}
      >
        <p>
          Barnard&apos;s Star crosses the sky faster than any other star. Blink two SPHEREx visits
          months apart and watch it jump.
        </p>
      </Feature>
    ),
  },
  {
    short: 'Spectrum',
    title: 'Read a spectrum',
    body: (
      <Feature
        title="Read a spectrum"
        action="Open R Draconis's spectrum"
        to={explore('R Draconis', '&mode=spectrum')}
        preview={<Preview slug="r-dra" name="R Draconis" />}
      >
        <p>
          SPHEREx sees the sky in 102 colours of infrared light. Put them side by side and a
          star&apos;s spectrum appears: here a pulsating red giant whose brightness changes between
          visits.
        </p>
      </Feature>
    ),
  },
  {
    short: 'Movers',
    title: 'Hunt for movers',
    body: (
      <Feature
        title="Hunt for movers"
        action="Hunt around Epsilon Indi B"
        to={explore('Epsilon Indi B', '&mode=movers')}
        preview={<Preview slug="eps-indi-b" name="Epsilon Indi B" />}
      >
        <p>
          Nearby brown dwarfs are faint but fast. TimeLens compares visits and lists what shifted,
          so you can check each candidate yourself.
        </p>
      </Feature>
    ),
  },
  { short: 'Five targets', title: 'The five targets', body: <TargetCards /> },
  {
    short: 'How it works',
    title: 'How it works',
    body: (
      <Feature title="How it works" action="Read the methods" to="/about">
        <p>
          Every picture here is a real SPHEREx exposure from NASA/IPAC, shown as stored: nothing is
          filled in or simulated.
        </p>
        <p>
          The Methods page explains where the data comes from, how images are lined up, and what the
          limits are.
        </p>
      </Feature>
    ),
  },
]

/**
 * /start: the features menu "Start your experience" leads to. One large slide at a time; arrow keys,
 * swipe (native scroll snapping) or the buttons move between them. Off-screen slides are inert, and the
 * globe loads only when its slide is reached.
 */
export default function StartPage() {
  useTitle('Start')
  const track = useRef(null)
  const [index, setIndex] = useState(0)
  const reduced = useReducedMotion()

  const go = useCallback(
    (i) => {
      const el = track.current
      const n = Math.max(0, Math.min(SLIDES.length - 1, i))
      el?.scrollTo?.({ left: n * el.clientWidth, behavior: reduced ? 'auto' : 'smooth' })
      setIndex(n)
    },
    [reduced],
  )

  // follow swipes and scrolls: the slide whose left edge is nearest is the current one
  useEffect(() => {
    const el = track.current
    if (!el) return undefined
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() =>
        setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))),
      )
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('scroll', onScroll)
    }
  }, [])

  const onKey = (e) => {
    if (e.target.closest('input, textarea, select, [role="application"]')) return // typing or using the globe
    if (e.key === 'ArrowRight') go(index + 1)
    else if (e.key === 'ArrowLeft') go(index - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(SLIDES.length - 1)
    else return
    e.preventDefault()
  }

  const arrow =
    'grid size-10 place-items-center rounded-full border border-ctl bg-bg-2/70 text-ink backdrop-blur hover:bg-hover disabled:opacity-40 disabled:hover:bg-bg-2/70'

  return (
    <main id="main" className="relative isolate flex flex-1 flex-col pt-14">
      <div className="fixed inset-0 -z-10">
        <SkyBackdrop />
        <div className="absolute inset-0 bg-bg/45" />
      </div>

      <section
        aria-roledescription="carousel"
        aria-labelledby="start-h"
        onKeyDown={onKey}
        className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 px-4 pt-8 pb-12"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 id="start-h" className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Start your experience
            </h1>
            <p className="mt-1.5 text-ink-2">
              Seven ways into the SPHEREx sky. Use the arrow keys or swipe.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className={arrow}
              onClick={() => go(index - 1)}
              disabled={index === 0}
              aria-label="Previous"
            >
              <span aria-hidden="true">←</span>
            </button>
            <p className="num min-w-14 text-center text-sm text-ink-2" aria-live="polite">
              {index + 1} of {SLIDES.length}
            </p>
            <button
              type="button"
              className={arrow}
              onClick={() => go(index + 1)}
              disabled={index === SLIDES.length - 1}
              aria-label="Next"
            >
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>

        <div role="tablist" aria-label="Features" className="flex flex-wrap gap-2">
          {SLIDES.map((s, i) => (
            <button
              key={s.title}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-controls={`slide-${i}`}
              onClick={() => go(i)}
              className={`rounded-full border px-3 py-1 text-sm ${
                i === index
                  ? 'border-focus bg-focus/15 text-ink'
                  : 'border-line-2 bg-bg-2/60 text-ink-2 hover:text-ink'
              }`}
            >
              {s.short}
            </button>
          ))}
        </div>

        <div
          ref={track}
          className="flex items-start snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {SLIDES.map((s, i) => (
            <div
              key={s.title}
              id={`slide-${i}`}
              role="tabpanel"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${SLIDES.length}: ${s.title}`}
              inert={i !== index}
              className="w-full shrink-0 snap-start snap-always px-px"
            >
              <div className="flex min-h-[min(62vh,600px)] flex-col justify-center rounded-panel border border-line-2 bg-bg-2/80 p-5 backdrop-blur-md sm:p-8 [&>section]:border-t-0 [&>section]:pt-0">
                {s.body}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}

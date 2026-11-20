import { motion } from 'motion/react'
import { Link } from 'react-router'
import { useTitle } from '../hooks/useTitle'
import { BTN } from '../lib/ui'

/** Rise into view once while scrolling (Motion honours "reduce motion"). */
const reveal = {
  initial: { opacity: 0, y: 16 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
  transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
}

const SECTIONS = [
  ['spherex', 'SPHEREx'],
  ['steps', 'How it works'],
  ['views', 'The four views'],
  ['limits', 'Limits'],
  ['sources', 'Credits'],
]

const FACTS = [
  ['102', 'infrared colours'],
  ['0.75–5 µm', 'wavelength range'],
  ['6.15″', 'per pixel'],
  ['~6 months', 'between visits'],
]

const STEPS = [
  { n: 1, title: 'Find', text: 'Ask NASA’s archive for every SPHEREx exposure of your spot.' },
  { n: 2, title: 'Cut out', text: 'Read only the small piece of each file around it.' },
  { n: 3, title: 'Align', text: 'Turn each piece north-up on one grid of SPHEREx pixels. Blank stays blank.' },
  { n: 4, title: 'Stack', text: 'Group exposures into visits and combine each visit.' },
  { n: 5, title: 'Measure', text: 'Compare visits, measure brightness, check finds against Gaia.' },
]

const VIEWS = [
  { mode: 'Sky', text: 'Every visit added together: the deepest picture.' },
  {
    mode: 'Time',
    text: 'Blink, play or subtract visits months apart.',
    key: [
      ['#ffb84d', 'brighter in A'],
      ['#6ec3ff', 'brighter in B'],
    ],
  },
  { mode: 'Spectrum', text: 'Brightness at each wavelength, and over time.' },
  { mode: 'Movers', text: 'Things that moved or appeared once, checked against Gaia.' },
]

const LIMITS = [
  ['Not total flux', 'The small measuring circle catches only part of a star’s light: compare dates, not magnitudes.'],
  ['Bright stars saturate', 'Barnard’s Star and R Draconis are often too bright to measure.'],
  ['Evidence, not discoveries', '“Not in Gaia” means worth a closer look, never new.'],
  ['Sky maps are for looking', 'The backdrop and globe are never used for measurements.'],
]

const SOURCES = [
  ['SPHEREx', 'NASA/JPL-Caltech/IPAC · IRSA · AWS Open Data'],
  ['Stars', 'Gaia DR3 (ESA) · CatWISE2020 · NOIRLab Data Lab'],
  ['Names and maps', 'MAST, SIMBAD, NED · Aladin Lite (CDS)'],
]

function Section({ id, n, title, children }) {
  return (
    <motion.section id={id} {...reveal} className="scroll-mt-20 border-t border-line pt-10">
      <p className="text-xs font-semibold tracking-[0.2em] text-time uppercase">{String(n).padStart(2, '0')}</p>
      <h2 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
      <div className="mt-5">{children}</div>
    </motion.section>
  )
}

/** Methods (HL-3): how TimeLens works, how to read each view, limits, sources and credits. */
export default function AboutPage() {
  useTitle('Methods and data')
  return (
    <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pt-10 pb-20">
      {/* header */}
      <motion.header {...reveal} className="max-w-3xl">
        <p className="text-sm text-ink-3">Methods and data</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">How TimeLens works</h1>
        <p className="mt-4 text-lg text-ink-2">
          Every SPHEREx image of your spot, lined up so you can compare them. Real NASA data, nothing simulated.
        </p>
      </motion.header>

      <motion.dl {...reveal} className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {FACTS.map(([v, l]) => (
          <div key={l} className="rounded-panel border border-line bg-panel px-4 py-3">
            <dt className="text-xs text-ink-3">{l}</dt>
            <dd className="num mt-0.5 text-xl font-semibold text-ink">{v}</dd>
          </div>
        ))}
      </motion.dl>

      <div className="mt-12 grid gap-10 lg:grid-cols-[200px_minmax(0,1fr)]">
        {/* contents */}
        <nav aria-label="On this page" className="lg:sticky lg:top-20 lg:self-start">
          <p className="mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">On this page</p>
          <ol className="flex flex-wrap gap-2 lg:flex-col lg:gap-1">
            {SECTIONS.map(([id, label], i) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="block rounded-ctl border border-line px-2.5 py-1 text-sm text-ink-2 hover:border-ctl hover:text-ink lg:border-transparent lg:px-2"
                >
                  <span className="num mr-1.5 text-ink-3">{i + 1}</span>
                  {label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="flex min-w-0 flex-col gap-14">
          <Section id="spherex" n={1} title="SPHEREx">
            <p className="max-w-2xl text-ink-2">
              A NASA telescope (launched 2025) that maps the whole sky in infrared about every six months. Its visits show
              what moves and what changes.
            </p>
          </Section>

          <Section id="steps" n={2} title="How it works">
            <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {STEPS.map((s) => (
                <li key={s.n} className="flex flex-col gap-2 rounded-panel border border-line bg-panel p-5">
                  <span className="grid h-8 w-8 place-items-center rounded-full border border-time/60 text-sm font-semibold text-time">
                    {s.n}
                  </span>
                  <h3 className="text-lg font-semibold">{s.title}</h3>
                  <p className="text-sm text-ink-2">{s.text}</p>
                </li>
              ))}
            </ol>
          </Section>

          <Section id="views" n={3} title="The four views">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {VIEWS.map((v) => (
                <article key={v.mode} className="flex flex-col gap-2 rounded-panel border border-line bg-panel p-5">
                  <h3 className="text-lg font-semibold">{v.mode}</h3>
                  <p className="text-sm text-ink-2">{v.text}</p>
                  {v.key && (
                    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
                      {v.key.map(([c, l]) => (
                        <li key={l} className="flex items-center gap-1.5">
                          <i className="h-2.5 w-2.5 rounded-full" style={{ background: c }} aria-hidden="true" />
                          {l}
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}
            </div>
          </Section>

          <Section id="limits" n={4} title="Limits">
            <ul className="grid gap-3 md:grid-cols-2">
              {LIMITS.map(([t, d]) => (
                <li key={t} className="rounded-panel border border-time/25 bg-time/[0.04] p-5">
                  <h3 className="font-semibold text-ink">{t}</h3>
                  <p className="mt-1 text-sm text-ink-2">{d}</p>
                </li>
              ))}
            </ul>
          </Section>

          <Section id="sources" n={5} title="Credits">
            <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-3">
              {SOURCES.map(([t, d]) => (
                <div key={t} className="border-l-2 border-line-2 pl-4">
                  <dt className="text-sm font-semibold text-ink">{t}</dt>
                  <dd className="mt-0.5 text-sm text-ink-2">{d}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-6 text-xs text-ink-3">NASA Space Apps 2026 · Not affiliated with NASA.</p>
          </Section>

          <motion.div {...reveal} className="flex flex-wrap items-center gap-3 rounded-panel border border-line bg-panel p-6">
            <p className="mr-auto text-lg font-semibold">Ready to look for yourself?</p>
            <Link to="/start" className={BTN.primary}>
              Start exploring <span aria-hidden="true">→</span>
            </Link>
            <Link to={`/explore?q=${encodeURIComponent("Barnard's Star")}&view=blink`} className={BTN.secondary}>
              Watch Barnard’s Star move
            </Link>
          </motion.div>
        </div>
      </div>
    </main>
  )
}

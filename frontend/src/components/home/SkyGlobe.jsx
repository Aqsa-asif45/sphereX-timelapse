import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { FRAMES, aladinLib, createSky, setSkyMode } from '../../lib/sky'
import { SKY_TARGETS, fmtRaDec } from '../../lib/targets'
import { rise, stagger, inView } from './motion'

const btn = (on) =>
  `rounded-ctl border px-3 py-1.5 text-sm ${on ? 'border-focus bg-focus/15 text-ink' : 'border-ctl text-ink-2 hover:bg-hover hover:text-ink'}`

/**
 * The whole sky as SPHEREx sees it: NASA's DR1 all-sky map on a draggable globe (Aladin Lite).
 * Loaded only when scrolled into view. The five targets are marked; clicking one on the globe opens it,
 * and the buttons below fly the globe to it (they also work by keyboard).
 */
export default function SkyGlobe() {
  const wrap = useRef(null)
  const box = useRef(null)
  const view = useRef(null)
  const navigate = useNavigate()
  const reduced = useReducedMotion()
  // without IntersectionObserver (very old browsers) load at once
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const [state, setState] = useState('loading') // loading | ready | error
  const [error, setError] = useState('')
  const [frame, setFrame] = useState(44) // 2.1 µm
  const [colour, setColour] = useState(true)
  const [focus, setFocus] = useState(null)
  const open = (name) => navigate(`/explore?q=${encodeURIComponent(name)}`)

  // load Aladin only when the globe is about to scroll into view
  useEffect(() => {
    const el = wrap.current
    if (visible || !el) return undefined
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visible])

  useEffect(() => {
    if (!visible) return undefined
    let dead = false
    aladinLib()
      .then((A) => {
        if (dead || !box.current) return
        const v = createSky(A, box.current, { fov: 140, target: '266.4 -29.0', interactive: true }) // Galactic centre
        view.current = v
        const cat = A.catalog({
          name: 'Challenge targets',
          shape: 'circle',
          sourceSize: 22,
          color: '#ffb84d',
          hoverColor: '#ffd38a',
          selectionColor: '#5fd4e3',
          displayLabel: true,
          labelColumn: 'name',
          labelColor: '#edf1f6',
          labelFont: '14px "IBM Plex Sans", sans-serif',
          onClick: (s) => open(s.data.name),
        })
        v.addCatalog(cat)
        cat.addSources(SKY_TARGETS.map((t) => A.source(t.ra, t.dec, { name: t.name, slug: t.slug })))
        setState('ready')
      })
      .catch((e) => {
        if (!dead) {
          setError(String(e?.message ?? e))
          setState('error')
        }
      })
    return () => {
      dead = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once when visible
  }, [visible])

  useEffect(() => {
    if (state === 'ready') setSkyMode(view.current, frame, colour)
  }, [state, frame, colour])

  const flyTo = (t) => {
    setFocus(t.slug)
    const v = view.current
    if (!v) return
    if (!reduced && typeof v.animateToRaDec === 'function') v.animateToRaDec(t.ra, t.dec, 1.2)
    else v.gotoRaDec(t.ra, t.dec)
    v.setFoV(8)
  }
  const t = SKY_TARGETS.find((x) => x.slug === focus)

  return (
    <motion.section
      id="sky"
      ref={wrap}
      aria-labelledby="sky-h"
      className="scroll-mt-16 border-t border-line pt-8"
      {...inView}
      variants={stagger}
    >
      <motion.div variants={rise} className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="sky-h" className="text-2xl font-medium tracking-tight">
            The whole sky, as SPHEREx sees it
          </h2>
          <p className="mt-1.5 max-w-2xl text-ink-2">
            NASA&apos;s SPHEREx DR1 all-sky map. Drag to look around, scroll to zoom, and click a target to open its
            images.
          </p>
        </div>
        <span className="rounded-full border border-ok/40 px-2.5 py-0.5 text-xs text-ok">Real SPHEREx data</span>
      </motion.div>

      <div className="relative h-[64vh] min-h-80 overflow-hidden rounded-panel border border-line bg-bg md:h-[min(72vh,680px)]">
        {/* explicit size: Aladin repositions its container, so inset alone would collapse it */}
        <div
          ref={box}
          role="application"
          aria-label="Interactive map of the whole sky from SPHEREx. Use the target buttons below to move it with the keyboard."
          className="absolute inset-0 h-full w-full"
          data-testid="sky-box"
        />
        {state !== 'ready' && (
          <p
            role={state === 'error' ? 'alert' : 'status'}
            className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center text-sm text-ink-2"
          >
            {state === 'error'
              ? `The sky map could not load here (${error}). The targets below still work.`
              : 'Loading the SPHEREx sky (Aladin Lite, about 2.4 MB)…'}
          </p>
        )}
        <AnimatePresence mode="wait">
          {t && (
            <motion.div
              key={t.slug}
              aria-live="polite"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.3 } }}
              exit={{ opacity: 0, y: 8, transition: { duration: 0.15 } }}
              className="absolute bottom-3.5 left-3.5 grid max-w-[min(320px,calc(100%-28px))] gap-1 rounded-panel border border-line-2 bg-bg-2/90 px-3.5 py-3 text-sm text-ink-2 backdrop-blur"
            >
              <b className="text-base font-medium text-ink">{t.name}</b>
              <span>{t.kind}</span>
              <span className="num font-mono text-xs">{fmtRaDec(t.ra, t.dec)}</span>
              <button
                type="button"
                onClick={() => open(t.name)}
                className="mt-1.5 justify-self-start rounded-ctl bg-time px-3 py-1.5 font-medium text-bg hover:brightness-110"
              >
                Explore its images
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div role="group" aria-label="Infrared wavelength shown" className="mt-3 flex flex-wrap items-center gap-1.5 text-sm">
        <span className="mr-1 text-ink-3">Infrared</span>
        {FRAMES.map((f) => (
          <button key={f.i} type="button" aria-pressed={frame === f.i} onClick={() => setFrame(f.i)} className={btn(frame === f.i)}>
            {f.um.toFixed(1)} µm
          </button>
        ))}
        <button
          type="button"
          aria-pressed={colour}
          onClick={() => setColour((c) => !c)}
          title="Colour by brightness (inferno) or plain grey"
          className={btn(colour)}
        >
          Colour
        </button>
      </div>

      <ul aria-label="Fly to a challenge target" className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {SKY_TARGETS.map((x) => (
          <li key={x.slug} className="shrink-0">
            <button
              type="button"
              aria-pressed={focus === x.slug}
              onClick={() => flyTo(x)}
              className={`grid rounded-panel border px-3 py-2 text-left text-sm ${focus === x.slug ? 'border-focus bg-focus/10' : 'border-line-2 bg-panel hover:bg-hover'}`}
            >
              <span className="text-ink">{x.name}</span>
              <span className="text-xs text-ink-3">{x.kind}</span>
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-3 max-w-4xl text-xs text-ink-3">
        Sky: SPHEREx DR1 all-sky HiPS (NASA/JPL-Caltech/IPAC, IRSA), a visual overview with a fixed display stretch;
        measurements always use the individual exposures. Each view is one infrared wavelength that our eyes cannot
        see, so colour shows brightness (dark → purple → orange → yellow), not true colour. Globe: Aladin Lite (CDS).
        Amber circles mark the targets; the sky pixels are not altered.
      </p>
    </motion.section>
  )
}

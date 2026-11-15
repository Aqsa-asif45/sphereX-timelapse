import { useCallback, useEffect, useMemo } from 'react'
import LoadProgress from '../components/explore/LoadProgress'
import StageBar from '../components/explore/StageBar'
import TimeControls from '../components/explore/TimeControls'
import TimeRuler from '../components/explore/TimeRuler'
import Viewer from '../components/explore/Viewer'
import { useCutouts } from '../hooks/useCutouts'
import { useExploreParams } from '../hooks/useExploreParams'
import { useObservations } from '../hooks/useObservations'
import { useStacks } from '../hooks/useStacks'
import { useTarget } from '../hooks/useTarget'
import { useTitle } from '../hooks/useTitle'
import { REF_MJD, fmtMonth, groupVisits, plural, positionAt, sizeFor } from '../lib/astro'
import { combine } from '../lib/render'
import { VIEW_LABEL, bandOf, combineItem, deepItem, exposureItem, inBand, panelsFor, visitItem } from '../lib/scenes'
import { SPEEDS, useExploreStore } from '../store/exploreStore'

const COMPARE = ['blink', 'side', 'diff', 'combine']

/** A minus/plus B is cached per pair of stacks, so redraws (blink, pan, zoom) do not redo it. */
const combined = new WeakMap()
function combineCached(a, b, op) {
  let m = combined.get(a)
  if (!m) combined.set(a, (m = new Map()))
  const k = `${op}`
  let e = m.get(b)
  if (!e) m.set(b, (e = {}))
  return (e[k] ??= combine(a, b, op))
}

const isTyping = (e) => {
  const t = e.target
  return t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(t.tagName))
}

function Notice({ children, onRetry, tone = 'info' }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`grid min-h-[320px] flex-1 place-items-center rounded-panel border p-6 text-center ${tone === 'error' ? 'border-danger/40 text-ink' : 'border-dashed border-line-2 text-ink-2'}`}
    >
      <div className="flex max-w-lg flex-col items-center gap-3">
        <div>{children}</div>
        {onRetry && (
          <button type="button" onClick={onRetry} className="rounded-ctl border border-ctl px-3 py-1.5 text-ink hover:bg-hover">
            Try again
          </button>
        )}
      </div>
    </div>
  )
}

function searchProgress(e) {
  if (!e) return "Asking NASA's archive which SPHEREx exposures cover this spot…"
  if (e.type === 'progress') return `Checking each exposure's own header: ${e.done} of ${e.total} (${plural(e.frames, 'match')} so far)`
  if (e.type === 'collection') return e.error ? `${e.collection} did not answer; trying another way…` : `IRSA listed ${e.count} files from ${e.collection}…`
  if (e.type === 'fallback') return `Using ${e.source === 'index' ? 'the local sky index' : 'IRSA TAP'} (${e.reason})…`
  return "Asking NASA's archive which SPHEREx exposures cover this spot…"
}

/** The TimeLens workspace (Phases 6–7: Sky and Time modes). */
export default function ExplorePage() {
  const [p, set] = useExploreParams()
  useTitle(p.q || 'Explore')
  const target = useTarget(p.q)
  const t = Number.isFinite(target.data?.ra) ? target.data : null // ignore an answer without a position
  const obs = useObservations(t)
  const frames = useMemo(() => [...(obs.result?.frames ?? [])].sort((x, y) => x.mjd - y.mjd), [obs.result])
  const visits = useMemo(() => groupVisits(frames), [frames])
  const n = sizeFor(p.fov)
  const center = useMemo(() => (t ? positionAt(t, REF_MJD).map((v) => +v.toFixed(6)) : null), [t])
  const cut = useCutouts(frames.length ? frames : null, center, n)
  const getStack = useStacks(cut.engine, cut.version)
  const { contrast, stretch, smooth, playing, speed, cur, phase, set: setUi } = useExploreStore()

  const disabledColours = p.view === 'exposures' && p.mode === 'time' ? ['six', 'rgb'] : p.view === 'side' && p.mode === 'time' ? ['six'] : []
  const colours = disabledColours.includes(p.colours) ? 'all' : p.colours
  const band = bandOf(colours)
  const exposures = useMemo(() => frames.filter(inBand(band)), [frames, band])
  const nv = visits.length
  const clampV = (i) => Math.min(Math.max(0, i), Math.max(0, nv - 1))
  const A = clampV(p.a ?? nv - 1) // default: latest visit against earliest
  const B = clampV(p.b ?? 0)
  const time = p.mode === 'time'
  const seqLen = !time ? 0 : p.view === 'blink' ? 2 : p.view === 'play' ? nv : p.view === 'exposures' ? exposures.length : 0

  // a new target or a new view starts from the beginning, paused
  useEffect(() => {
    setUi({ cur: 0, phase: 0, playing: false })
  }, [p.q, p.view, p.mode, setUi])

  const step = useCallback(
    (d) => {
      const s = useExploreStore.getState()
      if (p.view === 'blink') setUi({ phase: (s.phase + 1) % 2 })
      else if (seqLen) setUi({ cur: (s.cur + d + seqLen) % seqLen }) // wrap-around
    },
    [p.view, seqLen, setUi],
  )

  useEffect(() => {
    if (!playing || !time || seqLen < 2) return undefined
    const id = setInterval(() => step(1), SPEEDS[speed].ms)
    return () => clearInterval(id)
  }, [playing, time, seqLen, speed, step])

  // keyboard in Time mode: space = play/pause, left/right = step
  useEffect(() => {
    if (!time) return undefined
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('[role=dialog]')) return
      if (e.key === ' ' && !isTyping(e)) {
        e.preventDefault()
        useExploreStore.getState().togglePlay()
      } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !isTyping(e) && !(e.target instanceof HTMLSelectElement)) {
        e.preventDefault()
        step(e.key === 'ArrowRight' ? 1 : -1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [time, step])

  // ── what to draw ──
  const sceneOf = (item, tag, tagColour) => ({
    tag,
    tagColour,
    panels: panelsFor(item, colours).map((spec) => {
      if (spec.kind === 'rgb') return { kind: 'rgb', rgb: spec.rgbIds.map((ids) => (ids.length ? (getStack(ids) ?? null) : null)) }
      let data = spec.empty ? null : getStack(spec.ids)
      if (data && spec.refIds) {
        const ref = spec.refIds.length ? getStack(spec.refIds) : null
        data = ref ? combineCached(data, ref, spec.op ?? 'sub') : null
      }
      return { kind: spec.kind, label: spec.label, data: data ?? null, empty: spec.empty }
    }),
  })

  let shown = null
  let scenes = []
  let caption = ''
  if (nv) {
    if (!time || !nv) {
      shown = deepItem(frames, visits, band)
      scenes = [sceneOf(shown)]
    } else if (p.view === 'blink') {
      const showA = phase === 0
      shown = visitItem(visits, showA ? A : B, band, showA ? 'A · ' : 'B · ')
      scenes = [sceneOf(shown, `${showA ? 'A' : 'B'} · ${fmtMonth(visits[showA ? A : B].mjd)}`, showA ? '#ffb84d' : '#6ec3ff')]
    } else if (p.view === 'play') {
      shown = visitItem(visits, Math.min(cur, nv - 1), band)
      scenes = [sceneOf(shown)]
    } else if (p.view === 'exposures' && exposures.length) {
      shown = exposureItem(exposures, Math.min(cur, exposures.length - 1))
      scenes = [sceneOf(shown)]
    } else if (p.view === 'side') {
      scenes = [
        sceneOf(visitItem(visits, B, band), `B · ${fmtMonth(visits[B].mjd)}`, '#6ec3ff'),
        sceneOf(visitItem(visits, A, band), `A · ${fmtMonth(visits[A].mjd)}`, '#ffb84d'),
      ]
      caption = `Visit B (left, ${fmtMonth(visits[B].mjd)}) and visit A (right, ${fmtMonth(visits[A].mjd)}): the same patch of sky at the same zoom · ${p.fov}′ field, north up, east left`
    } else if (p.view === 'diff' || p.view === 'combine') {
      shown = combineItem(visits, A, B, band, p.view === 'diff' ? 'sub' : p.op)
      scenes = [sceneOf(shown)]
    }
    if (shown && !caption) caption = `${shown.label} · ${shown.sub} · ${p.fov}′ field, north up, east left`
  }
  const sameVisit = time && COMPARE.includes(p.view) && A === B && nv > 0
  const diffNote = time && (p.view === 'diff' || (p.view === 'combine' && p.op === 'sub'))

  // ── layout ──
  let body
  if (!p.q) body = <Notice>Search for a star name or coordinates above, or pick a target on the home page.</Notice>
  else if (target.isPending) body = <Notice>Looking up “{p.q}”…</Notice>
  else if (target.isError) body = <Notice tone="error" onRetry={() => target.refetch()}>{target.error.message}</Notice>
  else if (obs.status === 'error') body = <Notice tone="error" onRetry={obs.retry}>The search failed: {obs.error}</Notice>
  else if (obs.status !== 'done') body = <Notice>{searchProgress(obs.progress)}</Notice>
  else if (!frames.length) body = <Notice>No SPHEREx exposures cover this position yet. SPHEREx adds data every week, so it may be covered soon.</Notice>
  else {
    body = (
      <>
        <Viewer
          n={n}
          scenes={scenes}
          zoom={p.z}
          onZoom={(z) => set({ z })}
          resetKey={`${p.q}|${p.fov}`}
          contrast={contrast}
          stretch={stretch}
          smooth={smooth}
          alt={caption || 'SPHEREx image'}
          caption={
            <>
              {caption}
              {cut.loaded < cut.total && <span className="text-ink-3"> · still loading</span>}
            </>
          }
        />
        <LoadProgress loaded={cut.loaded} failed={cut.failed} total={cut.total} secondsLeft={cut.secondsLeft} error={cut.error} onRetry={cut.retry} />
        <section aria-label="Dock" className="flex flex-col gap-3 rounded-panel border border-line bg-panel p-3">
          {p.mode === 'sky' && (
            <p className="text-sm text-ink-2">
              The deepest picture of this patch: {plural(frames.length, 'exposure')} from {plural(nv, 'visit')} added together, so faint things show
              up. Moving stars smear into short streaks: switch to{' '}
              <button type="button" className="text-focus underline underline-offset-2" onClick={() => set({ mode: 'time' })}>
                Time
              </button>{' '}
              to watch them move.
            </p>
          )}
          {time && (
            <>
              <TimeControls p={p} set={set} visits={visits} seqLen={seqLen} step={step} />
              <TimeRuler
                visits={visits}
                band={band}
                view={p.view}
                cur={cur}
                exposures={exposures}
                a={A}
                b={B}
                onVisit={(i, shift) => {
                  if (p.view === 'play') setUi({ cur: i })
                  else if (COMPARE.includes(p.view)) set(shift ? { b: i } : { a: i })
                }}
                onExposure={(k) => setUi({ cur: k })}
              />
              <p className="text-xs text-ink-3">
                {sameVisit
                  ? `A and B are the same visit (visit ${A + 1}), so nothing can differ between them. Pick another visit for A or B.`
                  : diffNote
                    ? 'Orange: brighter in A. Blue: brighter in B. A moving star leaves an orange-and-blue pair.'
                    : `${VIEW_LABEL[p.view]}. Click a visit on the ruler${COMPARE.includes(p.view) ? ' to set A (shift-click sets B)' : ''}. Space plays or pauses; the arrow keys step.`}
              </p>
            </>
          )}
          {(p.mode === 'spectrum' || p.mode === 'movers') && (
            <p className="text-sm text-ink-3">
              {p.mode === 'spectrum' ? 'The spectrum lab' : 'The mover finder'} arrives in Phase {p.mode === 'spectrum' ? 9 : 10}. The image above is the deep picture.
            </p>
          )}
          {obs.notes.length > 0 && <p className="text-xs text-ink-3">{obs.notes.join(' · ')}</p>}
        </section>
      </>
    )
  }

  return (
    <main id="main" className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-3 px-4 py-4">
      <StageBar target={t} frames={frames} visits={visits} p={p} set={set} disabledColours={disabledColours} />
      {body}
    </main>
  )
}

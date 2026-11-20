import { useQueries, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ActivityLog from '../components/explore/ActivityLog'
import Inspector from '../components/explore/Inspector'
import LoadProgress from '../components/explore/LoadProgress'
import MoversPanel from '../components/explore/MoversPanel'
import OverlayBar from '../components/explore/OverlayBar'
import SpectrumLab from '../components/explore/SpectrumLab'
import StageBar from '../components/explore/StageBar'
import TimeControls from '../components/explore/TimeControls'
import TimeRuler from '../components/explore/TimeRuler'
import Viewer from '../components/explore/Viewer'
import { catalogQuery, useCatalog } from '../hooks/useCatalog'
import { useCutouts } from '../hooks/useCutouts'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useExploreParams } from '../hooks/useExploreParams'
import { useObservations } from '../hooks/useObservations'
import { useStacks } from '../hooks/useStacks'
import { useServerStatus } from '../hooks/useServerStatus'
import { useTarget } from '../hooks/useTarget'
import { useTitle } from '../hooks/useTitle'
import * as api from '../lib/api'
import { REF_MJD, fmtMonth, groupVisits, gridToSky, plural, positionAt, sizeFor } from '../lib/astro'
import { idsKey } from '../lib/engine'
import { marksAsCandidates, reviewKey, toCandidates } from '../lib/movers'
import { WIDE_PX, badFraction, differenceOf, flagName, fmtMJy, isBadBit, readPixel, signed } from '../lib/overlays'
import { combine } from '../lib/render'
import { KEYS, load, save } from '../lib/storage'
import { VIEW_LABEL, bandOf, combineItem, deepItem, exposureItem, inBand, panelsFor, visitItem } from '../lib/scenes'
import { useActivity } from '../store/activityStore'
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

/** Bad-pixel maps per set of exposures, remade when more images have arrived (version). */
const badMaps = new WeakMap()
function badMapFor(images, version, ids) {
  let e = badMaps.get(images)
  if (!e || e.version !== version) badMaps.set(images, (e = { version, map: new Map() }))
  const k = idsKey(ids)
  if (!e.map.has(k)) e.map.set(k, badFraction(images, ids))
  return e.map.get(k)
}

const SOURCE_NAME = { sia2: 'IRSA SIA2', tap: 'IRSA TAP', index: 'the sky index' }

/** The hover read-out for one pixel (VW-6): value, noise, flags, RA and Dec. */
function readoutFor(hit, { scenes, images, center, n, quality, flagNames }) {
  const panel = scenes[hit.scene]?.panels[hit.panel]
  if (!panel || !center) return null
  const c0 = (n - 1) / 2
  const [ra, dec] = gridToSky(center[0], center[1], hit.gx - c0, hit.gy - c0)
  const i = hit.gy * n + hit.gx
  let r = readPixel(images, panel.ids ?? [], i)
  if (panel.refIds?.length && panel.op !== 'add') r = differenceOf(r, readPixel(images, panel.refIds, i))
  else if (panel.refIds?.length) r = readPixel(images, [...panel.ids, ...panel.refIds], i)
  const sigma = panel.data?.[i]
  const what = panel.refIds?.length && panel.op !== 'add' ? 'A − B' : r.used === 1 ? 'one exposure' : `mean of ${r.used} exposures`
  return (
    <>
      <div>
        RA {ra.toFixed(5)}° · Dec {signed(dec, 5)}° <span className="text-ink-3">· pixel {hit.gx + 1}, {hit.gy + 1}</span>
      </div>
      <div>
        {r.used === 0 && !Number.isFinite(sigma) ? (
          <span className="text-ink-3">blank: not measured here</span>
        ) : (
          <>
            {Number.isFinite(sigma) && <span className="text-ink">{signed(sigma, 1)} σ</span>}
            {Number.isFinite(r.mean) && (
              <>
                {Number.isFinite(sigma) && ' · '}
                <span className="text-ink">{fmtMJy(r.mean)}</span>
                {Number.isFinite(r.noise) ? ` ± ${fmtMJy(r.noise)}` : quality ? ' ± ?' : ''} MJy/sr <span className="text-ink-3">({what})</span>
              </>
            )}
          </>
        )}
      </div>
      <div>
        Flags:{' '}
        {!quality ? (
          <span className="text-ink-3">not loaded (switch on Bad pixels)</span>
        ) : r.withFlags === 0 ? (
          <span className="text-ink-3">no flag information</span>
        ) : r.flags.length === 0 ? (
          'none'
        ) : (
          r.flags.slice(0, 4).map(([b, k], j) => (
            <span key={b} className={isBadBit(b) ? 'text-time' : ''}>
              {j > 0 && ', '}
              {flagName(b, flagNames)} {k}/{r.withFlags}
            </span>
          ))
        )}
        {quality && r.flags.length > 4 && <span className="text-ink-3"> +{r.flags.length - 4} more</span>}
      </div>
    </>
  )
}

/** The TimeLens workspace (Phases 6–8: Sky and Time modes, overlays and details). */
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
  const { contrast, stretch, smooth, playing, speed, cur, phase, overlays, details, probe, set: setUi } = useExploreStore()
  // flags and noise layers come only on request (Bad pixels): they made every image about 3x heavier and the
  // first load about 4x slower, and without them the default view is the one `app.cli warm` pre-builds
  const quality = overlays.bad
  const cut = useCutouts(frames.length ? frames : null, center, n, quality)
  const getStack = useStacks(cut.engine, cut.version)
  const gaia = useCatalog('gaia', center, p.fov, overlays.gaia)
  const wise = useCatalog('wise', center, p.fov, overlays.wise)
  const span = frames.length ? [frames[0].mjd, frames[frames.length - 1].mjd] : null
  const wide = useMediaQuery(`(min-width: ${WIDE_PX}px)`)
  const detailsOpen = details ?? wide
  const status = useServerStatus()

  // the files' own flag bit names, one exposure per release
  const firstOfRelease = useMemo(() => [...new Map(frames.map((f) => [f.release, f.id])).entries()], [frames])
  const names = useQueries({
    queries: firstOfRelease.map(([, id]) => ({
      queryKey: ['flags', id],
      queryFn: ({ signal }) => api.flagNames(id, signal),
      enabled: quality,
      staleTime: Infinity,
      retry: 1,
    })),
  })
  const flagNames = Object.fromEntries(firstOfRelease.map(([rel], k) => [rel, names[k]?.data?.names]))

  // bad-pixel maps, made once per set of exposures and redone as more images arrive
  const badOf = (ids) => (overlays.bad && ids?.length ? badMapFor(cut.images, cut.version, ids) : null)

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

  // a new target or a new view starts from the beginning, paused (or at the exposure asked for by a spectrum point)
  useEffect(() => {
    setUi({ cur: useExploreStore.getState().jump ?? 0, jump: null, phase: 0, playing: false })
  }, [p.q, p.view, p.mode, setUi])
  // a new target or field measures at the target again
  useEffect(() => {
    setUi({ probe: null })
  }, [p.q, p.fov, setUi])
  // ── movers: finds, your marks, review status (this device only) ──
  const qc = useQueryClient()
  const moverKey = `${p.q}|${p.fov}|${frames.length}`
  const [found, setFound] = useState({ key: '', cands: null, error: '' })
  const cands = found.key === moverKey ? found.cands : null
  const [finding, setFinding] = useState('')
  // the selected candidate and "mark a spot" mode belong to one view: a new target or field clears them
  const [pickState, setPickState] = useState({ key: '', id: null })
  const pick = pickState.key === moverKey ? pickState.id : null
  const setPick = (id) => setPickState({ key: moverKey, id })
  const [markState, setMarkState] = useState('')
  const marking = markState === moverKey
  const setMarking = (on) => setMarkState(on ? moverKey : '')
  const [marks, setMarks] = useState(() => load(KEYS.marks, []))
  const [reviews, setReviews] = useState(() => load(KEYS.reviews, {}))
  const [storageOk, setStorageOk] = useState(true)
  const liveKey = useRef(moverKey) // the view now, for answers that arrive after the user moved on
  useEffect(() => {
    liveKey.current = moverKey
  }, [moverKey])
  const yours = useMemo(() => (t ? marksAsCandidates(marks, t.name, center, n) : []), [marks, t, center, n])
  const reviewOf = (c) => reviews[reviewKey(t?.name ?? p.q, c)] ?? { status: 'new', note: '' }
  const setReview = (c, r) => {
    const next = { ...reviews, [reviewKey(t?.name ?? p.q, c)]: { ...reviewOf(c), ...r } }
    setReviews(next)
    setStorageOk(save(KEYS.reviews, next))
  }
  const saveMarks = (ms) => {
    setMarks(ms)
    setStorageOk(save(KEYS.marks, ms))
  }
  const runMovers = async () => {
    if (!center || !visits.length) return
    const key = moverKey
    setFinding(key)
    const gaiaRows = await qc.fetchQuery(catalogQuery('gaia', center, p.fov)).catch(() => null) // null: "Gaia not reachable"
    const finds = await cut.engine.findMovers(n, visits.map((v) => ({ i: v.i, mjd: v.mjd, ids: v.frames.map((f) => f.id) })))
    setFinding('')
    // the target or field changed while it ran: these finds belong to the old view (OV-5)
    if (key !== liveKey.current || !finds) return
    const list = toCandidates(finds, { center, n, midMjd: (frames[0].mjd + frames[frames.length - 1].mjd) / 2, gaia: gaiaRows })
    setFound({ key, cands: list, error: '' })
    setPick(null)
    const moving = list.filter((c) => c.kind === 'moving' && !c.dismissed)
    log(view, `Mover finder: ${plural(moving.length, 'moving source')}, ${plural(list.filter((c) => c.kind === 'once' && !c.dismissed).length, 'one-visit source')}${gaiaRows ? '' : ' (Gaia not reachable)'}`, 'ok')
  }
  const showExposure = (f) => {
    setUi({ jump: Math.max(0, frames.findIndex((x) => x.id === f.id)) })
    set({ mode: 'time', view: 'exposures', colours: 'all' })
  }

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

  // ── activity log (HL-5): one log per view; a late answer for a view already left is not logged ──
  const view = `${p.q}|${p.fov}`
  const { begin, log } = useActivity.getState()
  useEffect(() => {
    if (begin(view) && p.q) log(view, `Looking up “${p.q}”…`)
  }, [view, p.q, begin, log])
  useEffect(() => {
    if (target.isError) log(view, target.error.message, 'error')
    else if (t) log(view, `${t.name}: RA ${t.ra.toFixed(5)}°, Dec ${signed(t.dec, 5)}° (${t.source})`, 'ok')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per answer
  }, [t, target.isError])
  const ev = obs.progress
  useEffect(() => {
    if (!ev) return
    if (ev.type === 'started') log(view, "Searching NASA's archive for every SPHEREx exposure of this spot…")
    else if (ev.type === 'collection') log(view, ev.error ? `${ev.collection} did not answer (${ev.error})` : `IRSA listed ${ev.count} files from ${ev.collection}`, ev.error ? 'warn' : 'info')
    else if (ev.type === 'fallback') log(view, `Fallback: using ${SOURCE_NAME[ev.source] ?? ev.source} (${ev.reason})`, 'warn')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per event
  }, [ev])
  useEffect(() => {
    if (obs.status === 'error') log(view, `Search failed: ${obs.error}`, 'error')
    else if (obs.status === 'done' && obs.result) {
      const r = obs.result
      const via = (r.sources ?? []).map((x) => SOURCE_NAME[x] ?? x).join(' + ') || 'a saved search'
      log(view, r.count ? `Found ${plural(r.count, 'exposure')} in ${plural(groupVisits(r.frames).length, 'visit')} via ${via}` : 'No SPHEREx exposures cover this spot yet', r.count ? 'ok' : 'warn')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per search outcome
  }, [obs.status, obs.result])
  const imagesDone = cut.total > 0 && cut.loaded + cut.failed >= cut.total
  useEffect(() => {
    if (!cut.total) return
    if (!imagesDone) log(view, `Loading ${plural(cut.total, 'image')} (one per visit first)${cut.quality ? ' with flags and noise' : ''}…`)
    else if (cut.failed) log(view, `${cut.failed} of ${plural(cut.total, 'image')} could not be loaded${cut.error ? ` (${cut.error})` : ''}`, 'warn')
    else log(view, `All ${plural(cut.total, 'image')} ready`, 'ok')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per load and per finish
  }, [imagesDone, cut.total, cut.quality])
  for (const [q, name] of [
    [gaia, 'Gaia DR3'],
    [wise, 'CatWISE2020'],
  ]) {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- a fixed list of two, always in the same order
    useEffect(() => {
      if (q.isError) log(view, `${name} unavailable: ${q.error.message}`, 'error')
      else if (q.data) log(view, `${name}: ${plural(q.data.count ?? q.data.rows.length, 'source')} around the field (${q.data.source}${q.data.from_cache ? ', saved' : ''})`, 'ok')
      // eslint-disable-next-line react-hooks/exhaustive-deps -- once per answer
    }, [q.data, q.isError])
  }

  // ── what to draw ──
  const sceneOf = (item, tag, tagColour) => ({
    tag,
    tagColour,
    overlay: center && {
      center,
      mjd: item.mjd,
      span,
      target: overlays.ring ? t : null,
      probe: p.mode === 'spectrum' ? probe : null,
      finds: p.mode === 'movers' ? [...(cands ?? []), ...yours] : null,
      pick,
      gaia: overlays.gaia ? (gaia.data ?? null) : null,
      wise: overlays.wise ? (wise.data ?? null) : null,
    },
    panels: panelsFor(item, colours).map((spec) => {
      if (spec.kind === 'rgb') {
        const all = spec.rgbIds.flat()
        return { kind: 'rgb', rgb: spec.rgbIds.map((ids) => (ids.length ? (getStack(ids) ?? null) : null)), ids: all, bad: badOf(all) }
      }
      let data = spec.empty ? null : getStack(spec.ids)
      if (data && spec.refIds) {
        const ref = spec.refIds.length ? getStack(spec.refIds) : null
        data = ref ? combineCached(data, ref, spec.op ?? 'sub') : null
      }
      const bad = spec.empty ? null : badOf(spec.refIds ? [...spec.ids, ...spec.refIds] : spec.ids)
      return { kind: spec.kind, label: spec.label, data: data ?? null, empty: spec.empty, ids: spec.ids, refIds: spec.refIds, op: spec.op, bad }
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
  // what the Details panel describes: the picture on screen (visit A in Side by side)
  const onScreen = shown ?? (nv && time && p.view === 'side' ? visitItem(visits, A, band, 'A · ') : null)
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
          onPick={
            p.mode === 'spectrum'
              ? (hit) => setUi({ probe: [hit.gx, hit.gy] })
              : p.mode === 'movers' && marking && t
                ? (hit) => {
                    const c0 = (n - 1) / 2
                    const [ra, dec] = gridToSky(center[0], center[1], hit.gx - c0, hit.gy - c0)
                    const m = { id: Math.random().toString(36).slice(2, 9), target: t.name, ra, dec, seen: caption, mjd: onScreen?.mjd ?? REF_MJD, created: new Date().toISOString() }
                    saveMarks([...marks, m])
                    setMarking(false)
                    setPick(`Y${yours.length + 1}`)
                  }
                : undefined
          }
          describe={(hit) => readoutFor(hit, { scenes, images: cut.images, center, n, quality: cut.quality, flagNames })}
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
          {p.mode === 'spectrum' && (
            <SpectrumLab
              q={p.q}
              target={t}
              frames={frames}
              visits={visits}
              engine={cut.engine}
              version={cut.version}
              n={n}
              center={center}
              images={cut.images}
              probe={probe}
              setProbe={(v) => setUi({ probe: v })}
              onShowExposure={showExposure}
            />
          )}
          {p.mode === 'movers' && (
            <MoversPanel
              cands={cands}
              yours={yours}
              finding={finding === moverKey}
              canRun={nv >= 2 && cut.loaded > 0}
              runNote={
                nv < 2
                  ? 'Needs at least two visits to compare.'
                  : cut.loaded < cut.total
                    ? `Images still loading (${cut.loaded} of ${cut.total}): a search now uses those so far.`
                    : `Compares ${plural(nv, 'visit')} (${plural(frames.length, 'exposure')}), then checks every find against Gaia DR3.`
              }
              onRun={runMovers}
              pick={pick}
              onPick={setPick}
              marking={marking}
              setMarking={setMarking}
              reviewOf={reviewOf}
              setReview={setReview}
              onRemoveMark={(c) => {
                saveMarks(marks.filter((m) => m.id !== c.markId))
                setPick(null)
              }}
              storageOk={storageOk}
              targetName={t?.name ?? p.q}
              loaded={cut.loaded}
              total={cut.total}
            />
          )}
          {obs.notes.length > 0 && <p className="text-xs text-ink-3">{obs.notes.join(' · ')}</p>}
        </section>
      </>
    )
  }

  const loadedAll = cut.total > 0 && cut.loaded + cut.failed >= cut.total
  const flagsNote = overlays.bad && quality && cut.total ? (loadedAll ? null : `loading flags… ${cut.loaded} of ${cut.total}`) : null
  const inspector = (
    <Inspector
      open={detailsOpen}
      wide={wide}
      onClose={() => setUi({ details: false })}
      q={p.q}
      target={t}
      result={obs.result}
      frames={frames}
      visits={visits}
      cur={onScreen}
      fov={p.fov}
      n={n}
      center={center}
      cut={cut}
      images={cut.images}
      flagNames={flagNames}
      irsa={status.irsa}
    />
  )

  return (
    <main id="main" className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-3 px-4 py-4">
      <StageBar
        target={t}
        frames={frames}
        visits={visits}
        p={p}
        set={set}
        disabledColours={disabledColours}
        detailsOpen={detailsOpen}
        onDetails={() => setUi({ details: !detailsOpen })}
      />
      <OverlayBar hasTarget={!!t} gaia={overlays.gaia ? gaia : null} wise={overlays.wise ? wise : null} flagsNote={flagsNote} />
      <div className={wide && detailsOpen ? 'grid flex-1 grid-cols-[minmax(0,1fr)_360px] items-start gap-3' : 'flex flex-1 flex-col'}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 self-stretch">
          {body}
          {p.q && <ActivityLog />}
        </div>
        {wide && inspector}
      </div>
      {!wide && inspector}
    </main>
  )
}

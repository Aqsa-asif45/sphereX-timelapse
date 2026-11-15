import { useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../lib/api'
import { PIXEL_ARCSEC, groupVisits } from '../lib/astro'
import { createEngine } from '../lib/engine'

const FALLBACK_AT_ONCE = 6 // a browser opens about six connections to one server
const TICK_MS = 400 // redraw at most this often while images arrive

/** One exposure from each visit in turn, so every visit gets images early. */
export function interleave(frames) {
  const vs = groupVisits(frames)
  const out = []
  for (let k = 0; out.length < frames.length; k++) for (const v of vs) if (v.frames[k]) out.push(v.frames[k])
  return out
}

/** Seconds left from the recent completion rate (NaN until there is enough to go on). */
export function timeLeft(left, stamps) {
  if (stamps.length < 6 || left <= 0) return NaN
  return (left * (stamps[stamps.length - 1] - stamps[0])) / (stamps.length - 1) / 1000
}

/**
 * Loads every exposure's cutout for one view (target x field size) in ONE streamed request, and hands each
 * one to the image engine. Falls back to one request per image if the batch endpoint is missing.
 * Failed images are counted and can be fetched again with retry().
 * @returns {{ engine, images: Map, loaded, failed, total, version, secondsLeft, error, retry }}
 */
export function useCutouts(frames, center, n) {
  const engine = useMemo(() => createEngine(), [])
  // raw cutouts by frame id (kept for measurements in later phases); a stable object, mutated as images arrive
  const store = useMemo(() => ({ images: new Map() }), [])
  const [counts, setCounts] = useState({ loaded: 0, failed: 0, version: 0, secondsLeft: NaN, error: null })
  const [attempt, setAttempt] = useState(0)
  const failedIds = useRef(new Set())
  const viewKey = frames && center ? `${center[0]}|${center[1]}|${n}|${frames.length}` : ''
  const lastView = useRef('')

  useEffect(() => () => engine.dispose(), [engine])

  useEffect(() => {
    if (!viewKey) return undefined
    if (lastView.current !== viewKey) {
      // a new target or field: start over
      lastView.current = viewKey
      store.images.clear()
      failedIds.current = new Set()
      engine.reset()
      setCounts({ loaded: 0, failed: 0, version: 0, secondsLeft: NaN, error: null })
    }
    const todo = interleave(frames).filter((f) => !store.images.has(f.id))
    if (!todo.length) return undefined
    failedIds.current = new Set()
    const ac = new AbortController()
    const stamps = []
    let dirty = false
    const flush = () => {
      if (!dirty || ac.signal.aborted) return
      dirty = false
      const left = frames.length - store.images.size - failedIds.current.size
      setCounts((c) => ({
        ...c,
        loaded: store.images.size,
        failed: failedIds.current.size,
        version: c.version + 1,
        secondsLeft: timeLeft(left, stamps),
      }))
    }
    const timer = setInterval(flush, TICK_MS)
    const got = (id, c) => {
      if (ac.signal.aborted) return
      stamps.push(performance.now())
      if (stamps.length > 40) stamps.shift()
      if (c) {
        store.images.set(id, c)
        engine.add(id, c.image, c.flags)
      } else failedIds.current.add(id)
      dirty = true
    }
    const body = { ids: todo.map((f) => f.id), ra: center[0], dec: center[1], n, scale: PIXEL_ARCSEC }

    const oneByOne = async () => {
      let next = 0
      const worker = async () => {
        while (next < todo.length && !ac.signal.aborted) {
          const f = todo[next++]
          try {
            got(f.id, await api.cutout({ id: f.id, ...body, ids: undefined }, ac.signal))
          } catch (e) {
            if (e.name === 'AbortError') return
            got(f.id, null)
          }
        }
      }
      await Promise.all(Array.from({ length: FALLBACK_AT_ONCE }, worker))
    }

    api
      .cutoutBatch(body, got, ac.signal)
      .catch((e) => {
        if (e.name === 'AbortError') return null
        if (e.status === 404 || e.status === 405) return oneByOne() // no batch endpoint: one request per image
        // the stream broke: everything not yet received counts as failed, so "Try again" can fetch it
        for (const f of todo) if (!store.images.has(f.id)) failedIds.current.add(f.id)
        dirty = true
        setCounts((c) => ({ ...c, error: e.message }))
        return null
      })
      .finally(() => {
        dirty = true
        flush()
        clearInterval(timer)
      })
    return () => {
      ac.abort()
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- viewKey covers frames, center and n
  }, [viewKey, attempt, engine])

  return {
    engine,
    images: store.images,
    total: frames?.length ?? 0,
    ...counts,
    retry: () => {
      setCounts((c) => ({ ...c, failed: 0, error: null }))
      setAttempt((a) => a + 1)
    },
  }
}

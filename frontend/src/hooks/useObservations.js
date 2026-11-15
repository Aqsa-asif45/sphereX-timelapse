import { useEffect, useState } from 'react'
import * as api from '../lib/api'

/**
 * Every SPHEREx exposure of the target, via the live search stream. While it runs, `progress` says what
 * is happening (collections answering, fallback used, exposures checked); then `result` arrives.
 * A new target cancels the old search, and a late answer for an old target is dropped.
 */
export function useObservations(target) {
  const [state, setState] = useState({ status: 'idle', progress: null, result: null, error: null, notes: [] })
  const [attempt, setAttempt] = useState(0)
  const key = target ? `${target.ra}|${target.dec}|${target.epoch_mjd}|${target.pmra}|${target.pmdec}` : ''

  useEffect(() => {
    if (!target) return undefined
    const ac = new AbortController()
    const notes = []
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new search starts from a clean state
    setState({ status: 'running', progress: null, result: null, error: null, notes })
    const params = { ra: target.ra, dec: target.dec, epoch_mjd: target.epoch_mjd, pmra: target.pmra, pmdec: target.pmdec }
    api
      .streamObservations(
        params,
        (e) => {
          if (ac.signal.aborted) return
          if (e.type === 'fallback') notes.push(`Using ${e.source === 'index' ? 'the local sky index' : 'IRSA TAP'}: ${e.reason}`)
          setState((s) => ({ ...s, progress: e, notes: [...notes] }))
        },
        ac.signal,
      )
      .then((result) => !ac.signal.aborted && setState({ status: 'done', progress: null, result, error: null, notes }))
      .catch((e) => {
        if (e.name !== 'AbortError' && !ac.signal.aborted) setState((s) => ({ ...s, status: 'error', error: e.message }))
      })
    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key covers every field of the target
  }, [key, attempt])

  return { ...state, retry: () => setAttempt((a) => a + 1) }
}

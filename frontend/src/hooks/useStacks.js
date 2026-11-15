import { useCallback, useEffect, useRef, useState } from 'react'
import { idsKey } from '../lib/engine'

/**
 * Stacks on demand, cached. get(ids) returns the latest stack for those exposures (or undefined while the
 * first one is being made) and asks the engine for a fresher one when more images have arrived since.
 * The previous stack stays on screen while the new one is made, so the picture never blinks to black.
 */
export function useStacks(engine, version) {
  const cache = useRef(new Map()) // key -> { version, value, pending }
  const [, setTick] = useState(0)

  useEffect(() => {
    cache.current = new Map()
  }, [engine])

  return useCallback(
    (ids) => {
      if (!ids?.length) return null
      const key = idsKey(ids)
      let e = cache.current.get(key)
      if (!e) {
        e = { version: -1, value: undefined, pending: false }
        cache.current.set(key, e)
      }
      if (e.version < version && !e.pending) {
        e.pending = true
        const asked = version
        engine.stack(ids).then((value) => {
          e.pending = false
          e.version = asked
          e.value = value
          setTick((t) => t + 1)
        })
      }
      return e.value
    },
    [engine, version],
  )
}

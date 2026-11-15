/**
 * The image engine: the page hands it each loaded cutout, and asks it for stacks of any set of exposures.
 * The work runs in a Web Worker; where workers are not available (tests, very old browsers) the same
 * functions run in place.
 */
import { findMovers } from './movers'
import { measure } from './photometry'
import { normalize, stack } from './render'

export function createEngine({ useWorker = typeof Worker !== 'undefined' } = {}) {
  let worker = null
  let canUseWorker = useWorker
  const local = new Map()
  const waiting = new Map()
  let req = 0

  /**
   * The worker starts on first use, and again after dispose(): React's development mode mounts, unmounts
   * and remounts every component once, so a worker stopped on that first unmount must be able to restart.
   */
  const ensure = () => {
    if (worker || !canUseWorker) return worker
    try {
      worker = new Worker(new URL('../workers/image.worker.js', import.meta.url), { type: 'module' })
      worker.onmessage = (e) => {
        const resolve = waiting.get(e.data.req)
        waiting.delete(e.data.req)
        resolve?.(e.data.out)
      }
    } catch {
      canUseWorker = false
      worker = null
    }
    return worker
  }

  return {
    /** A cutout arrived: keep it (in sigma units) for stacking. */
    add(id, image, flags) {
      const w = ensure()
      if (w) w.postMessage({ type: 'add', id, image, flags })
      else {
        const nrm = normalize(image)
        if (nrm) local.set(id, { s: nrm.s, flags, raw: image })
      }
    },
    /** Sigma-clipped stack of these exposures (those loaded so far). @returns {Promise<Float32Array|null>} */
    stack(ids) {
      const w = ensure()
      if (!w) return Promise.resolve(stack(ids.map((id) => local.get(id)).filter(Boolean)))
      return new Promise((resolve) => {
        const r = ++req
        waiting.set(r, resolve)
        w.postMessage({ type: 'stack', req: r, ids })
      })
    },
    /**
     * Aperture photometry (µJy) of each exposure at its own grid position.
     * @param {number} n @param {Array<{id:string, x:number, y:number}>} items
     * @returns {Promise<Array<{id:string, flux:number, err:number}>|null>}
     */
    measure(n, items) {
      const w = ensure()
      if (!w) return Promise.resolve(items.map(({ id, x, y }) => ({ id, ...(local.get(id) ? measure(local.get(id).raw, n, x, y) : { flux: NaN, err: NaN }) })))
      return new Promise((resolve) => {
        const r = ++req
        waiting.set(r, resolve)
        w.postMessage({ type: 'measure', req: r, n, items })
      })
    },
    /**
     * The mover finder on one stack per visit (in the worker).
     * @param {number} n @param {Array<{i:number, mjd:number, ids:string[]}>} visits
     */
    findMovers(n, visits) {
      const w = ensure()
      if (!w) {
        const vis = visits
          .map((v) => {
            const list = v.ids.map((id) => local.get(id)).filter(Boolean)
            return { i: v.i, mjd: v.mjd, frames: list.length, s: stack(list) }
          })
          .filter((v) => v.s)
        return Promise.resolve(findMovers(vis, n))
      }
      return new Promise((resolve) => {
        const r = ++req
        waiting.set(r, resolve)
        w.postMessage({ type: 'movers', req: r, n, visits })
      })
    },
    reset() {
      local.clear()
      worker?.postMessage({ type: 'reset' })
    },
    dispose() {
      worker?.terminate()
      worker = null
      for (const resolve of waiting.values()) resolve(null)
      waiting.clear()
    },
  }
}

/** A short, stable key for a list of ids (used to cache stacks). */
export function idsKey(ids) {
  let h = 2166136261
  for (const id of ids) {
    for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
    h = Math.imul(h ^ 124, 16777619)
  }
  return `${ids.length}:${(h >>> 0).toString(36)}`
}

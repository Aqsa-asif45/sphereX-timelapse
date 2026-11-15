/**
 * Image worker: keeps every loaded exposure in sigma units and makes stacks on request, so stacking
 * hundreds of exposures (or a 30' field) never freezes the page.
 *
 * Messages in:  {type:'add', id, image: Float32Array, flags?: Int32Array}
 *               {type:'stack', req, ids: string[]}
 *               {type:'measure', req, n, items: [{id, x, y}]}   aperture photometry on the raw values
 *               {type:'movers', req, n, visits: [{i, mjd, ids}]}  the mover finder on one stack per visit
 *               {type:'reset'}
 * Messages out: {req, out: Float32Array | null}  or, for measure, {req, out: [{id, flux, err}]}
 */
import { findMovers } from '../lib/movers'
import { measure } from '../lib/photometry'
import { normalize, stack } from '../lib/render'

const frames = new Map()

/** One stack per visit (exposures loaded so far), then the mover finder. */
export function moversOf(visits, n, get) {
  const vis = visits
    .map((v) => {
      const list = v.ids.map(get).filter(Boolean)
      return { i: v.i, mjd: v.mjd, frames: list.length, s: stack(list) }
    })
    .filter((v) => v.s)
  return findMovers(vis, n)
}

self.onmessage = (e) => {
  const m = e.data
  if (m.type === 'add') {
    const nrm = normalize(m.image)
    if (nrm) frames.set(m.id, { s: nrm.s, flags: m.flags, raw: m.image })
  } else if (m.type === 'stack') {
    const out = stack(m.ids.map((id) => frames.get(id)).filter(Boolean))
    self.postMessage({ req: m.req, out }, out ? [out.buffer] : [])
  } else if (m.type === 'measure') {
    const out = m.items.map(({ id, x, y }) => {
      const f = frames.get(id)
      return { id, ...(f ? measure(f.raw, m.n, x, y) : { flux: NaN, err: NaN }) }
    })
    self.postMessage({ req: m.req, out })
  } else if (m.type === 'movers') {
    self.postMessage({ req: m.req, out: moversOf(m.visits, m.n, (id) => frames.get(id)) })
  } else if (m.type === 'reset') {
    frames.clear()
  }
}

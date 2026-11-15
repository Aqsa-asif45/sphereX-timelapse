/**
 * Image worker: keeps every loaded exposure in sigma units and makes stacks on request, so stacking
 * hundreds of exposures (or a 30' field) never freezes the page.
 *
 * Messages in:  {type:'add', id, image: Float32Array, flags?: Int32Array}
 *               {type:'stack', req, ids: string[]}
 *               {type:'reset'}
 * Messages out: {req, out: Float32Array | null}
 */
import { normalize, stack } from '../lib/render'

const frames = new Map()

self.onmessage = (e) => {
  const m = e.data
  if (m.type === 'add') {
    const nrm = normalize(m.image)
    if (nrm) frames.set(m.id, { s: nrm.s, flags: m.flags })
  } else if (m.type === 'stack') {
    const out = stack(m.ids.map((id) => frames.get(id)).filter(Boolean))
    self.postMessage({ req: m.req, out }, out ? [out.buffer] : [])
  } else if (m.type === 'reset') {
    frames.clear()
  }
}

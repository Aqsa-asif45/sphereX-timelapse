/**
 * What to draw. An "item" is one picture: a set of exposures (a visit, all visits, or one exposure),
 * optionally combined with a reference set (A minus B, or A plus B). Panels say which stacks each picture
 * needs; the page resolves them through the image engine.
 */
import { BANDS, fmtMonth, fmtSpan, plural } from './astro'

export const COLOURS = ['all', 'six', 'rgb', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6']
export const COLOUR_LABEL = {
  all: 'All colours combined',
  six: 'Six bands side by side',
  rgb: 'False colour (blue → red)',
  ...Object.fromEntries(BANDS.map((b) => [`d${b.det}`, `Band ${b.det} only · ${b.lo.toFixed(2)}–${b.hi.toFixed(2)} µm`])),
}
export const VIEW_LABEL = {
  blink: 'Blink',
  play: 'Play visits',
  exposures: 'Every exposure',
  side: 'Side by side',
  diff: 'Difference',
  combine: 'Combine',
}
export const bandOf = (colours) => (colours[0] === 'd' ? +colours[1] : 0)
export const inBand = (band) => (f) => !band || f.det === band

const byDet = (frames, dets) => frames.filter((f) => dets.includes(f.det))
const ids = (frames) => frames.map((f) => f.id)

/**
 * Panels for one item.
 * @returns {Array<{kind:'heat'|'diff'|'rgb', label?:string, ids?:string[], refIds?:string[], op?:string,
 *   rgbIds?:Array<string[]>, empty?:boolean}>}
 */
export function panelsFor(item, colours) {
  const kind = item.ref && item.op !== 'add' ? 'diff' : 'heat'
  const one = (frames) => {
    const dets = [...new Set(frames.map((f) => f.det))]
    return {
      kind,
      ids: ids(frames),
      refIds: item.ref ? ids(byDet(item.ref, dets)) : undefined, // compare like with like: same detectors
      op: item.op,
      empty: !frames.length,
    }
  }
  if (item.frames.length === 1 || colours === 'all' || colours[0] === 'd') return [one(item.frames)]
  if (colours === 'six') {
    return BANDS.map((b) => ({ ...one(byDet(item.frames, [b.det])), label: `${b.lo.toFixed(2)}–${b.hi.toFixed(2)} µm` }))
  }
  if (kind === 'diff') return [one(item.frames)] // a colour difference is unreadable: show it in one panel
  // false colour: blue = detectors 1–2 (0.75–1.6 µm), green = 3–4 (1.6–3.8 µm), red = 5–6 (3.8–5 µm)
  return [{ kind: 'rgb', rgbIds: [[5, 6], [3, 4], [1, 2]].map((d) => ids(byDet(item.frames, d))) }]
}

/** All visits stacked: the deepest picture. */
export function deepItem(frames, visits, band) {
  const span = frames.length ? [frames[0].mjd, frames[frames.length - 1].mjd] : null
  return {
    key: `deep|${band}`,
    label: `All ${plural(visits.length, 'visit')} combined`,
    sub: span ? fmtSpan(span[0], span[1]) : '',
    mjd: span ? (span[0] + span[1]) / 2 : 0,
    frames: frames.filter(inBand(band)),
  }
}

export function visitItem(visits, i, band, tag = '') {
  const v = visits[i]
  return {
    key: `v${i}|${band}`,
    label: `${tag}Visit ${i + 1} of ${visits.length}`,
    sub: fmtSpan(v.start, v.end),
    mjd: v.mjd,
    frames: v.frames.filter(inBand(band)),
  }
}

export function exposureItem(exposures, k) {
  const f = exposures[k]
  return {
    key: `e${f.id}`,
    label: `Exposure ${k + 1} of ${exposures.length}`,
    sub: `${fmtSpan(f.mjd, f.mjd)} · ${f.lambda_um.toFixed(2)} µm · detector ${f.det}`,
    mjd: f.mjd,
    frames: [f],
  }
}

/** Visit A combined with visit B ('sub' = A minus B, 'add' = A plus B). */
export function combineItem(visits, A, B, band, op) {
  const a = visitItem(visits, A, band)
  const b = visitItem(visits, B, band)
  return {
    ...a,
    key: `c${A}${op}${B}|${band}`,
    label: `Visit ${A + 1} ${op === 'sub' ? 'minus' : 'plus'} visit ${B + 1}`,
    sub: `${fmtMonth(visits[A].mjd)} ${op === 'sub' ? 'vs' : 'and'} ${fmtMonth(visits[B].mjd)}`,
    ref: b.frames,
    op,
  }
}

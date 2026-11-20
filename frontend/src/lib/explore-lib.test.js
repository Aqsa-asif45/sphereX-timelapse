import { describe, expect, it } from 'vitest'
import { viewGeometry } from '../components/explore/viewGeometry'
import { readParams, writeParams } from '../hooks/useExploreParams'
import { interleave, timeLeft } from '../hooks/useCutouts'
import { fmtSpan, groupVisits, positionAt, sizeFor } from './astro'
import { combine, level, normalize, stack } from './render'
import { panelsFor } from './scenes'

const frame = (id, mjd, det = 1) => ({ id, mjd, det, lambda_um: 1 })

describe('astro', () => {
  it('sizes the grid oddly so the target is on the centre pixel', () => {
    expect([2, 4, 6, 30].map(sizeFor)).toEqual([21, 39, 59, 293])
  })

  it("moves Barnard's Star with its proper motion", () => {
    const t = { ra: 269.4520769586187, dec: 4.6933649665767, epoch_mjd: 51544.5, pmra: -801.551, pmdec: 10362.394 }
    const [ra, dec] = positionAt(t, 61040)
    expect(ra).toBeCloseTo(269.44627, 4) // the old site's search centre
    expect(dec).toBeCloseTo(4.7682, 4)
  })

  it('groups exposures less than 30 days apart into one visit', () => {
    const v = groupVisits([frame('a', 60900), frame('b', 60905), frame('c', 61080), frame('d', 61083)])
    expect(v.map((x) => x.frames.map((f) => f.id))).toEqual([['a', 'b'], ['c', 'd']])
    expect(v[0].mjd).toBe(60902.5)
  })

  it('writes date spans for people', () => {
    expect(fmtSpan(60902, 60902)).toBe('15 Aug 2025')
    expect(fmtSpan(60902, 60910)).toBe('15–23 Aug 2025')
  })
})

describe('render', () => {
  it('puts a frame in sigma units', () => {
    const raw = Float32Array.from({ length: 100 }, (_, i) => 10 + (i % 10))
    const { med, sig, s } = normalize(raw)
    expect(med).toBe(15)
    expect(sig).toBeCloseTo(1.4826 * 3, 5)
    expect(s[0]).toBeCloseTo((10 - 15) / sig, 5)
  })

  it('stacks with a sigma-clipped mean, drops cosmic rays and keeps blanks blank', () => {
    const frames = [1, 1.2, 0.8, 1.1, 0.9, 50].map((v) => ({ s: Float32Array.from([v, NaN]) })) // 50 = a cosmic ray
    const out = stack(frames)
    expect(out[0]).toBeCloseTo(1.0, 5)
    expect(Number.isNaN(out[1])).toBe(true)
  })

  it('skips pixels flagged bad', () => {
    const out = stack([{ s: Float32Array.from([1]), flags: Int32Array.from([1]) }, { s: Float32Array.from([3]) }])
    expect(out[0]).toBe(3)
  })

  it('a visit minus itself is exactly zero (blank stays blank)', () => {
    const a = Float32Array.from([1.5, -2, 1e6, NaN])
    const d = combine(a, a, 'sub')
    expect(Array.from(d.slice(0, 3))).toEqual([0, 0, 0])
    expect(Number.isNaN(d[3])).toBe(true)
  })

  it('maps brightness to 0..1 for every stretch', () => {
    for (const s of ['asinh', 'linear', 'log', 'sqrt']) {
      expect(level(-10, 25, s)).toBe(0)
      expect(level(1000, 25, s)).toBe(1)
      expect(level(5, 25, s)).toBeGreaterThan(level(2, 25, s))
    }
  })
})

describe('scenes', () => {
  const fs = [1, 2, 3, 4, 5, 6].map((d) => frame(`f${d}`, 60900, d))
  it('six bands -> six panels, one per detector', () => {
    const p = panelsFor({ frames: fs }, 'six')
    expect(p.map((x) => x.ids)).toEqual(fs.map((f) => [f.id]))
  })
  it('false colour -> one panel from detectors 5-6 (red), 3-4 (green), 1-2 (blue)', () => {
    expect(panelsFor({ frames: fs }, 'rgb')[0].rgbIds).toEqual([['f5', 'f6'], ['f3', 'f4'], ['f1', 'f2']])
  })
  it('a difference compares like with like (the same detectors)', () => {
    const ref = [frame('r1', 61080, 1), frame('r2', 61080, 2)]
    const p = panelsFor({ frames: [fs[0]], ref, op: 'sub' }, 'all')[0]
    expect(p).toMatchObject({ kind: 'diff', ids: ['f1'], refIds: ['r1'] })
  })
})

describe('URL state', () => {
  it('reads defaults and survives nonsense', () => {
    expect(readParams('q=Vega&fov=999&mode=x&view=y&a=-3&colours=zz&z=500')).toEqual({
      q: 'Vega', fov: 4, mode: 'time', view: 'blink', a: null, b: null, op: 'sub', colours: 'all', z: 16,
    })
  })
  it('round-trips every setting (visits are 1-based in the URL)', () => {
    const s = { q: 'R Dra', fov: 6, mode: 'time', view: 'combine', a: 2, b: 0, op: 'add', colours: 'd5', z: 2.5 }
    const p = writeParams(s)
    expect(p.toString()).toBe('q=R+Dra&fov=6&view=combine&op=add&colours=d5&a=3&b=1&z=2.5')
    expect(readParams(p.toString())).toEqual(s)
  })
  it('writes coordinates as ra/dec', () => {
    expect(writeParams({ ...readParams(''), q: '133.79 -7.24' }).toString()).toBe('ra=133.79&dec=-7.24')
  })
})

describe('loading', () => {
  it('asks for one exposure from each visit in turn', () => {
    const fs = [frame('a1', 1), frame('a2', 2), frame('a3', 3), frame('b1', 200), frame('b2', 201)]
    expect(interleave(fs).map((f) => f.id)).toEqual(['a1', 'b1', 'a2', 'b2', 'a3'])
  })
  it('estimates time left from the recent rate', () => {
    expect(timeLeft(100, [0, 1000, 2000])).toBeNaN() // not enough to go on
    expect(timeLeft(100, [0, 100, 200, 300, 400, 500])).toBeCloseTo(10) // 10 images/s
  })
})

describe('pixel-exact viewer', () => {
  it.each([1, 1.25, 1.5, 2])('every SPHEREx pixel is a whole number of device pixels at %fx scaling', (dpr) => {
    for (const [box, n, zoom] of [
      [[800, 520], 39, 1],
      [[1013, 611], 59, 2.3],
      [[1440, 700], 19, 16],
    ]) {
      const g = viewGeometry({ box, dataW: n, dataH: n, dpr, zoom, centre: null })
      expect(Number.isInteger(g.devScale)).toBe(true)
      expect(g.scale * dpr).toBeCloseTo(g.devScale, 9) // device px per SPHEREx pixel: whole
      expect(Math.abs(g.ox * dpr - Math.round(g.ox * dpr))).toBeLessThan(1e-9) // placed on a device pixel
      expect(Math.abs(g.oy * dpr - Math.round(g.oy * dpr))).toBeLessThan(1e-9)
    }
  })

  it.each([1, 1.25, 2])('a big field (30′) fills the frame instead of a small 1:1 square, at %fx scaling', (dpr) => {
    for (const box of [[1034, 528], [390, 420]]) {
      const g = viewGeometry({ box, dataW: 293, dataH: 293, dpr, zoom: 1, centre: null })
      const shown = 293 * g.scale
      // was 293 px in a 504 px frame (58 %); whole-pixel scaling from 3 device px up may still leave up to 1/4 free
      expect(shown).toBeGreaterThan(0.75 * (Math.min(box[0], box[1]) - 24))
      expect(shown).toBeLessThanOrEqual(Math.min(box[0], box[1]) - 24 + 1e-9) // and never overflows
    }
  })
})

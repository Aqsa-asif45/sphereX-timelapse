import { beforeEach, describe, expect, it } from 'vitest'
import { hitTest, sceneSize } from '../components/explore/viewGeometry'
import { useActivity } from '../store/activityStore'
import { fmtDec, fmtRa, gridToSky, positionAt } from './astro'
import { badFraction, differenceOf, flagName, isBadBit, readPixel, skyToGrid, starAt } from './overlays'

const BARNARD = { ra: 269.4520769586187, dec: 4.6933649665767, epoch_mjd: 51544.5, pmra: -801.551, pmdec: 10362.394 }

describe('overlay positions', () => {
  it('moves a catalogue star by its proper motion exactly like the target', () => {
    for (const mjd of [57388.5, 60902.1, 61300]) {
      expect(starAt(BARNARD, BARNARD.epoch_mjd, mjd)).toEqual(positionAt(BARNARD, mjd))
    }
    expect(starAt({ ra: 10, dec: 20, pmra: null, pmdec: null }, 57388.5, 61000)).toEqual([10, 20])
  })

  it('puts the grid centre on the centre of the middle pixel, north up and east left', () => {
    const c = [269.44627, 4.7682]
    expect(skyToGrid(c, 39, ...c)).toEqual([19.5, 19.5])
    const [, yN] = skyToGrid(c, 39, c[0], c[1] + 6.15 / 3600) // one pixel north
    expect(yN).toBeCloseTo(18.5, 6)
    const [xE] = skyToGrid(c, 39, c[0] + 6.15 / 3600 / Math.cos((c[1] * Math.PI) / 180), c[1]) // one pixel east
    expect(xE).toBeCloseTo(18.5, 4)
  })

  it('round-trips with the hover read-out position', () => {
    const c = [133.795, -7.245]
    const [ra, dec] = gridToSky(c[0], c[1], 7 - 19, 30 - 19)
    const [x, y] = skyToGrid(c, 39, ra, dec)
    // the read-out uses the exact tangent plane, overlays the old site's flat offset: < 0.002 px apart here
    expect(Math.abs(x - 7.5)).toBeLessThan(0.002)
    expect(Math.abs(y - 30.5)).toBeLessThan(0.002)
  })

  it('Barnard’s Star moves north by about 1.7 SPHEREx pixels a year', () => {
    const c = positionAt(BARNARD, 61040)
    const a = skyToGrid(c, 39, ...positionAt(BARNARD, 61040 - 365.25 / 2))
    const b = skyToGrid(c, 39, ...positionAt(BARNARD, 61040 + 365.25 / 2))
    expect(a[1] - b[1]).toBeCloseTo(10.39 / 6.15, 2)
  })
})

const img = (vals) => Float32Array.from(vals)
const flags = (vals) => Int32Array.from(vals)

describe('bad pixels and the read-out', () => {
  const images = new Map([
    ['a', { image: img([1, 2, NaN, 4]), variance: img([0.04, 0.09, NaN, 0.01]), flags: flags([0, 1, 1 << 21, -1]) }],
    ['b', { image: img([3, 4, 5, 6]), variance: img([0.04, 0.16, 0.25, 0.01]), flags: flags([1 << 10, 0, 0, -1]) }],
    ['c', { image: img([5, 6, 7, 8]) }], // no flags, no variance loaded
  ])

  it('counts only "do not trust" bits, and only exposures with flag information', () => {
    expect(badFraction(images, ['a', 'b'])).toEqual(img([0.5, 0.5, 0, 0])) // bit 21 (SOURCE) is information only; -1 = no info
    expect(badFraction(images, ['c'])).toBeNull()
    expect(isBadBit(0) && isBadBit(10) && !isBadBit(21) && !isBadBit(12)).toBe(true)
  })

  it('gives the mean, its noise from VARIANCE, and the flags at a pixel', () => {
    const r = readPixel(images, ['a', 'b'], 1)
    expect(r.mean).toBe(3)
    expect(r.noise).toBeCloseTo(Math.sqrt(0.09 + 0.16) / 2, 6)
    expect(r.flags).toEqual([[0, 1]])
    expect(r.withFlags).toBe(2)
    const blank = readPixel(images, ['a'], 2) // blank pixel: no value, flags still read
    expect(blank.used).toBe(0)
    expect(blank.mean).toBeNaN()
    expect(blank.flags).toEqual([[21, 1]])
    expect(readPixel(images, ['a', 'b'], 3).withFlags).toBe(0) // -1 everywhere: no flag information
    expect(readPixel(images, ['a', 'c'], 0).noise).toBeNaN() // one value has no variance: noise not claimed
  })

  it('adds noise in quadrature for a difference', () => {
    const d = differenceOf(readPixel(images, ['b'], 0), readPixel(images, ['a'], 0))
    expect(d.mean).toBe(2)
    expect(d.noise).toBeCloseTo(Math.hypot(0.2, 0.2), 6)
  })

  it('names bits with the files’ own names', () => {
    expect(flagName(21, { dr1: { 21: 'SOURCE' }, qr3: { 21: 'SOURCE' } })).toBe('SOURCE')
    expect(flagName(7, { dr1: { 7: 'DICHROIC' }, qr2: { 7: 'LOWQE' } })).toBe('DICHROIC / LOWQE')
    expect(flagName(30, { dr1: {} })).toBe('bit 30')
  })
})

describe('hit test', () => {
  const g = { ox: 10, oy: 20, scale: 4 }
  it('finds the pixel under the pointer', () => {
    expect(hitTest(10 + 4 * 5.5, 20 + 4 * 7.2, g, [sceneSize(1, 39)], 39)).toEqual({ scene: 0, panel: 0, gx: 5, gy: 7 })
    expect(hitTest(5, 20, g, [sceneSize(1, 39)], 39)).toBeNull()
  })
  it('knows the six-band panels and side-by-side scenes', () => {
    const six = sceneSize(6, 39) // 3 x 2 panels with 3-pixel gaps
    expect(hitTest(10 + 4 * (42 + 1.5), 20 + 4 * (42 + 2.5), g, [six], 39)).toEqual({ scene: 0, panel: 4, gx: 1, gy: 2 })
    expect(hitTest(10 + 4 * 40, 20 + 4, g, [six], 39)).toBeNull() // in the gap
    const one = sceneSize(1, 39)
    expect(hitTest(10 + 4 * (39 + 4 + 0.5), 20 + 2, g, [one, one], 39)).toEqual({ scene: 1, panel: 0, gx: 0, gy: 0 })
  })
})

describe('positions for people', () => {
  it('matches Astropy’s sexagesimal', () => {
    expect(fmtRa(269.4520769586187)).toBe('17h 57m 48.50s')
    expect(fmtDec(4.6933649665767)).toBe('+04° 41′ 36.1″')
    expect(fmtRa(133.795)).toBe('08h 55m 10.80s')
    expect(fmtDec(-7.245)).toBe('−07° 14′ 42.0″')
    expect(fmtRa(359.99999)).toBe('00h 00m 00.00s')
  })
})

describe('activity log', () => {
  beforeEach(() => useActivity.setState({ view: '', entries: [] }))
  it('drops a late line for a view the user has left', () => {
    const { begin, log } = useActivity.getState()
    expect(begin('barnard|4')).toBe(true)
    log('barnard|4', 'Gaia asked')
    expect(begin('barnard|4')).toBe(false) // same view: keeps its log
    begin('wise0855|4')
    log('barnard|4', 'Gaia: 394 stars') // a slow answer for the old target
    log('wise0855|4', 'Looking up')
    expect(useActivity.getState().entries.map((e) => e.text)).toEqual(['Looking up'])
  })
})

import { describe, expect, it } from 'vitest'
import { GAP, LUT, paintHeat, saturatedCores } from './render'

const N = 7
const sky = () => new Float32Array(N * N).fill(0)

describe('saturated star cores', () => {
  it('marks blank pixels surrounded by bright ones, not blanks in ordinary sky', () => {
    const d = sky()
    for (let j = 2; j <= 4; j++) for (let i = 2; i <= 4; i++) d[j * N + i] = 5000 // a bright star
    d[3 * N + 3] = NaN // its core: blanked by NASA (saturated)
    d[0 * N + 6] = NaN // a dead pixel in empty sky
    const sat = saturatedCores(d, N, (v) => v > 100)
    expect(sat[3 * N + 3]).toBe(1)
    expect(sat[0 * N + 6]).toBe(0)
  })

  it('fills a core several pixels wide, from the edge inwards', () => {
    const d = sky()
    for (let j = 1; j <= 5; j++) for (let i = 1; i <= 5; i++) d[j * N + i] = 5000
    for (let j = 2; j <= 4; j++) for (let i = 2; i <= 4; i++) d[j * N + i] = NaN
    const sat = saturatedCores(d, N, (v) => v > 100)
    for (let j = 2; j <= 4; j++) for (let i = 2; i <= 4; i++) expect(sat[j * N + i]).toBe(1)
  })

  it('draws a saturated core in the brightest colour and other blanks in the gap colour; data unchanged', () => {
    const d = sky()
    for (let j = 2; j <= 4; j++) for (let i = 2; i <= 4; i++) d[j * N + i] = 5000
    d[3 * N + 3] = NaN
    d[0] = NaN
    const px = new Uint8ClampedArray(N * N * 4)
    paintHeat(px, 0, d, N, N, 25, 'asinh')
    const at = (k) => [...px.slice(k * 4, k * 4 + 3)]
    expect(at(3 * N + 3)).toEqual([LUT[765], LUT[766], LUT[767]])
    expect(at(0)).toEqual(GAP)
    expect(Number.isNaN(d[3 * N + 3])).toBe(true)
  })
})

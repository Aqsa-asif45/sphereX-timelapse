import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, readRecords, resolve, splitCutout } from './api'
import { load, save } from './storage'

afterEach(() => vi.unstubAllGlobals())

describe('storage', () => {
  it('saves and loads', () => {
    expect(save('t.x', { a: 1 })).toBe(true)
    expect(load('t.x', null)).toEqual({ a: 1 })
    expect(load('t.missing', 'fallback')).toBe('fallback')
  })

  it('keeps working when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(load('t.x', 'fallback')).toBe('fallback')
    expect(save('t.x', 1)).toBe(false)
    vi.restoreAllMocks()
  })
})

describe('api', () => {
  it("passes on the server's own error message", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ detail: 'No object called "zz" was found.' }),
        }),
      ),
    )
    await expect(resolve('zz')).rejects.toEqual(
      new ApiError(404, 'No object called "zz" was found.'),
    )
  })

  it('says plainly when the server cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
    await expect(resolve('Vega')).rejects.toMatchObject({
      status: 0,
      message: expect.stringMatching(/Cannot reach/),
    })
  })

  it('splits a cutout payload into image, flags and variance', () => {
    const n = 2
    const buf = new ArrayBuffer(n * n * 12)
    new Float32Array(buf, 0, 4).set([1, NaN, 3, 4])
    new Int32Array(buf, 16, 4).set([0, -1, 2097152, 0])
    new Float32Array(buf, 32, 4).set([0.5, 0.5, 0.5, 0.5])
    const c = splitCutout(buf, n, { flags: true, variance: true })
    expect(Array.from(c.image)).toEqual([1, NaN, 3, 4])
    expect(Array.from(c.flags)).toEqual([0, -1, 2097152, 0])
    expect(Array.from(c.variance)).toEqual([0.5, 0.5, 0.5, 0.5])
  })

  it('reads batch records even when they arrive split across chunks', async () => {
    const rec = (id, status, values) => {
      const idb = new TextEncoder().encode(id)
      const payload = values ? new Uint8Array(new Float32Array(values).buffer) : new Uint8Array(0)
      const out = new Uint8Array(7 + idb.length + payload.length)
      const v = new DataView(out.buffer)
      v.setUint16(0, idb.length, true)
      v.setUint8(2, status)
      v.setUint32(3, payload.length, true)
      out.set(idb, 7)
      out.set(payload, 7 + idb.length)
      return out
    }
    const all = new Uint8Array([
      ...rec('a.fits', 0, [1, 2, 3, 4]),
      ...rec('bad.fits', 1),
      ...rec('b.fits', 0, [5, 6, 7, 8]),
    ])
    const chunks = [all.slice(0, 5), all.slice(5, 30), all.slice(30)] // cut in awkward places
    const reader = {
      read: vi.fn(async () =>
        chunks.length ? { value: chunks.shift(), done: false } : { done: true },
      ),
    }
    const got = {}
    const summary = await readRecords(
      reader,
      { n: 2 },
      (id, c) => (got[id] = c && Array.from(c.image)),
    )
    expect(summary).toEqual({ ok: 2, failed: 1 })
    expect(got).toEqual({ 'a.fits': [1, 2, 3, 4], 'bad.fits': null, 'b.fits': [5, 6, 7, 8] })
  })
})

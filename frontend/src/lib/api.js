/**
 * Every backend endpoint, in one place. The backend is FastAPI on port 8000; in development Vite
 * forwards /api to it. Errors become ApiError with the server's own message ("detail").
 */

export class ApiError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request(path, { params, signal, method = 'GET', body } = {}) {
  const qs = params ? '?' + new URLSearchParams(clean(params)) : ''
  let r
  try {
    r = await fetch(`/api${path}${qs}`, {
      method,
      signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (e) {
    if (e.name === 'AbortError') throw e
    throw new ApiError(0, 'Cannot reach the TimeLens server. Is it running?')
  }
  if (!r.ok) {
    const j = await r.json().catch(() => ({}))
    const detail = typeof j.detail === 'string' ? j.detail : `Request failed (HTTP ${r.status})`
    throw new ApiError(r.status, detail)
  }
  return r
}

/** Drop empty values so they are not sent as "undefined". */
function clean(params) {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  )
}

const json = (path, opts) => request(path, opts).then((r) => r.json())

export const health = (signal) => json('/health', { signal })
/** { version, irsa, coverage: {weeks, indexed_weeks, observations}, net } */
export const status = (signal) => json('/status', { signal })
export const targets = (signal) => json('/targets', { signal })
/** Name or coordinates -> { name, ra, dec, epoch_mjd, pmra, pmdec, kind, source, ... } */
export const resolve = (q, signal) => json('/resolve', { params: { q }, signal })
/** { ra, dec, epoch_mjd?, pmra?, pmdec? } -> the full search result */
export const observations = (params, signal) => json('/observations', { params, signal })
/** { cat: 'gaia'|'wise', ra, dec, r } -> { rows, epoch_mjd, band, source } */
export const catalog = (cat, params, signal) => json(`/catalogs/${cat}`, { params, signal })
/** { id, x, y, r } -> raw detector values (for data checks) */
export const pixels = (params, signal) => json('/pixels', { params, signal })
/** id -> { names: {bit: name}, compressed }: the flag bit names written in that file */
export const flagNames = (id, signal) => json('/flags', { params: { id }, signal })
export const previewUrl = (slug) => `/api/previews/${encodeURIComponent(slug)}.gif`

/**
 * The same search as a live stream (Server-Sent Events): onEvent gets started, collection, fallback,
 * progress; the promise resolves with the result. Aborting the signal closes the stream.
 */
export function streamObservations(params, onEvent, signal) {
  return new Promise((resolve, reject) => {
    const es = new EventSource(`/api/observations/stream?${new URLSearchParams(clean(params))}`)
    const stop = () => {
      es.close()
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      stop()
      reject(new DOMException('Search cancelled', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort)
    for (const t of ['started', 'collection', 'fallback', 'progress']) {
      es.addEventListener(t, (m) => onEvent?.(JSON.parse(m.data)))
    }
    es.addEventListener('result', (m) => {
      stop()
      resolve(JSON.parse(m.data).result)
    })
    es.addEventListener('error', (m) => {
      stop()
      const msg = m.data ? JSON.parse(m.data).error : 'The search connection dropped.'
      reject(new ApiError(0, msg))
    })
  })
}

/**
 * Split one cutout payload into its layers (little-endian): n*n float32 image, then int32 flags and
 * float32 variance when asked for. Blank pixels are NaN; a flag of -1 means "no flag information".
 */
export function splitCutout(buffer, n, { flags = false, variance = false } = {}) {
  const px = n * n
  const out = { n, image: new Float32Array(buffer.slice(0, px * 4)) }
  let at = px * 4
  if (flags) {
    out.flags = new Int32Array(buffer.slice(at, at + px * 4))
    at += px * 4
  }
  if (variance) out.variance = new Float32Array(buffer.slice(at, at + px * 4))
  return out
}

/** One cutout: { id, ra, dec, n, scale?, flags?, variance? } -> { n, image, flags?, variance? } */
export async function cutout(params, signal) {
  const r = await request('/cutouts/one', { params, signal })
  return splitCutout(await r.arrayBuffer(), params.n, params)
}

/**
 * Many cutouts in one streamed request. onCutout(id, cutout | null) is called as each one arrives
 * (null = that image failed). Record format: u16 id length | u8 status | u32 payload length | id | payload.
 * @returns {Promise<{ok: number, failed: number}>}
 */
export async function cutoutBatch(body, onCutout, signal) {
  const r = await request('/cutouts/batch', { method: 'POST', body, signal })
  return readRecords(r.body.getReader(), body, onCutout)
}

/** Parse the batch stream (exported for tests). */
export async function readRecords(reader, opts, onCutout) {
  const dec = new TextDecoder()
  let buf = new Uint8Array(0)
  let ok = 0
  let failed = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (value) {
      const next = new Uint8Array(buf.length + value.length)
      next.set(buf)
      next.set(value, buf.length)
      buf = next
    }
    let off = 0
    while (buf.length - off >= 7) {
      const view = new DataView(buf.buffer, buf.byteOffset + off, 7)
      const idLen = view.getUint16(0, true)
      const status = view.getUint8(2)
      const size = view.getUint32(3, true)
      if (buf.length - off < 7 + idLen + size) break // wait for the rest of this record
      const id = dec.decode(buf.subarray(off + 7, off + 7 + idLen))
      if (status === 0) {
        const payload = buf.slice(off + 7 + idLen, off + 7 + idLen + size).buffer
        onCutout(id, splitCutout(payload, opts.n, opts))
        ok++
      } else {
        onCutout(id, null)
        failed++
      }
      off += 7 + idLen + size
    }
    buf = buf.slice(off)
    if (done) return { ok, failed }
  }
}

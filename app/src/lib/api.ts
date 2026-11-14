import type { Cutout, CutoutResponse, Observation, Resolved, SearchResult, Target } from './types';

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { signal });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof body.detail === 'string' ? body.detail : `Request failed (HTTP ${r.status})`);
  return body as T;
}

export const getTargets = (signal?: AbortSignal) => getJson<Target[]>('/api/v2/targets', signal);
export const resolve = (q: string, signal?: AbortSignal) => getJson<Resolved>(`/api/v2/resolve?q=${encodeURIComponent(q)}`, signal);

export interface SearchProgress {
  type: string;
  collection?: string;
  count?: number;
  error?: string;
  adapter?: string;
  reason?: string;
  /** COLLECTION_DONE: that collection's exposures, sent as soon as it answers */
  observations?: Observation[];
}

/** Observation search over Server-Sent Events: progress events, then the result. Aborting closes the stream. */
export function searchObservations(ra: number, dec: number, onProgress: (p: SearchProgress) => void, signal?: AbortSignal): Promise<SearchResult> {
  return new Promise((resolve, reject) => {
    const es = new EventSource(`/api/v2/observations/stream?ra=${ra.toFixed(7)}&dec=${dec.toFixed(7)}`);
    const done = () => { es.close(); signal?.removeEventListener('abort', onAbort); };
    const onAbort = () => { done(); reject(new DOMException('Search cancelled', 'AbortError')); };
    signal?.addEventListener('abort', onAbort);
    for (const t of ['SEARCH_STARTED', 'COLLECTION_DONE', 'COLLECTION_FAILED', 'FALLBACK', 'OBSERVATIONS_FOUND']) {
      es.addEventListener(t, (m) => onProgress(JSON.parse((m as MessageEvent).data)));
    }
    es.addEventListener('RESULT', (m) => { done(); resolve(JSON.parse((m as MessageEvent).data).result); });
    es.addEventListener('SEARCH_FAILED', (m) => {
      const e = JSON.parse((m as MessageEvent).data);
      if (e.error) { done(); reject(new Error(e.error)); } else onProgress(e); // no-results notice: the result follows
    });
    es.onerror = () => { done(); reject(new Error('The search connection dropped. Check that the backend is running.')); };
  });
}

function decode(b64: string): ArrayBuffer {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u.buffer;
}

export async function getCutout(url: string, ra: number, dec: number, size: number, signal?: AbortSignal): Promise<Cutout> {
  const q = new URLSearchParams({ url, ra: ra.toFixed(7), dec: dec.toFixed(7), size: String(size) });
  const r = await getJson<CutoutResponse>(`/api/v2/cutout?${q}`, signal);
  const [ny, nx] = r.shape;
  const { image_b64, flags_b64, variance_b64, ...rest } = r;
  return {
    ...rest, nx, ny,
    image: new Float32Array(decode(image_b64)),
    flagsArr: new Int32Array(decode(flags_b64)),
    variance: variance_b64 ? new Float32Array(decode(variance_b64)) : null,
  };
}

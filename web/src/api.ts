export interface Target {
  name: string; ra: number; dec: number; epoch: number;
  pmra?: number; pmdec?: number; kind?: string; source: string; note?: string;
}
export interface Frame {
  id: string; key: string; release: string; folder: string; version: string;
  obs: number; exp: number; det: number; mjd: number;
  x: number; y: number; lambda: number; dlambda: number; north: number;
}
export interface Featured { slug: string; name: string; kind: string; blurb: string; note?: string }
export interface FindResult { frames: Frame[]; source: 'irsa' | 'index'; indexed: number; folders: number; stamp: string; observations: { available: number; checked: number }; failed: number }
export interface FindProgress { stage: string; done: number; total: number; frames: number }
export interface Status { irsa: boolean; coverage: { folders: number; indexed: number; observations: number } }

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { signal });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j as T;
}

export const featured = () => getJson<Featured[]>('/api/featured');
export const status = () => getJson<Status>('/api/status');
export const resolveTarget = (q: string, signal?: AbortSignal) => getJson<Target>(`/api/resolve?q=${encodeURIComponent(q)}`, signal);

/** Stream the frame search: progress lines, then the result. */
export async function findFrames(ra: number, dec: number, onProgress: (p: FindProgress) => void, signal?: AbortSignal): Promise<FindResult> {
  const r = await fetch(`/api/frames?ra=${ra.toFixed(6)}&dec=${dec.toFixed(6)}`, { signal });
  if (!r.ok || !r.body) throw new Error(`Search failed (${r.status})`);
  const reader = r.body.getReader(), dec8 = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec8.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      const m = JSON.parse(line);
      if (m.type === 'progress') onProgress(m);
      else if (m.type === 'result') return m;
      else if (m.type === 'error') throw new Error(m.error);
    }
    if (done) throw new Error('Search ended unexpectedly.');
  }
}

export interface CatResult { cat: 'gaia' | 'wise'; epoch: number; band: string; source: string; rows: Array<{ ra: number; dec: number; mag: number; pmra?: number; pmdec?: number }> }
export const catalog = (cat: 'gaia' | 'wise', ra: number, dec: number, r: number) =>
  getJson<CatResult>(`/api/catalog?cat=${cat}&ra=${ra.toFixed(6)}&dec=${dec.toFixed(6)}&r=${r.toFixed(5)}`);

export async function cutout(id: string, ra: number, dec: number, n: number, scaleArcsec: number, withFlags: boolean, signal?: AbortSignal) {
  const u = `/api/cutout?id=${encodeURIComponent(id)}&ra=${ra.toFixed(6)}&dec=${dec.toFixed(6)}&n=${n}&s=${scaleArcsec}&flags=${withFlags ? 1 : 0}`;
  const r = await fetch(u, { signal });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Image failed (${r.status})`);
  const b = await r.arrayBuffer();
  return { img: new Float32Array(b, 0, n * n), flags: withFlags ? new Int32Array(b, n * n * 4, n * n) : undefined };
}

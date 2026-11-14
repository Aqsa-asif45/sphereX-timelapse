/**
 * Loads every exposure's cutout for one view (target × field size) and keeps raw + normalized
 * data, like the original app's useFrames, but asks the server for all of them in ONE streamed
 * request (POST /api/cutouts). A browser opens at most six connections to one server, so one
 * request per image left the server mostly idle; the batch lets it work on 32 at once.
 * Falls back to one request per image if the batch endpoint is missing or the stream breaks.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import * as api from '../../web/src/api';
import type { FindResult, Frame } from '../../web/src/api';
import { groupVisits, PIXEL_ARCSEC } from '../../web/src/astro';
import type { FrameStore } from '../../web/src/data';
import { normalize, type FrameData } from '../../web/src/render';

export interface Store extends FrameStore {
  total: number;
  /** quality-flag loads that failed (the image itself is there) */
  flagsFailed: number;
  /** fetch again the images that failed, keeping the ones already here */
  retry: () => void;
}

/** seconds left from the recent completion rate (NaN until there is enough to go on) */
const etaOf = (left: number, ts: number[]) => (ts.length >= 6 && left > 0 ? (left * (ts[ts.length - 1] - ts[0])) / (ts.length - 1) / 1000 : NaN);
const note = (ts: number[]) => { ts.push(performance.now()); if (ts.length > 40) ts.shift(); };

/** One exposure from each visit in turn, so every visit gets images early. */
function interleave(frames: Frame[]): Frame[] {
  const vs = groupVisits(frames), out: Frame[] = [];
  for (let k = 0; out.length < frames.length; k++) for (const v of vs) if (v.frames[k]) out.push(v.frames[k]);
  return out;
}

type Got = (id: string, img: Float32Array | null, flags?: Int32Array) => void;

/** Stream many cutouts; returns false when the server has no batch endpoint. */
async function batch(ids: string[], center: [number, number], n: number, flags: boolean, signal: AbortSignal, got: Got): Promise<boolean> {
  const r = await fetch('/api/cutouts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ ids, ra: +center[0].toFixed(6), dec: +center[1].toFixed(6), n, s: PIXEL_ARCSEC, flags }),
  });
  if (r.status === 404 || r.status === 405) return false;
  if (!r.ok || !r.body) throw new Error(`Images failed (${r.status})`);
  const reader = r.body.getReader(), px = n * n, td = new TextDecoder();
  let buf = new Uint8Array(0);
  for (;;) {
    const { value, done } = await reader.read();
    if (value) { const nb = new Uint8Array(buf.length + value.length); nb.set(buf); nb.set(value, buf.length); buf = nb; }
    let off = 0;
    while (buf.length - off >= 7) {
      const dv = new DataView(buf.buffer, buf.byteOffset + off, 7);
      const idLen = dv.getUint16(0, true), status = dv.getUint8(2), len = dv.getUint32(3, true);
      if (buf.length - off < 7 + idLen + len) break;
      const id = td.decode(buf.subarray(off + 7, off + 7 + idLen));
      if (status === 0 && len >= px * 4) {
        const body = buf.slice(off + 7 + idLen, off + 7 + idLen + len); // a copy, so the typed arrays are aligned
        got(id, new Float32Array(body.buffer, 0, px), flags && len >= px * 8 ? new Int32Array(body.buffer, px * 4, px) : undefined);
      } else got(id, null);
      off += 7 + idLen + len;
    }
    if (off) buf = buf.slice(off);
    if (done) return true;
  }
}

/** One request per image, six at a time (the browser's limit). */
async function oneByOne(frames: Frame[], center: [number, number], n: number, flags: boolean, signal: AbortSignal, got: Got) {
  let i = 0;
  const worker = async () => {
    while (i < frames.length && !signal.aborted) {
      const f = frames[i++];
      try { const c = await api.cutout(f.id, center[0], center[1], n, PIXEL_ARCSEC, flags, signal); got(f.id, c.img, c.flags); }
      catch { if (!signal.aborted) got(f.id, null); }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
}

async function loadAll(frames: Frame[], center: [number, number], n: number, flags: boolean, signal: AbortSignal, got: Got, done: Set<string>) {
  try {
    if (await batch(frames.map((f) => f.id), center, n, flags, signal, got)) {
      const rest = frames.filter((f) => !done.has(f.id));
      if (rest.length && !signal.aborted) await oneByOne(rest, center, n, flags, signal, got); // stream ended early
      return;
    }
  } catch { if (signal.aborted) return; /* stream broke: fetch what is missing one by one */ }
  await oneByOne(frames.filter((f) => !done.has(f.id)), center, n, flags, signal, got);
}

export function useStore(result: FindResult | null, center: [number, number] | null, n: number, wantFlags: boolean): Store {
  const map = useRef(new Map<string, FrameData>());
  const [tick, setTick] = useState({ loaded: 0, failed: 0, flagsLoaded: 0, flagsFailed: 0, version: 0, eta: NaN, flagsEta: NaN });
  const counts = useRef({ loaded: 0, failed: 0, flagsLoaded: 0, flagsFailed: 0 });
  const times = useRef({ img: [] as number[], flags: [] as number[] });
  const total = result?.frames.length ?? 0;
  const totalRef = useRef(0);
  const pending = useRef(false);
  /** images that failed in this view, and the current view's abort controller (a retry shares it) */
  const failedIds = useRef(new Set<string>());
  const viewAc = useRef<AbortController | null>(null);
  const bump = () => {
    if (pending.current) return;
    pending.current = true;
    setTimeout(() => {
      pending.current = false;
      const c = counts.current;
      setTick((t) => ({ ...c, version: t.version + 1, eta: etaOf(totalRef.current - c.loaded - c.failed, times.current.img), flagsEta: etaOf(c.loaded - c.flagsLoaded, times.current.flags) }));
    }, 200);
  };

  /** a handler that files each arriving image (or failure) under this view */
  const imageSink = (ac: AbortController, done: Set<string>): Got => (id, img) => {
    if (ac.signal.aborted || done.has(id)) return;
    done.add(id);
    const d = img ? normalize(img) : null;
    if (d) { map.current.set(id, d); counts.current.loaded++; } else { counts.current.failed++; failedIds.current.add(id); }
    note(times.current.img);
    bump();
  };

  useEffect(() => {
    map.current = new Map();
    counts.current = { loaded: 0, failed: 0, flagsLoaded: 0, flagsFailed: 0 };
    times.current = { img: [], flags: [] };
    failedIds.current = new Set();
    viewAc.current = null;
    totalRef.current = result?.frames.length ?? 0;
    setTick({ loaded: 0, failed: 0, flagsLoaded: 0, flagsFailed: 0, version: 0, eta: NaN, flagsEta: NaN });
    if (!result || !center || !result.frames.length) return;
    const ac = new AbortController(), done = new Set<string>();
    viewAc.current = ac;
    loadAll(interleave(result.frames), center, n, false, ac.signal, imageSink(ac, done), done);
    return () => ac.abort();
  }, [result, center?.[0], center?.[1], n]);

  const retry = () => {
    const ac = viewAc.current;
    if (!result || !center || !ac || ac.signal.aborted || !failedIds.current.size) return;
    const again = failedIds.current, todo = result.frames.filter((f) => again.has(f.id));
    failedIds.current = new Set();
    counts.current.failed -= todo.length;
    times.current.img = [];
    bump();
    const done = new Set<string>();
    loadAll(todo, center, n, false, ac.signal, imageSink(ac, done), done);
  };

  // data-quality flags: a second pass, only when asked for, only for images already here
  const allIn = tick.loaded + tick.failed >= total;
  useEffect(() => {
    if (!wantFlags || !result || !center) return;
    const todo = interleave(result.frames).filter((f) => { const d = map.current.get(f.id); return d && !d.flags; });
    counts.current.flagsFailed = 0; // this pass retries the ones that failed before
    bump();
    if (!todo.length) return;
    const ac = new AbortController(), done = new Set<string>();
    const got: Got = (id, _img, flags) => {
      if (ac.signal.aborted || done.has(id)) return;
      done.add(id);
      const d = map.current.get(id);
      if (d && flags) { d.flags = flags; counts.current.flagsLoaded++; } else counts.current.flagsFailed++;
      note(times.current.flags);
      bump();
    };
    loadAll(todo, center, n, true, ac.signal, got, done);
    return () => ac.abort();
  }, [wantFlags, result, center?.[0], center?.[1], n, allIn]);

  return { get: (id) => map.current.get(id), total, retry, ...tick };
}

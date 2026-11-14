/** Loads every frame's cutout once per (target, field size), keeps raw + normalized data, and
 *  fetches data-quality flags on demand. Visits are interleaved so each gets images early. */
import { useEffect, useRef, useState } from 'preact/hooks';
import * as api from './api';
import type { FindResult, Frame } from './api';
import { groupVisits, PIXEL_ARCSEC } from './astro';
import { normalize, type FrameData } from './render';

export interface FrameStore {
  get: (id: string) => FrameData | undefined; loaded: number; failed: number; flagsLoaded: number; version: number;
  /** seconds until all images / all flags are in, from the recent loading rate (NaN = not known yet) */
  eta: number; flagsEta: number;
}

/** Time left from the completion times of the last few loads (several load at once, so use throughput). */
const etaOf = (left: number, ts: number[]) => (ts.length >= 6 && left > 0 ? (left * (ts[ts.length - 1] - ts[0])) / (ts.length - 1) / 1000 : NaN);
const note = (ts: number[]) => { ts.push(performance.now()); if (ts.length > 30) ts.shift(); };

const CONCURRENCY = 6;

export function useFrames(result: FindResult | null, center: [number, number] | null, n: number, wantFlags: boolean): FrameStore {
  const map = useRef(new Map<string, FrameData>());
  const [tick, setTick] = useState({ loaded: 0, failed: 0, flagsLoaded: 0, version: 0, eta: NaN, flagsEta: NaN });
  const counts = useRef({ loaded: 0, failed: 0, flagsLoaded: 0 });
  const times = useRef({ img: [] as number[], flags: [] as number[] });
  const total = useRef(0);
  const pending = useRef(false);
  const bump = () => {
    if (pending.current) return;
    pending.current = true;
    setTimeout(() => {
      pending.current = false;
      const c = counts.current;
      setTick((t) => ({ ...c, version: t.version + 1, eta: etaOf(total.current - c.loaded - c.failed, times.current.img), flagsEta: etaOf(c.loaded - c.flagsLoaded, times.current.flags) }));
    }, 200);
  };

  // order: one frame from each visit in turn
  const order = (frames: Frame[]) => {
    const vs = groupVisits(frames), out: Frame[] = [];
    for (let k = 0; out.length < frames.length; k++) for (const v of vs) if (v.frames[k]) out.push(v.frames[k]);
    return out;
  };

  useEffect(() => {
    map.current = new Map();
    counts.current = { loaded: 0, failed: 0, flagsLoaded: 0 };
    times.current = { img: [], flags: [] };
    total.current = result?.frames.length ?? 0;
    setTick({ loaded: 0, failed: 0, flagsLoaded: 0, version: 0, eta: NaN, flagsEta: NaN });
    if (!result || !center) return;
    const ac = new AbortController(), q = order(result.frames);
    let i = 0;
    const worker = async () => {
      while (i < q.length && !ac.signal.aborted) {
        const f = q[i++];
        try {
          const c = await api.cutout(f.id, center[0], center[1], n, PIXEL_ARCSEC, false, ac.signal);
          const d = normalize(c.img);
          if (d) { map.current.set(f.id, d); counts.current.loaded++; } else counts.current.failed++;
        } catch { if (!ac.signal.aborted) counts.current.failed++; }
        note(times.current.img);
        bump();
      }
    };
    Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return () => ac.abort();
  }, [result, center?.[0], center?.[1], n]);

  // flags: a second pass, only when the overlay is switched on
  useEffect(() => {
    if (!wantFlags || !result || !center) return;
    // only frames whose image is here (flags for the rest would be dropped); this runs again once all images are in
    const ac = new AbortController(), q = order(result.frames).filter((f) => { const d = map.current.get(f.id); return d && !d.flags; });
    let i = 0;
    const worker = async () => {
      while (i < q.length && !ac.signal.aborted) {
        const f = q[i++];
        try {
          const c = await api.cutout(f.id, center[0], center[1], n, PIXEL_ARCSEC, true, ac.signal);
          const d = map.current.get(f.id);
          if (d && c.flags) { d.flags = c.flags; counts.current.flagsLoaded++; }
        } catch { /* leave this frame without flags */ }
        note(times.current.flags);
        bump();
      }
    };
    Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return () => ac.abort();
  }, [wantFlags, result, center?.[0], center?.[1], n, tick.loaded === result?.frames.length]);

  return { get: (id) => map.current.get(id), ...tick };
}

/**
 * The time ruler. SPHEREx visits a spot for days to weeks, then not for about six months, so a
 * linear time axis would be mostly empty. Each visit gets its own block (true time inside it)
 * and the long gaps are drawn as breaks labelled with their real length. Ticks are single
 * exposures, coloured by the wavelength they measured at the target.
 */
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Frame } from '../../web/src/api';
import { wlColor, type Visit } from '../../web/src/astro';
import { fmtGap, fmtMonth, fmtSpan, plural, type View } from './util';

interface Props {
  visits: Visit[];
  band: number;
  view: View;
  /** play: current visit · exposures: index into `exposures` */
  cur: number;
  exposures: Frame[];
  a: number; b: number;
  onVisit: (i: number) => void;
  onExposure: (k: number) => void;
}

const MIN_W = 84, PAD = 10;
/** a long gap (a new survey pass) gets a labelled break; a short one (a long pass cut into months) a thin seam */
const gapW = (days: number) => (days > 45 ? 62 : 10);

export function Timeline(p: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);
  useLayoutEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const nv = p.visits.length;
  if (!nv) return null;
  const gaps = p.visits.slice(1).map((v, i) => gapW(v.start - p.visits[i].end));
  const before = gaps.reduce((acc, g) => [...acc, acc[acc.length - 1] + g], [0]);
  const inner = Math.max(W, nv * MIN_W + before[nv - 1]);
  const cw = (inner - before[nv - 1]) / nv;
  const vx = (i: number) => i * cw + before[i];
  const within = (v: Visit, mjd: number) => PAD + (v.end - v.start < 0.01 ? (cw - 2 * PAD) / 2 : ((mjd - v.start) / (v.end - v.start)) * (cw - 2 * PAD));
  const inBand = (f: Frame) => !p.band || f.det === p.band;
  const compare = p.view === 'blink' || p.view === 'side' || p.view === 'diff';
  const curFrame = p.view === 'exposures' ? p.exposures[p.cur] : undefined;
  const curVisit = curFrame ? p.visits.findIndex((v) => curFrame.mjd >= v.start - 1e-6 && curFrame.mjd <= v.end + 1e-6) : -1;

  const click = (v: Visit, e: MouseEvent) => {
    if (p.view !== 'exposures') return p.onVisit(v.i);
    // nearest exposure (in the shown band) to the clicked time inside this visit
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const t = v.start + Math.min(1, Math.max(0, (e.clientX - r.left - PAD) / Math.max(1, cw - 2 * PAD))) * (v.end - v.start);
    let best = -1, bd = Infinity;
    p.exposures.forEach((f, k) => { if (f.mjd >= v.start - 1e-6 && f.mjd <= v.end + 1e-6 && Math.abs(f.mjd - t) < bd) { bd = Math.abs(f.mjd - t); best = k; } });
    if (best >= 0) p.onExposure(best);
  };

  return (
    <div class="tl" ref={wrap} data-tour="timeline">
      <div class="tl-track" style={{ width: `${inner}px` }}>
        {p.visits.map((v, i) => {
          const fs = v.frames.filter(inBand);
          const on = p.view === 'play' ? i === p.cur : p.view === 'exposures' ? i === curVisit : false;
          const pinA = compare && i === p.a, pinB = compare && i === p.b;
          const label = `Visit ${i + 1}, ${fmtSpan(v.start, v.end)}, ${plural(fs.length, 'exposure')}${pinA ? ', compared as A' : ''}${pinB ? ', compared as B' : ''}`;
          return (
            <>
              <button class={'tl-visit' + (on ? ' on' : '') + (pinA ? ' pin-a' : '') + (pinB ? ' pin-b' : '')} style={{ left: `${vx(i)}px`, width: `${cw}px` }}
                aria-label={label} aria-pressed={p.view === 'play' ? on : compare ? pinA || pinB : undefined} onClick={(e) => click(v, e as unknown as MouseEvent)}>
                <span class="tl-ticks" aria-hidden="true">
                  {fs.map((f) => <i style={{ left: `${within(v, f.mjd)}px`, background: wlColor(f.lambda) }} />)}
                </span>
                {(pinA || pinB) && (
                  <span class="tl-pins" aria-hidden="true">
                    {pinB && <span class="pin b">B</span>}{pinA && <span class="pin a">A</span>}
                  </span>
                )}
                <span class="tl-label"><b>Visit {i + 1}</b><span>{cw >= 112 ? fmtSpan(v.start, v.end) : fmtMonth(v.mjd)}</span></span>
              </button>
              {i < nv - 1 && gaps[i] > 20 && (
                <span class="tl-gap" style={{ left: `${vx(i) + cw}px`, width: `${gaps[i]}px` }}>
                  <svg width="14" height="18" viewBox="0 0 14 18" aria-hidden="true"><path d="M3 2 1 16M9 2 7 16" stroke="currentColor" stroke-width="1.4" fill="none" /></svg>
                  <span>{fmtGap(p.visits[i + 1].start - v.end)}</span>
                  <span class="sr-only">later</span>
                </span>
              )}
            </>
          );
        })}
        {curFrame && curVisit >= 0 && <span class="tl-knob" style={{ left: `${vx(curVisit) + within(p.visits[curVisit], curFrame.mjd)}px` }} aria-hidden="true" />}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import * as api from './api';
import type { FindProgress, FindResult, Frame, Target } from './api';
import { BANDS, fmtDate, gridOffset, gridToSky, groupVisits, PIXEL_ARCSEC, positionAt, REF_MJD, wlColor } from './astro';
import { loadCandidates, saveCandidates, type Candidate } from './candidates';
import { useFrames } from './data';
import { Details } from './Details';
import { Tour } from './Tour';
import { encodeGif, makePalette, quantize } from './gif';
import { LUT, aperture } from './render';
import { bandOf, buildPanels, drawScene, gridOf, GAP, sceneSize, visitStack, type Colours, type Item, type Overlay } from './scene';
import { compass, findMovers, type Found, type VisitImage } from './movers';

/** an auto-found object with its sky position and Gaia match (undefined = Gaia not checked, null = no match) */
export type FoundHere = Found & { ra: number; dec: number; gaia?: { pm: number; g: number; sep: number } | null; dismissed?: boolean };


export type Mode = 'visits' | 'frames' | 'combine';
export type Phase = 'idle' | 'resolving' | 'finding' | 'ready' | 'error';
export const FOVS = [2, 4, 6, 10, 15, 20, 30]; // arcmin
export const sizeFor = (fov: number) => Math.round((fov * 60) / PIXEL_ARCSEC) | 1;

export interface WsProps {
  phase: Phase; error: string; target: Target | null; result: FindResult | null; progress: FindProgress | null;
  fov: number; setFov: (n: number) => void; mode: Mode; setMode: (m: Mode) => void; colours: Colours; setColours: (c: Colours) => void;
  panel: boolean; setPanel: (b: boolean) => void; embed: boolean; retry: () => void;
}

const COLOUR_OPTIONS: Array<[Colours, string]> = [
  ['all', 'All colours combined'], ['six', 'Six bands side by side'], ['rgb', 'False colour (blue → red)'],
  ...BANDS.map((b) => [`d${b.det}` as Colours, `Only ${b.lo.toFixed(2)}–${b.hi.toFixed(2)} µm`] as [Colours, string]),
];

/** " · about 4 min left" once loading is clearly going to take a while */
const timeLeft = (s: number) => (!(s > 20) ? '' : s < 90 ? ` · about ${Math.round(s / 10) * 10} s left` : ` · about ${Math.round(s / 60)} min left`);

export function Workspace(p: WsProps) {
  const { target, result, mode, colours, fov } = p;
  const n = sizeFor(fov);
  const center = useMemo(() => (target ? positionAt(target, REF_MJD) : null), [target]);
  const [overlays, setOverlays] = useState({ ring: true, gaia: false, wise: false, bad: false });
  const store = useFrames(result, center, n, overlays.bad);
  const visits = useMemo(() => (result ? groupVisits(result.frames) : []), [result]);
  const band = bandOf(colours);
  const inBand = (f: Frame) => !band || f.det === band;
  const [cmp, setCmp] = useState({ a: 1, b: 0, op: 'sub' as 'sub' | 'add' });
  useEffect(() => { setCmp({ a: Math.max(0, visits.length - 1), b: 0, op: 'sub' }); }, [visits.length]);

  // ── what to play ──
  const items: Item[] = useMemo(() => {
    if (!result) return [];
    if (mode === 'frames') {
      const fs = result.frames.filter(inBand);
      return fs.map((f, k) => ({ key: f.id, label: `Exposure ${k + 1} of ${fs.length}`, sub: `${fmtDate(f.mjd)} · ${f.lambda.toFixed(2)} µm`, mjd: f.mjd, frames: [f], lambda: f.lambda }));
    }
    const vs = visits.map((v) => ({ v, fs: v.frames.filter(inBand) }));
    const dates = (v: (typeof visits)[number]) => (v.start === v.end ? fmtDate(v.start) : `${fmtDate(v.start)} – ${fmtDate(v.end)}`);
    if (mode === 'combine') {
      const A = vs[cmp.a], B = vs[cmp.b];
      if (!A || !B) return [];
      const month = (m: number) => new Date((m - 40587) * 864e5).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
      return [{ key: `c${cmp.a}${cmp.op}${cmp.b}`, label: `Visit ${cmp.a + 1} ${cmp.op === 'sub' ? 'minus' : 'plus'} visit ${cmp.b + 1}`, sub: `${month(A.v.mjd)} ${cmp.op === 'sub' ? 'vs' : 'and'} ${month(B.v.mjd)}`, mjd: A.v.mjd, frames: A.fs, ref: B.fs, op: cmp.op }];
    }
    return vs.filter((x) => x.fs.length).map((x) => ({ key: `v${x.v.i}`, label: `Visit ${x.v.i + 1} of ${visits.length}`, sub: dates(x.v), mjd: x.v.mjd, frames: x.fs }));
  }, [result, visits, mode, band, cmp]);

  // ── auto-find things that moved or appeared ──
  const [finds, setFinds] = useState<FoundHere[] | null>(null);
  const [pick, setPick] = useState(-1);
  const [finding, setFinding] = useState(false);
  useEffect(() => { setFinds(null); setPick(-1); }, [result, n]);
  const runFinder = async () => {
    if (!result || !center) return;
    setFinding(true);
    await new Promise((r) => setTimeout(r, 30)); // let the button repaint
    const vis = visits.map((v) => ({ i: v.i, mjd: v.mjd, frames: v.frames.filter((f) => store.get(f.id)).length, s: visitStack(store, v.frames) }))
      .filter((v): v is VisitImage => !!v.s);
    const raw = findMovers(vis, n);
    let gaia = cats.gaia ?? null;
    if (!gaia) { try { gaia = await api.catalog('gaia', center[0], center[1], (fov / 60) * 0.75); setCats((s) => ({ ...s, gaia })); } catch { /* annotate without Gaia */ } }
    const mid = (result.frames[0].mjd + result.frames[result.frames.length - 1].mjd) / 2, c0g = (n - 1) / 2, D = Math.PI / 180;
    setFinds(raw.map((f) => {
      const [ra, dec] = gridToSky(center[0], center[1], (f.x0 + f.x1) / 2 - c0g, (f.y0 + f.y1) / 2 - c0g, PIXEL_ARCSEC);
      let best: FoundHere['gaia'] = gaia ? null : undefined, bd = 15;
      for (const g of gaia?.rows ?? []) {
        const yrs = (mid - gaia!.epoch) / 365.25, gr = g.ra + ((g.pmra ?? 0) * yrs) / 3.6e6 / Math.cos(g.dec * D), gd = g.dec + ((g.pmdec ?? 0) * yrs) / 3.6e6;
        const d = Math.hypot((gr - ra) * Math.cos(dec * D), gd - dec) * 3600;
        if (d < bd) { bd = d; best = { pm: Math.hypot(g.pmra ?? 0, g.pmdec ?? 0), g: g.mag, sep: d }; }
      }
      // Gaia measured this star and it does not move: our 'motion' is a measurement artefact
      // ...or a bright star Gaia sees all the time cannot have 'appeared once'
      return { ...f, ra, dec, gaia: best, dismissed: !!best && (f.kind === 'moving' ? best.pm < 50 : best.g < 18) };
    }));
    setPick(-1);
    setFinding(false);
  };
  const saveFind = (f: FoundHere) => setCands((l) => [{
    id: Math.random().toString(36).slice(2, 9), target: target?.name ?? '', ra: f.ra, dec: f.dec,
    view: f.kind === 'moving' ? `Auto-found: moving ${f.rate.toFixed(1)}″/yr toward ${compass(f.pa)}` : `Auto-found: seen only in visit ${f.visits[0] + 1}`,
    mjd: result ? result.frames[0].mjd : 0, note: f.gaia ? `Gaia G=${f.gaia.g.toFixed(1)}, ${(f.gaia.pm / 1000).toFixed(2)}″/yr` : f.gaia === null ? 'Not in Gaia' : '', link: location.href, created: new Date().toISOString(),
  }, ...l]);

  const [more, setMore] = useState(false);
  // true SPHEREx pixels by default, exactly as captured (only aligned north-up); smoothing is an option
  const [smooth, setSmooth] = useState(false);
  const pixels = !smooth;
  const [help, setHelp] = useState(() => !localStorage.getItem('spherex-timelapse.seenHelp'));
  const closeHelp = () => { setHelp(false); localStorage.setItem('spherex-timelapse.seenHelp', '1'); };
  const [tour, setTour] = useState(false);
  const startTour = () => { closeHelp(); setMore(false); setTour(true); };
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [fps, setFps] = useState(2);
  const [contrast, setContrast] = useState(25);
  useEffect(() => { setIdx(0); }, [mode, band, result]);
  useEffect(() => { setFps(mode === 'frames' ? 8 : 2); }, [mode]);
  useEffect(() => {
    if (!playing || items.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % items.length), 1000 / fps);
    return () => clearInterval(t);
  }, [playing, fps, items.length]);
  const cur = items[Math.min(idx, items.length - 1)];
  const step = (d: number) => { setPlaying(false); setIdx((i) => (i + d + items.length) % Math.max(1, items.length)); };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)) return;
      if (e.key === ' ') { e.preventDefault(); setPlaying((x) => !x); } else if (e.key === 'ArrowRight') step(1); else if (e.key === 'ArrowLeft') step(-1);
    };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
  }, [items.length]);

  // ── catalogue overlays ──
  const [cats, setCats] = useState<{ gaia?: api.CatResult | null; wise?: api.CatResult | null; err: Record<string, string> }>({ err: {} });
  useEffect(() => {
    if (!center) return;
    for (const c of ['gaia', 'wise'] as const) {
      if (!overlays[c] || cats[c]) continue;
      api.catalog(c, center[0], center[1], (fov / 60) * 0.75).then((r) => setCats((s) => ({ ...s, [c]: r })))
        .catch((e) => { setCats((s) => ({ ...s, err: { ...s.err, [c]: (e as Error).message } })); setOverlays((o) => ({ ...o, [c]: false })); });
    }
  }, [overlays.gaia, overlays.wise, center?.[0], fov]);
  useEffect(() => { setCats({ err: {} }); }, [center?.[0], center?.[1], fov]);

  // ── probe (spectrum point) and spotting ──
  const [probe, setProbe] = useState<[number, number] | null>(null); // null = follow the target
  useEffect(() => setProbe(null), [target, n]);
  const [spotting, setSpotting] = useState(false);
  const [cands, setCands] = useState<Candidate[]>(loadCandidates);
  useEffect(() => saveCandidates(cands), [cands]);
  const c0 = (n - 1) / 2;
  const targetPx = (mjd: number): [number, number] | null => {
    if (!target || !center) return null;
    const g = gridOffset(center[0], center[1], ...positionAt(target, mjd), PIXEL_ARCSEC);
    return [c0 + g[0], c0 + g[1]];
  };
  const onPick = (px: number, py: number) => {
    if (!center) return;
    if (spotting && cur) {
      const [ra, dec] = gridToSky(center[0], center[1], px - c0, py - c0, PIXEL_ARCSEC);
      setCands((l) => [{ id: Math.random().toString(36).slice(2, 9), target: target?.name ?? '', ra, dec, view: `${cur.label} (${cur.sub})`, mjd: cur.mjd, note: '', link: location.href, created: new Date().toISOString() }, ...l]);
      setSpotting(false);
    } else setProbe([px, py]);
  };

  // ── spectrum and brightness over time at the probe (or following the target) ──
  const science = useMemo(() => {
    if (!result) return null;
    const visitOf = new Map<string, number>();
    visits.forEach((v) => v.frames.forEach((f) => visitOf.set(f.id, v.i)));
    const pts = result.frames.map((f) => {
      const d = store.get(f.id), at = probe ?? targetPx(f.mjd);
      return { f, v: visitOf.get(f.id) ?? 0, flux: d && at ? aperture(d.raw, n, at[0], at[1]) : NaN };
    }).filter((x) => Number.isFinite(x.flux));
    return { pts };
  }, [result, store.version, probe, target, n]);

  // ── export ──
  const [exporting, setExporting] = useState('');
  const exportAs = useCallback(async (kind: 'gif' | 'video') => {
    if (!items.length || !center) return;
    setExporting(kind === 'gif' ? 'Making GIF…' : 'Recording video…');
    try {
      const panelsOf = (it: Item) => buildPanels(it, mode === 'frames' ? (band ? colours : 'all') : colours, store, overlays.bad);
      const count = panelsOf(items[0]).length, { cols } = gridOf(count);
      const scale = Math.max(2, Math.floor(560 / ((cols * n + (cols - 1) * GAP)))), [W, H] = sceneSize(count, n, scale);
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H + 28;
      const x = cv.getContext('2d', { willReadFrequently: kind === 'gif' })!;
      const frameAt = (it: Item) => {
        x.fillStyle = '#0b0e14'; x.fillRect(0, 0, cv.width, cv.height);
        drawScene(x, panelsOf(it), n, scale, overlayFor(it));
        x.fillStyle = '#e8ecf3'; x.font = '600 13px system-ui, sans-serif';
        x.fillText(`${target?.name ?? ''} · ${it.label} · ${it.sub}`, 8, H + 19);
        x.fillStyle = '#9aa6bb'; x.textAlign = 'right'; x.fillText('NASA SPHEREx', W - 8, H + 19); x.textAlign = 'left';
      };
      if (kind === 'gif') {
        const heat = colours !== 'rgb' && !(mode === 'combine' && cmp.op === 'sub');
        const pal = makePalette(heat ? LUT : null), cache = new Map<number, number>(), frames: Uint8Array[] = [];
        for (const it of items) { frameAt(it); frames.push(quantize(x.getImageData(0, 0, cv.width, cv.height).data, pal, cache)); await new Promise((r) => setTimeout(r)); }
        const blob = encodeGif(frames, cv.width, cv.height, pal, Math.round(100 / fps));
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${(target?.name ?? 'spherex').replace(/[^\w]+/g, '-')}-${mode}.gif`; a.click();
      } else {
        const mime = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
        if (!mime) throw new Error('This browser cannot record video; try GIF.');
        const rec = new MediaRecorder(cv.captureStream(30), { mimeType: mime, videoBitsPerSecond: 4e6 }), chunks: Blob[] = [];
        rec.ondataavailable = (e) => chunks.push(e.data);
        const done = new Promise((r) => (rec.onstop = r));
        rec.start();
        for (let loop = 0; loop < 2; loop++) for (const it of items) { frameAt(it); await new Promise((r) => setTimeout(r, 1000 / fps)); }
        rec.stop(); await done;
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(chunks, { type: mime })); a.download = `${(target?.name ?? 'spherex').replace(/[^\w]+/g, '-')}-${mode}.${mime.includes('mp4') ? 'mp4' : 'webm'}`; a.click();
      }
      setExporting('');
    } catch (e) { setExporting(`Export failed: ${(e as Error).message}`); }
  }, [items, center, colours, mode, band, store.version, overlays, cats, fps, cmp, n, target]);

  const spanMjd: [number, number] | null = result?.frames.length ? [result.frames[0].mjd, result.frames[result.frames.length - 1].mjd] : null;
  const overlayFor = (it: Item): Overlay => ({
    contrast, pixels, target, center: center!, mjd: it.mjd, spanMjd, ring: overlays.ring,
    gaia: overlays.gaia ? cats.gaia ?? null : null, wise: overlays.wise ? cats.wise ?? null : null,
    probe: probe, marks: cands.filter((c) => c.target === target?.name).map((c) => [c.ra, c.dec] as [number, number]),
    finds, pick,
  });

  const panels = useMemo(() => (cur ? buildPanels(cur, mode === 'frames' ? (band ? colours : 'all') : colours, store, overlays.bad) : []), [cur, colours, mode, store.version, overlays.bad]);
  const loading = result && store.loaded + store.failed < result.frames.length;

  return (
    <div class={'work' + (p.panel ? '' : ' closed')}>
      <main class="stage">
        {!p.embed && (
          <div class="titlebar">
            <h2>{target?.name ?? 'Looking it up…'}</h2>
            {target?.kind && <span class="kind">{target.kind}</span>}
            <span class="spacer" />
            {result && <span class="chip num">{result.frames.length} exposures · {visits.length} visit{visits.length === 1 ? '' : 's'}</span>}
            <button class="iconbtn" aria-label={p.panel ? 'Hide details' : 'Show details'} aria-pressed={p.panel} onClick={() => p.setPanel(!p.panel)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M15 4v16" /></svg>
            </button>
          </div>
        )}
        {result && result.frames.length > 0 && target && (
          <p class="context">
            A {fov}′ × {fov}′ patch of sky around <b>{target.name}</b> ({moonFraction(fov)}), seen in infrared by NASA's SPHEREx telescope:
            {' '}{result.frames.length} photos from {visits.length} visit{visits.length === 1 ? '' : 's'}, {fmtDate(result.frames[0].mjd)} to {fmtDate(result.frames[result.frames.length - 1].mjd)}.
            {' '}<button class="link" onClick={() => setHelp(true)}>What am I looking at?</button> · <button class="link" onClick={startTour}>Take the tour</button>
          </p>
        )}
        <Viewer {...{ n, panels, cur, overlay: cur && center ? overlayFor(cur) : null, phase: p.phase, error: p.error, progress: p.progress, result, retry: p.retry, loading: !!loading, loaded: store.loaded, eta: store.eta, spotting, onPick, center, help: help && p.phase === 'ready' && !!result?.frames.length, closeHelp, startTour, fov, targetName: target?.name ?? 'the target', moving: !!(target?.pmra || target?.pmdec) }} />
        {result && items.length > 0 && (
          <>
            {mode !== 'combine' ? (
              <div class="player" data-tour="player">
                <div class="transport">
                  <button class="iconbtn" aria-label="Previous image" onClick={() => step(-1)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M15 5 8 12l7 7" /></svg></button>
                  <button class="play" aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)}>
                    {playing ? <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4.2" height="15" rx="1" /><rect x="13.8" y="4.5" width="4.2" height="15" rx="1" /></svg> : <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z" /></svg>}
                  </button>
                  <button class="iconbtn" aria-label="Next image" onClick={() => step(1)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m9 5 7 7-7 7" /></svg></button>
                </div>
                <Timeline items={items} idx={idx} onSeek={(i) => { setPlaying(false); setIdx(i); }} />
                <label class="speed">Speed
                  <select value={fps} onChange={(e) => setFps(+(e.target as HTMLSelectElement).value)}>
                    {[0.5, 1, 2, 4, 8, 12].map((v) => <option value={v}>{v < 1 ? 'Slow' : `${v}/s`}</option>)}
                  </select>
                </label>
              </div>
            ) : (
              <div class="player combine">
                <label class="ctl">Visit
                  <select value={cmp.a} onChange={(e) => setCmp({ ...cmp, a: +(e.target as HTMLSelectElement).value })}>
                    {visits.map((v) => <option value={v.i}>{v.i + 1}: {fmtDate(v.start)}</option>)}
                  </select>
                </label>
                <div class="seg" role="group" aria-label="Operation">
                  <button aria-pressed={cmp.op === 'sub'} onClick={() => setCmp({ ...cmp, op: 'sub' })} title="Show what changed">minus</button>
                  <button aria-pressed={cmp.op === 'add'} onClick={() => setCmp({ ...cmp, op: 'add' })} title="Add the two visits for a deeper image">plus</button>
                </div>
                <label class="ctl">visit
                  <select value={cmp.b} onChange={(e) => setCmp({ ...cmp, b: +(e.target as HTMLSelectElement).value })}>
                    {visits.map((v) => <option value={v.i}>{v.i + 1}: {fmtDate(v.start)}</option>)}
                  </select>
                </label>
              </div>
            )}
            <div class="controls">
              <div class="seg" role="group" aria-label="What to show" data-tour="modes">
                <button aria-pressed={mode === 'visits'} onClick={() => p.setMode('visits')} title="One image per visit, all exposures of that visit added together">Visits</button>
                <button aria-pressed={mode === 'frames'} onClick={() => p.setMode('frames')} title="Every exposure in time order">Every exposure</button>
                <button aria-pressed={mode === 'combine'} onClick={() => p.setMode('combine')} disabled={visits.length < 2} title="Subtract or add two visits">Combine</button>
              </div>
              <label class="ctl" data-tour="colours">Colours
                <select value={colours} onChange={(e) => p.setColours((e.target as HTMLSelectElement).value as Colours)}>
                  {COLOUR_OPTIONS.filter(([c]) => mode !== 'frames' || !['six', 'rgb'].includes(c)).map(([c, l]) => <option value={c}>{l}</option>)}
                </select>
              </label>
              <div class="toggles" role="group" aria-label="Overlays">
                {([['ring', 'Target ring', '#ffb84d'], ['gaia', 'Gaia stars', '#6ec3ff'], ['wise', 'WISE sources', '#7fdca4']] as const).map(([k, l, c]) => (
                  <button class="toggle" aria-pressed={overlays[k]} onClick={() => setOverlays((o) => ({ ...o, [k]: !o[k] }))}><i style={{ borderColor: c, background: overlays[k] ? c : 'transparent' }} />{l}</button>
                ))}
              </div>
              <span class="spacer" />
              <button class="btn find" data-tour="find" onClick={runFinder} disabled={finding || visits.length < 2} title={visits.length < 2 ? 'Needs at least two visits' : 'Let the app look for anything that moved or appeared'}>
                {finding ? 'Looking…' : finds ? `Found ${finds.length} · look again` : 'Find moving things'}
              </button>
              <button class={'btn' + (spotting ? ' on' : '')} data-tour="spot" aria-pressed={spotting} onClick={() => setSpotting(!spotting)}>{spotting ? 'Click on the image…' : 'I spotted something'}</button>
              <button class="btn" onClick={() => exportAs('gif')} disabled={!!exporting && !exporting.startsWith('Export failed')}>Save GIF</button>
              <button class="btn" aria-expanded={more} aria-controls="more" onClick={() => setMore(!more)}>More {more ? '▴' : '▾'}</button>
            </div>
            {more && (
              <div class="controls more" id="more">
                <label class="ctl">Field
                  <select value={fov} onChange={(e) => p.setFov(+(e.target as HTMLSelectElement).value)}>
                    {FOVS.map((f) => <option value={f}>{f}′ wide{f >= 20 ? ' (slower)' : ''}</option>)}
                  </select>
                </label>
                <label class="ctl">Contrast<input type="range" min={4} max={200} step={1} value={contrast} onInput={(e) => setContrast(+(e.target as HTMLInputElement).value)} /></label>
                <button class="toggle" aria-pressed={overlays.bad} onClick={() => setOverlays((o) => ({ ...o, bad: !o.bad }))}><i style={{ borderColor: '#00e6ff', background: overlays.bad ? '#00e6ff' : 'transparent' }} />Bad pixels</button>
                <button class="toggle" aria-pressed={smooth} onClick={() => setSmooth(!smooth)} title="Blend neighbouring pixels for a softer look (the data are unchanged)"><i style={{ borderColor: '#e8ecf3', background: smooth ? '#e8ecf3' : 'transparent', borderRadius: '2px' }} />Smooth display</button>
                <button class="btn" onClick={() => exportAs('video')} disabled={!!exporting && !exporting.startsWith('Export failed')}>Save video</button>
              </div>
            )}
            {(exporting || Object.values(cats.err).length > 0 || (overlays.bad && store.flagsLoaded < store.loaded)) && (
              <p class="tip" aria-live="polite">
                {exporting || Object.values(cats.err)[0] || `Loading data-quality flags: ${store.flagsLoaded} of ${store.loaded}${timeLeft(store.flagsEta)}`}
              </p>
            )}
            <p class="tip"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z" /></svg><span>{tipFor(mode, colours, cmp.op, target)}</span></p>
          </>
        )}
      </main>
      {p.panel && <Details {...{ target, result, cur, visits, store, science, probe, setProbe, n, center, cands, setCands, cats, overlays, fov, targetPx, finds, pick, setPick, saveFind }} />}
      {tour && <Tour onClose={() => setTour(false)} />}
    </div>
  );
}

/** The full Moon is about 31′ across: a friendly sense of scale. */
function moonFraction(fov: number) {
  const f = fov / 31;
  if (f >= 0.9) return 'about the width of the full Moon';
  const d = Math.round(1 / f);
  return `about 1/${d} of the full Moon's width`;
}

function tipFor(mode: Mode, colours: Colours, op: 'sub' | 'add', t: Target | null) {
  const extra = t?.note ? ` ${t.note}` : '';
  const base =
    mode === 'frames' ? 'Every exposure in time order. SPHEREx sees a different colour in each, so brightness changes from frame to frame: watch for things that change position.'
      : mode === 'combine' ? (op === 'sub' ? 'Orange = brighter in the first visit you chose, blue = brighter in the second. A moving star leaves an orange-and-blue pair; a star that changed brightness turns one colour.' : 'Adding two visits gives a deeper, less noisy image: faint sources show up better.')
        : 'Each image adds up every exposure from one visit, months apart. Anything that jumps between them is moving across the sky. The amber ring marks where the target should be.';
  const col = colours === 'rgb' ? ' False colour: short wavelengths blue, long red, so cold brown dwarfs look red.' : colours === 'six' ? ' Six bands: each detector added up separately, from 0.75 µm (top left) to 5 µm (bottom right).' : '';
  return base + col + extra + ' Click the image to measure a spectrum there.';
}

// ── viewer ─────────────────────────────────────────────────────────────────

interface ViewerProps {
  n: number; panels: ReturnType<typeof buildPanels>; cur?: Item; overlay: Overlay | null; center: [number, number] | null;
  phase: Phase; error: string; progress: FindProgress | null; result: FindResult | null; retry: () => void; loading: boolean; loaded: number;
  spotting: boolean; onPick: (x: number, y: number) => void; eta: number;
  help: boolean; closeHelp: () => void; startTour: () => void; fov: number; targetName: string; moving: boolean;
}

/** Plain-language explanation of the picture, shown the first time and on request. */
function HelpCard({ fov, targetName, moving, onClose, onTour }: { fov: number; targetName: string; moving: boolean; onClose: () => void; onTour: () => void }) {
  return (
    <div class="help-card" role="dialog" aria-labelledby="help-h">
      <h3 id="help-h">What am I looking at?</h3>
      <ul>
        <li><b>A tiny patch of sky</b> around {targetName}, {fov}′ across ({moonFraction(fov)}), photographed by NASA's <b>SPHEREx</b> space telescope in <b>infrared</b> light, which our eyes can't see.</li>
        <li><b>Each picture is one visit.</b> SPHEREx sweeps the whole sky every six months. The app finds every photo it took of this spot (here over about a year and a half) and plays them like a flipbook.</li>
        <li><b>Each small square is one real SPHEREx pixel</b> (6 arcseconds of sky), only turned so north is up and every date lines up. SPHEREx is built to split light into 102 infrared colours rather than take fine-detail pictures, so a star covers just a few pixels. Bright clusters of squares are stars and galaxies; near-black squares inside the brightest stars are pixels SPHEREx left empty because they were too bright to measure. We never fill them in.</li>
        <li><b>The amber ring</b> marks where {targetName} should be on each date. {moving ? 'This one is close to us, so it visibly moves between visits. Try “Combine”: orange = where it is now, blue = where it was.' : 'If anything jumps or changes brightness between pictures, it is worth a closer look.'}</li>
      </ul>
      <div style={{ display: 'flex', gap: '.5rem' }}><button class="btn on" onClick={onTour} autofocus>Show me around (30 s)</button><button class="btn" onClick={onClose}>Got it</button></div>
    </div>
  );
}

function Viewer(v: ViewerProps) {
  const box = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [boxSize, setBoxSize] = useState<[number, number]>([600, 500]);
  const [hover, setHover] = useState<string>('');
  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setBoxSize([e.contentRect.width, e.contentRect.height]));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  const count = Math.max(1, v.panels.length), { cols, rows } = gridOf(count);
  const dataW = cols * v.n + (cols - 1) * GAP, dataH = rows * v.n + (rows - 1) * GAP;
  // every SPHEREx pixel becomes an exact square of whole *screen* pixels, also on displays scaled
  // to 125 % or 150 % (a whole number of CSS px there would give uneven 12/13-px squares)
  const dpr = devicePixelRatio || 1;
  const devScale = Math.max(1, Math.floor(Math.min((boxSize[0] - 24) / dataW, (boxSize[1] - 24) / dataH) * dpr));
  const scale = devScale / dpr; // CSS px per data pixel

  useEffect(() => {
    const c = cv.current;
    if (!c || !v.overlay) return;
    const [W, H] = sceneSize(count, v.n, scale);
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); c.style.width = W + 'px'; c.style.height = H + 'px'; }
    const x = c.getContext('2d')!;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScene(x, v.panels, v.n, scale, v.overlay);
  });

  /** client point → grid pixel (within whichever panel was hit) */
  const toGrid = (e: MouseEvent): [number, number] | null => {
    const r = cv.current!.getBoundingClientRect();
    const dx = (e.clientX - r.left) / scale, dy = (e.clientY - r.top) / scale;
    const col = Math.floor(dx / (v.n + GAP)), row = Math.floor(dy / (v.n + GAP));
    const px = dx - col * (v.n + GAP) - 0.5, py = dy - row * (v.n + GAP) - 0.5;
    return px < -0.5 || py < -0.5 || px > v.n - 0.5 || py > v.n - 0.5 ? null : [px, py];
  };

  const st = v.phase;
  return (
    <div class={'viewer' + (v.spotting ? ' spotting' : '')} ref={box} data-tour="viewer">
      {st === 'ready' && v.result && v.result.frames.length > 0 && (
        <canvas ref={cv} role="img" aria-label={v.cur ? `${v.cur.label}, ${v.cur.sub}` : 'Sky image'}
          onClick={(e) => { const g = toGrid(e); if (g) v.onPick(g[0], g[1]); }}
          onMouseMove={(e) => {
            const g = toGrid(e);
            if (!g || !v.center) { setHover(''); return; }
            const c0 = (v.n - 1) / 2, [ra, dec] = gridToSky(v.center[0], v.center[1], g[0] - c0, g[1] - c0, PIXEL_ARCSEC);
            setHover(`RA ${ra.toFixed(4)}°  Dec ${dec.toFixed(4)}°`);
          }}
          onMouseLeave={() => setHover('')} />
      )}
      {st === 'ready' && v.cur && (
        <>
          <div class="overlay-tl"><span class="tag"><b>{v.cur.label}</b> · {v.cur.sub}</span></div>
          <div class="overlay-tr">
            {v.cur.lambda ? <span class="tag"><span class="sw" style={{ background: wlColor(v.cur.lambda) }} />{v.cur.lambda.toFixed(2)} µm</span>
              : <span class="tag">{v.cur.frames.length + (v.cur.ref?.length ?? 0)} exposures</span>}
          </div>
          <div class="overlay-bl">
            {v.loading && <span class="tag num">Loading images {v.loaded} / {v.result?.frames.length}{timeLeft(v.eta)}</span>}
            {hover && <span class="tag num mono">{hover}</span>}
          </div>
        </>
      )}
      {v.help && <HelpCard fov={v.fov} targetName={v.targetName} moving={v.moving} onClose={v.closeHelp} onTour={v.startTour} />}
      {st === 'resolving' && <div class="state"><b>Looking it up…</b>Finding where this is on the sky.</div>}
      {st === 'finding' && (
        <div class="state" aria-live="polite">
          <b>Finding SPHEREx images of this spot</b>
          {v.progress && v.progress.total > 0 ? (
            <><div class="bar"><i style={{ width: `${(100 * v.progress.done) / v.progress.total}%` }} /></div>
              <span class="num">Checked {v.progress.done} of {v.progress.total} possible exposures · {v.progress.frames} contain it</span></>
          ) : 'Working out which weeks of the survey passed over it…'}
        </div>
      )}
      {st === 'ready' && v.result && v.result.frames.length === 0 && (
        <div class="state"><b>No SPHEREx images here yet</b>
          {v.result.indexed < v.result.folders && v.result.source === 'index' ? `Only ${v.result.indexed} of ${v.result.folders} weeks of data are indexed so far.` : 'The released data do not cover this position yet. New data arrive every week.'}
        </div>
      )}
      {st === 'error' && <div class="state"><b>Something went wrong</b>{v.error}<p><button class="btn" onClick={v.retry}>Try again</button></p></div>}
    </div>
  );
}

function Timeline({ items, idx, onSeek }: { items: Item[]; idx: number; onSeek: (i: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const t0 = items[0].mjd, t1 = items[items.length - 1].mjd, span = Math.max(1, t1 - t0);
  const pos = (it: Item, k: number) => (items.length < 2 ? 50 : 2 + 96 * (span > 3 ? (it.mjd - t0) / span : k / (items.length - 1)));
  const seek = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect(), f = ((clientX - r.left) / r.width) * 100;
    let best = 0, bd = Infinity;
    items.forEach((it, k) => { const d = Math.abs(pos(it, k) - f); if (d < bd) { bd = d; best = k; } });
    onSeek(best);
  };
  return (
    <div class="timeline" ref={ref} role="slider" tabIndex={0} aria-label="Timeline" aria-valuemin={1} aria-valuemax={items.length} aria-valuenow={idx + 1} aria-valuetext={`${items[idx]?.label}, ${items[idx]?.sub}`}
      onKeyDown={(e) => { if (e.key === 'Home') onSeek(0); if (e.key === 'End') onSeek(items.length - 1); }}
      onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); seek(e.clientX); }}
      onPointerMove={(e) => { if (e.buttons) seek(e.clientX); }}>
      <div class="rail" />
      {items.map((it, k) => <span class="tick" style={{ left: `${pos(it, k)}%`, background: it.lambda ? wlColor(it.lambda) : '#9aa6bb' }} />)}
      <span class="knob" style={{ left: `${pos(items[idx] ?? items[0], idx)}%` }} />
    </div>
  );
}

/**
 * The exploration workspace: one viewer that never remounts, four modes (Sky, Time, Spectrum,
 * Movers) that change what it shows and what the dock below it offers, and an inspector.
 * All state that defines a view is mirrored into the URL, so any view can be shared.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import * as api from '../../web/src/api';
import type { Featured, FindProgress, FindResult, Frame, Target } from '../../web/src/api';
import { BANDS, gridOffset, gridToSky, PIXEL_ARCSEC, positionAt, REF_MJD } from '../../web/src/astro';
import { encodeGif, makePalette, quantize } from '../../web/src/gif';
import { LUT } from '../../web/src/render';
import { bandOf, buildPanels, drawScene, gridOf, GAP, sceneSize, type Colours, type Item, type Overlay } from '../../web/src/scene';
import { Icon } from './icons';
import { Inspector } from './Inspector';
import { loadMarks, loadReviews, marksAsCands, reviewKey, runFinder, saveMarks, saveReviews, type Cand, type Mark, type ReviewRec } from './movers';
import { MoversPanel } from './MoversPanel';
import { SpectrumLab } from './SpectrumLab';
import { useStore } from './store';
import { Timeline } from './Timeline';
import { Tour } from './Tour';
import { BASE, COMPARE_VIEWS, coverageOf, exploreQuery, fmtDay, fmtGap, fmtMonth, fmtSpan, FOVS, groupVisits, isTyping, load, LOOK_FOR, plural, readExplore, save, sizeFor, VIEWS, type ExploreState, type Mode, type View } from './util';
import { Viewer, type Scene } from './Viewer';

type Phase = 'idle' | 'resolving' | 'finding' | 'ready' | 'error';

const MODE_LABEL: Record<Mode, string> = { sky: 'Sky', time: 'Time', spectrum: 'Spectrum', movers: 'Movers' };
const MODE_HINT: Record<Mode, string> = {
  sky: 'The deepest picture: every visit added together',
  time: 'Compare visits months apart',
  spectrum: 'Brightness across 102 infrared colours',
  movers: 'Let TimeLens search for motion',
};
const VIEW_LABEL: Record<View, string> = { blink: 'Blink', play: 'Play visits', exposures: 'Exposures', side: 'Side by side', diff: 'Difference' };
const COLOUR_LABEL: Array<[Colours, string]> = [
  ['all', 'All colours combined'], ['six', 'Six bands side by side'], ['rgb', 'False colour (blue → red)'],
  ...BANDS.map((b) => [`d${b.det}` as Colours, `Band ${b.det} only · ${b.lo.toFixed(2)}–${b.hi.toFixed(2)} µm`] as [Colours, string]),
];

/** The full Moon is about 31′ across: a friendly sense of scale. */
const moon = (fov: number) => (fov / 31 >= 0.9 ? 'about the width of the full Moon' : `about 1/${Math.round(31 / fov)} of the full Moon's width`);
const timeLeft = (s: number) => (!(s > 15) ? '' : s < 90 ? ` · about ${Math.max(10, Math.round(s / 10) * 10)} s left` : ` · about ${Math.round(s / 60)} min left`);

interface Display { ring: boolean; gaia: boolean; wise: boolean; bad: boolean; smooth: boolean; contrast: number }

export function Explore({ search, nonce, featured, irsa }: { search: string; nonce: number; featured: Featured[]; irsa: boolean | null }) {
  const [st, setSt] = useState<ExploreState>(() => readExplore(search));
  const set = (p: Partial<ExploreState>) => setSt((s) => ({ ...s, ...p }));
  // a new search (or back/forward) loads that target; the same search again retries it after an error
  useEffect(() => {
    const s = readExplore(search);
    if (s.q && s.q !== st.q) setSt(s);
    else if (s.q && phaseRef.current === 'error') open(s.q);
  }, [search, nonce]);
  useEffect(() => { if (st.q) history.replaceState(history.state, '', `${BASE}/explore${exploreQuery(st)}`); }, [st]);

  // ── find the target and its exposures ──
  const [phase, setPhase] = useState<Phase>('idle');
  const phaseRef = useRef<Phase>('idle');
  phaseRef.current = phase;
  const [error, setError] = useState('');
  const [target, setTarget] = useState<Target | null>(null);
  const [result, setResult] = useState<FindResult | null>(null);
  const [progress, setProgress] = useState<FindProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const open = useCallback(async (q: string) => {
    q = q.trim();
    abortRef.current?.abort();
    if (!q) { setPhase('idle'); return; }
    const ac = new AbortController();
    abortRef.current = ac;
    setError(''); setResult(null); setProgress(null); setTarget(null); setPhase('resolving');
    try {
      const t = await api.resolveTarget(q, ac.signal);
      if (ac.signal.aborted) return;
      setTarget(t); setPhase('finding');
      const [rc, dc] = positionAt(t, REF_MJD);
      const r = await api.findFrames(rc, dc, setProgress, ac.signal);
      if (ac.signal.aborted) return;
      setResult(r); setPhase('ready');
    } catch (e) {
      if (ac.signal.aborted) return;
      setError((e as Error).message || 'The server did not answer.'); setPhase('error');
    }
  }, []);
  useEffect(() => { open(st.q); }, [st.q]);
  useEffect(() => { document.title = `${target?.name ?? (st.q || 'Explore')} · SPHEREx TimeLens`; }, [target, st.q]);

  const n = sizeFor(st.fov);
  const center = useMemo(() => (target ? positionAt(target, REF_MJD) : null), [target]);
  // smooth = clear display (bicubic upscaling) by default; untick for exact SPHEREx pixels
  const [display, setDisplay] = useState<Display>({ ring: true, gaia: false, wise: false, bad: false, smooth: true, contrast: 25 });
  const store = useStore(result, center, n, display.bad);
  const visits = useMemo(() => (result ? groupVisits(result.frames) : []), [result]);
  const nv = visits.length;
  const band = bandOf(st.colours);
  const inBand = (f: Frame) => !band || f.det === band;
  const clampV = (i: number) => Math.max(0, Math.min(nv - 1, i));
  const A = clampV(st.a ?? nv - 1), B = clampV(st.b ?? 0);
  const canCompare = nv >= 2;
  const view: View = !canCompare && COMPARE_VIEWS.includes(st.view) ? 'play' : st.view;
  const exposures = useMemo(() => (result ? result.frames.filter(inBand).sort((p, q) => p.mjd - q.mjd) : []), [result, band]);
  const featuredHere = featured.find((f) => f.name === target?.name);
  const lookFor = featuredHere ? LOOK_FOR[featuredHere.slug] : undefined;

  // ── catalogues for overlays and the Gaia check ──
  // Every answer is filed under the view it was asked for, so a slow answer for the previous
  // target can never be drawn on (or used to check movers in) the next one.
  type Cats = { key: string; gaia?: api.CatResult | null; wise?: api.CatResult | null; err: string };
  const catKey = center ? `${center[0].toFixed(6)} ${center[1].toFixed(6)} ${st.fov}` : '';
  const catKeyRef = useRef(catKey);
  catKeyRef.current = catKey;
  const [catState, setCats] = useState<Cats>({ key: '', err: '' });
  const cats: Cats = catState.key === catKey ? catState : { key: catKey, err: '' };
  const putCats = (key: string, patch: Partial<Cats>) => setCats((s) => (key !== catKeyRef.current ? s : { ...(s.key === key ? s : { key, err: '' }), ...patch }));
  const asked = useRef(new Set<string>());
  useEffect(() => {
    if (!center) return;
    for (const c of ['gaia', 'wise'] as const) {
      const ask = `${catKey}|${c}`;
      if (!display[c] || cats[c] !== undefined || asked.current.has(ask)) continue;
      asked.current.add(ask);
      api.catalog(c, center[0], center[1], (st.fov / 60) * 0.75)
        .then((r) => putCats(catKey, { [c]: r }))
        .catch((e) => { if (catKeyRef.current === catKey) { putCats(catKey, { err: (e as Error).message }); setDisplay((d) => ({ ...d, [c]: false })); } })
        .finally(() => asked.current.delete(ask));
    }
  }, [display.gaia, display.wise, catKey, cats.gaia, cats.wise]);

  // ── measuring point, movers, your marks ──
  const [probe, setProbe] = useState<[number, number] | null>(null);
  useEffect(() => setProbe(null), [target, n]);
  const c0 = (n - 1) / 2;
  const targetPx = (mjd: number): [number, number] | null => {
    if (!target || !center) return null;
    const g = gridOffset(center[0], center[1], ...positionAt(target, mjd), PIXEL_ARCSEC);
    return [c0 + g[0], c0 + g[1]];
  };
  const [cands, setCands] = useState<Cand[] | null>(null);
  const [finding, setFinding] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const [marks, setMarks] = useState<Mark[]>(loadMarks);
  const [reviews, setReviews] = useState<Record<string, ReviewRec>>(loadReviews);
  useEffect(() => { setCands(null); setPick(null); setMarking(false); }, [result, n]);
  const yours = useMemo(() => marksAsCands(marks, target, center, n), [marks, target, center, n]);
  const allCands = [...(cands ?? []), ...yours];
  const picked = allCands.find((c) => c.id === pick) ?? null;
  const reviewOf = (c: Cand): ReviewRec => reviews[reviewKey(target?.name ?? '', c)] ?? { status: 'new', note: '' };
  const setReview = (c: Cand, r: Partial<ReviewRec>) => {
    const next = { ...reviews, [reviewKey(target?.name ?? '', c)]: { ...reviewOf(c), ...r } };
    setReviews(next); saveReviews(next);
  };
  const removeMark = (c: Cand) => { const ms = marks.filter((m) => m.id !== c.markId); setMarks(ms); saveMarks(ms); setPick(null); };
  const resultRef = useRef(result);
  resultRef.current = result;
  const runMovers = async () => {
    if (!result || !center) return;
    const forResult = result, forKey = catKey; // the key includes the field size
    setFinding(true);
    await new Promise((r) => setTimeout(r, 40)); // let the button repaint before the work starts
    try {
      const r = await runFinder({ result, visits, store, center, n, fov: st.fov, gaia: cats.gaia ?? null });
      // the target or field changed while it ran: these finds belong to the old view
      if (resultRef.current !== forResult || catKeyRef.current !== forKey) return;
      if (r.gaia && !cats.gaia) putCats(forKey, { gaia: r.gaia });
      setCands(r.cands); setPick(null);
    } finally { setFinding(false); }
  };
  const choose = (id: string | null) => {
    setPick(id);
    if (id) { if (st.mode !== 'movers') set({ mode: 'movers' }); if (st.z < 2) set({ z: 2 }); setInsp(true); }
  };

  // ── playback ──
  const [idx, setIdx] = useState(0);
  // autoplay, unless the visitor asked their system for reduced motion (then press Play)
  const [playing, setPlaying] = useState(() => !matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [fps, setFps] = useState(2);
  const [mix, setMix] = useState(0); // blink, paused: 0 = B … 1 = A
  const seqLen = view === 'blink' ? 2 : view === 'play' ? nv : view === 'exposures' ? exposures.length : 1;
  const pendingExposure = useRef<string | null>(null);
  useEffect(() => { setIdx(0); setMix(0); }, [view, band, result]);
  useEffect(() => {
    if (!pendingExposure.current) return;
    const k = exposures.findIndex((f) => f.id === pendingExposure.current);
    pendingExposure.current = null;
    if (k >= 0) { setIdx(k); setPlaying(false); }
  }, [exposures, view]);
  useEffect(() => { setFps(view === 'exposures' ? 8 : 2); }, [view]);
  useEffect(() => {
    if (!playing || seqLen < 2 || st.mode !== 'time' || phase !== 'ready') return;
    const t = setInterval(() => setIdx((i) => (i + 1) % seqLen), 1000 / fps);
    return () => clearInterval(t);
  }, [playing, fps, seqLen, st.mode, phase]);
  const cur = Math.min(idx, Math.max(0, seqLen - 1));
  const stepBy = (d: number) => { setPlaying(false); const k = (cur + d + seqLen) % Math.max(1, seqLen); setIdx(k); if (view === 'blink') setMix(k); };
  const togglePlay = () => { if (playing && view === 'blink') setMix(cur); setPlaying(!playing); };
  const live = useRef({ stepBy, togglePlay, mode: st.mode });
  live.current = { stepBy, togglePlay, mode: st.mode };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.tour') || live.current.mode !== 'time') return;
      if (e.key === ' ' && !(e.target as HTMLElement).closest('button, a, [role=slider]')) { e.preventDefault(); live.current.togglePlay(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); live.current.stepBy(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); live.current.stepBy(-1); }
    };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
  }, []);

  // ── what to draw ──
  const span = result?.frames.length ? [result.frames[0].mjd, result.frames[result.frames.length - 1].mjd] as [number, number] : null;
  const visitItem = (i: number, tag = ''): Item => {
    const v = visits[i];
    return { key: `v${i}|${band}`, label: `${tag}Visit ${i + 1} of ${nv}`, sub: fmtSpan(v.start, v.end), mjd: v.mjd, frames: v.frames.filter(inBand) };
  };
  const expItem = (k: number): Item => {
    const f = exposures[k];
    return { key: f.id, label: `Exposure ${k + 1} of ${exposures.length}`, sub: `${fmtDay(f.mjd)} · ${f.lambda.toFixed(2)} µm`, mjd: f.mjd, frames: [f], lambda: f.lambda };
  };
  const deepItem = (): Item => ({ key: `deep|${band}`, label: `All ${plural(nv, 'visit')} combined`, sub: span ? fmtSpan(span[0], span[1]) : '', mjd: span ? (span[0] + span[1]) / 2 : REF_MJD, frames: (result?.frames ?? []).filter(inBand) });
  const coloursFor = (single: boolean): Colours => {
    if (st.mode === 'time' && view === 'exposures') return band ? st.colours : 'all';
    if (single && st.colours === 'six') return 'all';
    return st.colours;
  };
  const yourMarks = yours.map((c) => [c.ra, c.dec] as [number, number]);
  type AutoCand = Cand & { kind: 'moving' | 'once' };
  const finds = st.mode === 'movers' && cands ? cands.filter((c): c is AutoCand => c.kind !== 'yours') : null;
  const overlayFor = (it: Item): Overlay => ({
    contrast: display.contrast, pixels: !display.smooth, target, center: center!, mjd: it.mjd, spanMjd: span, ring: display.ring,
    gaia: display.gaia ? cats.gaia ?? null : null, wise: display.wise ? cats.wise ?? null : null,
    probe, marks: yourMarks, finds, pick: finds && picked ? finds.indexOf(picked as AutoCand) : -1, compass: false,
  });
  const sceneOf = (it: Item, single = false, tag?: string, tagClass?: string): Scene => ({ panels: buildPanels(it, coloursFor(single), store, display.bad), overlay: overlayFor(it), tag, tagClass });

  const ready = phase === 'ready' && !!result && result.frames.length > 0 && !!center;
  // every image failed (server restarted, connection gone): say so instead of showing an empty frame
  const failedAll = ready && store.total > 0 && store.failed >= store.total;
  let scenes: Scene[] = [], fade: { scene: Scene; t: number } | null = null, shown: Item | null = null, which = '';
  if (ready && !failedAll) {
    if (st.mode !== 'time') { shown = deepItem(); scenes = [sceneOf(shown)]; }
    else if (view === 'blink') {
      const items = [visitItem(B), visitItem(A)];
      if (playing) { shown = items[cur]; which = cur ? 'A' : 'B'; scenes = [sceneOf(shown)]; }
      else { shown = mix >= 0.5 ? items[1] : items[0]; which = mix >= 0.5 ? 'A' : 'B'; scenes = [sceneOf(items[0])]; fade = { scene: sceneOf(items[1]), t: mix }; }
    } else if (view === 'play') { shown = visitItem(cur); scenes = [sceneOf(shown)]; }
    else if (view === 'exposures') { shown = exposures.length ? expItem(cur) : null; scenes = shown ? [sceneOf(shown)] : []; }
    else if (view === 'side') { shown = visitItem(A); scenes = [sceneOf(visitItem(B), true, `B · ${fmtMonth(visits[B].mjd)}`, 'b'), sceneOf(shown, true, `A · ${fmtMonth(visits[A].mjd)}`, 'a')]; }
    else {
      const a = visitItem(A), b = visitItem(B);
      shown = { ...a, key: `d${A}-${B}|${band}`, label: `Visit ${A + 1} minus visit ${B + 1}`, sub: `${fmtMonth(visits[A].mjd)} vs ${fmtMonth(visits[B].mjd)}`, ref: b.frames, op: 'sub' };
      scenes = [sceneOf(shown)];
    }
  }
  const resetKey = `${target?.name}|${n}|${scenes.map((s) => s.panels.length).join(',')}`;
  const focus = picked ? [(picked.x0 + picked.x1) / 2, (picked.y0 + picked.y1) / 2] as [number, number] : null;

  const onPick = (gx: number, gy: number) => {
    if (!center || !target) return;
    if (marking) {
      const [ra, dec] = gridToSky(center[0], center[1], gx - c0, gy - c0, PIXEL_ARCSEC);
      const m: Mark = { id: Math.random().toString(36).slice(2, 9), target: target.name, ra, dec, seen: shown ? `${shown.label} (${shown.sub})` : '', mjd: shown?.mjd ?? REF_MJD, created: new Date().toISOString() };
      const ms = [m, ...marks];
      setMarks(ms); saveMarks(ms); setMarking(false);
      say('Marked. It is listed under Movers.');
      return;
    }
    if (st.mode === 'movers') {
      const near = allCands.map((c) => ({ c, d: Math.hypot((c.x0 + c.x1) / 2 - gx, (c.y0 + c.y1) / 2 - gy) })).filter((x) => x.d < 3 && !x.c.dismissed).sort((p, q) => p.d - q.d)[0];
      if (near) { choose(near.c.id); return; }
    }
    setProbe([gx, gy]);
    if (st.mode !== 'spectrum') say('Measuring at the point you clicked.', { label: 'Open Spectrum', run: () => set({ mode: 'spectrum' }) });
  };

  // ── small things: toast, help, tour, inspector ──
  const [toast, setToast] = useState<{ text: string; act?: { label: string; run: () => void } } | null>(null);
  const say = (text: string, act?: { label: string; run: () => void }) => setToast({ text, act });
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t); }, [toast]);
  const [help, setHelp] = useState(() => !load('timelens.seenHelp', false));
  const closeHelp = () => { setHelp(false); save('timelens.seenHelp', true); };
  const [tour, setTour] = useState(false);
  const [insp, setInsp] = useState(() => innerWidth >= 1440);
  // Below 1200 px the details open as a drawer over the image: focus goes into it, Esc closes it,
  // and focus comes back to the Details button.
  const detailsBtn = useRef<HTMLButtonElement>(null);
  const isDrawer = () => matchMedia('(max-width: 1199px)').matches;
  const closeInsp = () => { setInsp(false); if (isDrawer()) detailsBtn.current?.focus(); };
  useEffect(() => {
    if (!insp || !isDrawer()) return;
    document.querySelector<HTMLButtonElement>('#inspector .insp-head button')?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('.tour, #display-menu')) { e.preventDefault(); closeInsp(); } };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [insp]);

  // ── GIF of what is playing ──
  const [gifBusy, setGifBusy] = useState(false);
  const saveGif = async () => {
    if (!ready || !center) return;
    const seq: Item[] = view === 'blink' ? [visitItem(B, 'B · '), visitItem(A, 'A · ')] : view === 'play' ? visits.map((_, i) => visitItem(i)) : view === 'exposures' ? exposures.map((_, k) => expItem(k)) : [];
    if (seq.length < 2) return;
    setGifBusy(true);
    try {
      const cols = coloursFor(false), panelsOf = (it: Item) => buildPanels(it, cols, store, display.bad);
      const count = Math.max(1, panelsOf(seq[0]).length), { cols: gc } = gridOf(count);
      const scale = Math.max(2, Math.floor(560 / (gc * n + (gc - 1) * GAP))), [W, H] = sceneSize(count, n, scale);
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H + 28;
      const x = cv.getContext('2d', { willReadFrequently: true })!;
      const pal = makePalette(cols !== 'rgb' ? LUT : null), cache = new Map<number, number>(), frames: Uint8Array[] = [];
      for (const it of seq) {
        x.fillStyle = '#121620'; x.fillRect(0, 0, cv.width, cv.height);
        drawScene(x, panelsOf(it), n, scale, { ...overlayFor(it), compass: true });
        x.font = '600 13px system-ui, sans-serif'; x.fillStyle = '#e8ecf3';
        x.fillText(`${target?.name ?? ''} · ${it.label} · ${it.sub}`, 8, H + 19);
        x.fillStyle = '#9aa6bb'; x.textAlign = 'right'; x.fillText('NASA SPHEREx · TimeLens', W - 8, H + 19); x.textAlign = 'left';
        frames.push(quantize(x.getImageData(0, 0, cv.width, cv.height).data, pal, cache));
        await new Promise((r) => setTimeout(r));
      }
      const blob = encodeGif(frames, cv.width, cv.height, pal, Math.round(100 / fps));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `${(target?.name ?? 'spherex').replace(/[^\w]+/g, '-')}-${view}.gif`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      say(`GIF saved: ${plural(seq.length, 'frame')}.`);
    } catch (e) { say(`The GIF could not be made: ${(e as Error).message}`); } finally { setGifBusy(false); }
  };

  // ── layout ──
  const loading = ready && store.loaded + store.failed < store.total;
  const playable = view === 'blink' || view === 'play' || view === 'exposures';
  const alt = ready && shown ? `${target?.name}: ${shown.label}, ${shown.sub}. SPHEREx infrared image, ${st.fov}′ across, north up.` : 'Sky viewer';
  const showHelp = help && ready && !failedAll && !tour;
  const picks = (featured.length ? featured.map((f) => f.name) : ["Barnard's Star", 'WISE 0855−0714', 'R Draconis']).slice(0, 5);

  return (
    <div class={`explore mode-${st.mode}` + (insp ? ' insp-open' : '')}>
      <section class="stage" aria-label="Sky viewer">
        <div class="stagebar">
          <div class="tgt">
            <h1>{target?.name ?? (phase === 'resolving' ? 'Looking it up…' : st.q || 'Explore the sky')}</h1>
            {target?.kind && <span class="kind">{target.kind}</span>}
            {phase === 'ready' && result && (() => {
              const c = coverageOf(result);
              return <span class={'chip ' + c.tone} title={c.note}>{c.label}{result.frames.length > 0 && <> · {plural(result.frames.length, 'exposure')} · {plural(nv, 'visit')}</>}</span>;
            })()}
          </div>
          <button ref={detailsBtn} class={'btn sm details-btn' + (insp ? ' on' : '')} data-tour="details" aria-expanded={insp} aria-controls="inspector" onClick={() => (insp ? closeInsp() : setInsp(true))}><Icon name="panel" size={16} />Details</button>
          <div class="modes" role="group" aria-label="Workspace" data-tour="modes">
            {(['sky', 'time', 'spectrum', 'movers'] as Mode[]).map((m) => (
              <button aria-pressed={st.mode === m} title={MODE_HINT[m]} onClick={() => set({ mode: m })}>{MODE_LABEL[m]}</button>
            ))}
          </div>
          <div class="tools">
            <label class="sel"><span class="sr-only">Colours</span>
              <select class="select sm" value={st.colours} onChange={(e) => set({ colours: (e.target as HTMLSelectElement).value as Colours })} aria-label="Colours">
                {COLOUR_LABEL.map(([c, l]) => <option value={c} disabled={(st.mode === 'time' && view === 'exposures' && (c === 'six' || c === 'rgb')) || (st.mode === 'time' && view === 'side' && c === 'six')}>{l}</option>)}
              </select>
            </label>
            <DisplayMenu display={display} setDisplay={setDisplay} err={cats.err} loadingCats={(display.gaia && cats.gaia === undefined) || (display.wise && cats.wise === undefined)} />
            <label class="sel"><span class="sr-only">Field of view</span>
              <select class="select sm" value={st.fov} onChange={(e) => set({ fov: +(e.target as HTMLSelectElement).value, z: 1 })} aria-label="Field of view">
                {FOVS.map((f) => <option value={f}>{f}′ field{f >= 20 ? ' (slow)' : ''}</option>)}
              </select>
            </label>
          </div>
        </div>

        <Viewer n={n} scenes={scenes} fade={fade} center={center} zoom={st.z} onZoom={(z) => set({ z })} resetKey={resetKey} focus={focus}
          picking={marking} onPick={onPick} alt={alt}
          caption={shown && !(st.mode === 'time' && view === 'side') && (
            <span class="vw-chip">{which && <b class={'ab ' + which.toLowerCase()}>{which}</b>}<b>{shown.label.replace(/^[AB] · /, '')}</b><span>{shown.sub}</span></span>
          )}>
          {loading && !failedAll && <div class="vw-progress mono" role="status">Loading images {store.loaded} of {store.total}{timeLeft(store.eta)}</div>}
          {failedAll && !loading && (
            <div class="state vw-fail" role="alert"><h2>The images could not be loaded</h2>
              <p>SPHEREx has {plural(store.total, 'exposure')} of this spot, but none of the pictures arrived. The TimeLens server may have restarted, or the connection dropped.</p>
              <p><button class="btn primary" onClick={() => open(st.q)}>Try again</button></p></div>
          )}
          {ready && !loading && !failedAll && store.failed > 0 && (
            <div class="vw-warn" role="status"><Icon name="warn" size={14} /><span>{store.failed} of {store.total} images could not be loaded, so they are left out.</span>
              <button class="link" onClick={store.retry}>Try again</button></div>
          )}
          {phase === 'idle' && (
            <div class="state"><h2>Choose a spot on the sky</h2><p>Search for a star by name or type coordinates above, or start with a challenge target.</p>
              <div class="state-picks">{picks.map((t) => <button class="btn" onClick={() => setSt({ ...readExplore(''), q: t })}>{t}</button>)}</div></div>
          )}
          {phase === 'resolving' && <div class="state" role="status"><h2>Looking up “{st.q}”</h2><p>Finding where it is on the sky.</p><div class="bar indeterminate"><i /></div></div>}
          {phase === 'finding' && (
            <div class="state" role="status">
              <h2>Finding SPHEREx images of this spot</h2>
              {progress && progress.total > 0 ? (
                <><div class="bar"><i style={{ width: `${(100 * progress.done) / progress.total}%` }} /></div>
                  <p class="mono">Checked {progress.done.toLocaleString('en-US')} of {progress.total.toLocaleString('en-US')} possible exposures · {progress.frames.toLocaleString('en-US')} contain it</p></>
              ) : <><div class="bar indeterminate"><i /></div><p>Working out which weeks of the survey passed over it…</p></>}
            </div>
          )}
          {phase === 'ready' && result && result.frames.length === 0 && (
            <div class="state"><h2>No SPHEREx images of this spot yet</h2>
              <p>{result.source === 'index' && result.indexed < result.folders ? `Only ${result.indexed} of ${result.folders} weeks of the survey are indexed so far, so some images may be missing.` : 'The released SPHEREx data do not cover this position yet. New data are released regularly.'}</p>
              <div class="state-picks">{picks.slice(0, 3).map((t) => <button class="btn" onClick={() => setSt({ ...readExplore(''), q: t })}>{t}</button>)}</div></div>
          )}
          {phase === 'error' && (
            <div class="state" role="alert"><h2>Something went wrong</h2><p>{error}</p><p><button class="btn primary" onClick={() => open(st.q)}>Try again</button></p></div>
          )}
          {showHelp && target && (
            <div class="help-card" role="dialog" aria-labelledby="help-h">
              <h2 id="help-h">What am I looking at?</h2>
              <ul>
                <li>A tiny patch of sky around <b>{target.name}</b>, {st.fov}′ across ({moon(st.fov)}), photographed in infrared light by NASA's <b>SPHEREx</b> telescope.</li>
                <li>{canCompare && A !== B ? <>It is <b>blinking between two visits</b>, {fmtGap(Math.abs(visits[A].mjd - visits[B].mjd))} apart. Anything that jumps is moving across the sky; anything that brightens or fades is changing.</> : !canCompare ? <>SPHEREx has visited this spot only once so far, so there is nothing to compare yet.</> : <>Visits A and B are set to the same visit, so nothing changes. Pick two different visits below the image.</>}</li>
                <li>{display.smooth ? 'The picture is smoothed for display (each real SPHEREx pixel covers 6″ of sky; untick Clear display under Display to see them as squares).' : 'Each square is one real SPHEREx pixel (6″ of sky).'} Dark holes inside the brightest stars are pixels too bright to measure. We never fill them in.</li>
                <li>The <b class="amber-t">amber ring</b> marks where {target.name} should be on each date.</li>
              </ul>
              <div class="row"><button class="btn primary" onClick={() => { closeHelp(); setTour(true); }}>Take the 30-second tour</button><button class="btn" onClick={closeHelp}>Got it</button></div>
            </div>
          )}
          {toast && (
            <div class="toast" role="status"><span>{toast.text}</span>{toast.act && <button class="link" onClick={() => { toast.act!.run(); setToast(null); }}>{toast.act.label}</button>}
              <button class="iconbtn sm" aria-label="Dismiss" onClick={() => setToast(null)}><Icon name="close" size={14} /></button></div>
          )}
        </Viewer>

        {ready && !failedAll && (
          <div class="dock">
            {st.mode === 'sky' && (
              <div class="dock-sky">
                <p>The deepest picture of this patch: {plural(store.loaded, 'exposure')} from {plural(nv, 'visit')} added together, so faint things show up. Moving stars smear into short streaks: switch to <button class="link" onClick={() => set({ mode: 'time' })}>Time</button> to watch them move.</p>
                {lookFor && <p class="lookfor"><span class="chip amber">Look for: {lookFor.what}</span>{lookFor.hint}</p>}
                <Legend display={display} />
              </div>
            )}
            {st.mode === 'time' && (
              <div class="dock-time">
                <div class="dock-row">
                  {canCompare ? (
                    <div class="seg" role="group" aria-label="How to compare" data-tour="views">
                      {VIEWS.map((v) => <button aria-pressed={view === v} onClick={() => set({ view: v })}>{VIEW_LABEL[v]}</button>)}
                    </div>
                  ) : (
                    <div class="seg" role="group" aria-label="How to view" data-tour="views">
                      {(['play', 'exposures'] as View[]).map((v) => <button aria-pressed={view === v} onClick={() => set({ view: v })}>{VIEW_LABEL[v]}</button>)}
                    </div>
                  )}
                  {COMPARE_VIEWS.includes(view) && (
                    <div class="ab-pick" role="group" aria-label="Visits to compare">
                      <label><b class="ab a">A</b><select class="select sm" value={A} onChange={(e) => set({ a: +(e.target as HTMLSelectElement).value })} aria-label="Visit A">
                        {visits.map((v) => <option value={v.i}>Visit {v.i + 1} · {fmtMonth(v.mjd)}</option>)}</select></label>
                      <button class="iconbtn sm" title="Swap A and B" aria-label="Swap A and B" onClick={() => set({ a: B, b: A })}><Icon name="swap" size={16} /></button>
                      <label><b class="ab b">B</b><select class="select sm" value={B} onChange={(e) => set({ b: +(e.target as HTMLSelectElement).value })} aria-label="Visit B">
                        {visits.map((v) => <option value={v.i}>Visit {v.i + 1} · {fmtMonth(v.mjd)}</option>)}</select></label>
                    </div>
                  )}
                  <span class="spacer" />
                  {playable && seqLen > 1 && (
                    <div class="transport" role="group" aria-label="Playback">
                      <button class="iconbtn" aria-label="Previous (←)" title="Previous (←)" onClick={() => stepBy(-1)}><Icon name="prev" /></button>
                      <button class="play" aria-label={playing ? 'Pause (space)' : 'Play (space)'} title={playing ? 'Pause (space)' : 'Play (space)'} onClick={togglePlay}><Icon name={playing ? 'pause' : 'play'} size={20} /></button>
                      <button class="iconbtn" aria-label="Next (→)" title="Next (→)" onClick={() => stepBy(1)}><Icon name="next" /></button>
                      <select class="select sm" value={fps} onChange={(e) => setFps(+(e.target as HTMLSelectElement).value)} aria-label="Speed">
                        {[0.5, 1, 2, 4, 8, 12].map((v) => <option value={v}>{v < 1 ? 'Slow' : `${v}/s`}</option>)}
                      </select>
                      <button class="iconbtn" onClick={saveGif} disabled={gifBusy || loading} aria-label={gifBusy ? 'Making GIF…' : 'Save as GIF'} title={gifBusy ? 'Making GIF…' : loading ? 'Save as GIF (once all images are in)' : 'Save as GIF'}><Icon name="download" /></button>
                    </div>
                  )}
                  {view === 'blink' && !playing && (
                    <label class="fade"><b class="ab b">B</b><input type="range" min={0} max={1} step={0.01} value={mix} onInput={(e) => setMix(+(e.target as HTMLInputElement).value)} aria-label="Fade between visit B and visit A" /><b class="ab a">A</b></label>
                  )}
                </div>
                <Timeline visits={visits} band={band} view={view} cur={cur} exposures={exposures} a={A} b={B}
                  onVisit={(i) => {
                    if (view === 'play') { setPlaying(false); setIdx(i); }
                    else if (COMPARE_VIEWS.includes(view)) { if (i === A || i === B) return; set(Math.abs(i - A) <= Math.abs(i - B) ? { a: i } : { b: i }); }
                  }}
                  onExposure={(k) => { setPlaying(false); setIdx(k); }} />
                <p class="tip">{tipFor(view, target, visits, A, B, band, canCompare)}</p>
              </div>
            )}
            {st.mode === 'spectrum' && result && (
              <SpectrumLab result={result} visits={visits} store={store} n={n} target={target} center={center} probe={probe} setProbe={setProbe} targetPx={targetPx}
                onShowExposure={(f) => { pendingExposure.current = f.id; set({ mode: 'time', view: 'exposures', colours: band && f.det !== band ? 'all' : st.colours }); }} />
            )}
            {st.mode === 'movers' && (
              <MoversPanel cands={cands} yours={yours} finding={finding} canRun={canCompare && store.loaded > 0} onRun={runMovers}
                runNote={!canCompare ? 'Needs at least two visits.' : loading ? `Best once all images are in (${store.loaded} of ${store.total}).` : `${plural(nv, 'visit')} · ${plural(store.loaded, 'image')} ready.`}
                pick={pick} onPick={choose} marking={marking} setMarking={setMarking} reviews={reviews} reviewOf={reviewOf} setReview={setReview}
                targetName={target?.name ?? 'target'} loaded={store.loaded} total={store.total} />
            )}
          </div>
        )}
      </section>

      {insp && <div class="scrim" onClick={closeInsp} aria-hidden="true" />}
      <Inspector mode={st.mode} open={insp} onClose={closeInsp} target={target} lookFor={lookFor} result={result} visits={visits} store={store}
        cur={shown} n={n} fov={st.fov} center={center} probe={probe} setProbe={setProbe} targetPx={targetPx}
        showBad={display.bad} setShowBad={(b) => setDisplay((d) => ({ ...d, bad: b }))}
        cand={st.mode === 'movers' ? picked : null} reviewOf={reviewOf} setReview={setReview} onRemoveMark={removeMark} irsa={irsa} />
      {tour && <Tour onClose={() => setTour(false)} />}
    </div>
  );
}

function tipFor(view: View, t: Target | null, visits: ReturnType<typeof groupVisits>, A: number, B: number, band: number, canCompare: boolean): string {
  const name = t?.name ?? 'the target';
  const bandNote = band ? ` Only band ${band} is shown.` : '';
  if (!canCompare) return `SPHEREx has visited this spot once so far; it returns about every six months, so comparisons need a later pass.${bandNote}`;
  if (A === B && (view === 'blink' || view === 'side' || view === 'diff')) return `A and B are the same visit (visit ${A + 1}), so nothing can differ between them. Pick another visit for A or B, or click one on the ruler.`;
  const gap = visits[A] && visits[B] ? fmtGap(Math.abs(visits[A].mjd - visits[B].mjd)) : '';
  switch (view) {
    case 'blink': return `Flipping between visit B and visit A, ${gap} apart. Anything that jumps is moving across the sky; anything that brightens or fades is changing. The amber ring marks where ${name} should be on each date. Pause to fade between them.${bandNote}`;
    case 'play': return `Each picture adds up every exposure from one visit; visits are months apart. Click a visit on the ruler to jump to it.${bandNote}`;
    case 'exposures': return 'Every single exposure in time order. SPHEREx measures a different wavelength in each, so brightness changes from frame to frame: watch positions, not brightness.';
    case 'side': return `Visit B on the left and visit A on the right: the same patch of sky, ${gap} apart, at the same zoom.${bandNote}`;
    case 'diff': return `Visit A minus visit B. Orange = brighter in A, blue = brighter in B, black = no change. A moving star leaves an orange-and-blue pair; a star that changed brightness turns one colour.${bandNote}`;
  }
}

function Legend({ display }: { display: Display }) {
  const items = [
    display.ring && ['ring', 'Where the target should be'],
    display.gaia && ['gaia', 'Gaia DR3 stars, moved to each date'],
    display.wise && ['wise', 'CatWISE2020 sources'],
    display.bad && ['bad', 'Pixels SPHEREx flags as bad'],
  ].filter(Boolean) as Array<[string, string]>;
  if (!items.length) return null;
  return <ul class="legend" aria-label="Overlay key">{items.map(([k, l]) => <li><i class={'key ' + k} />{l}</li>)}</ul>;
}

function DisplayMenu({ display, setDisplay, err, loadingCats }: { display: Display; setDisplay: (f: (d: Display) => Display) => void; err: string; loadingCats: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector<HTMLButtonElement>('button')?.focus(); } };
    addEventListener('pointerdown', down); addEventListener('keydown', key);
    return () => { removeEventListener('pointerdown', down); removeEventListener('keydown', key); };
  }, [open]);
  const tog = (k: 'ring' | 'gaia' | 'wise' | 'bad' | 'smooth') => (e: Event) => { const v = (e.target as HTMLInputElement).checked; setDisplay((d) => ({ ...d, [k]: v })); };
  return (
    <div class="menu-wrap" ref={ref}>
      <button class={'btn sm display-btn' + (open ? ' on' : '')} aria-expanded={open} aria-controls={open ? 'display-menu' : undefined} onClick={() => setOpen(!open)}><Icon name="sliders" size={16} />Display</button>
      {open && (
        <div class="menu" id="display-menu" role="group" aria-label="Display options">
          <p class="menu-h">Overlays</p>
          <label class="check"><input type="checkbox" checked={display.ring} onChange={tog('ring')} /><i class="key ring" />Target position</label>
          <label class="check"><input type="checkbox" checked={display.gaia} onChange={tog('gaia')} /><i class="key gaia" />Gaia DR3 stars</label>
          <label class="check"><input type="checkbox" checked={display.wise} onChange={tog('wise')} /><i class="key wise" />CatWISE sources</label>
          <label class="check"><input type="checkbox" checked={display.bad} onChange={tog('bad')} /><i class="key bad" />Bad pixels (quality flags)</label>
          {loadingCats && <p class="note">Loading catalogue…</p>}
          {err && <p class="note warn-t">{err}</p>}
          <p class="menu-h">Picture</p>
          <label class="range">Contrast<input type="range" min={4} max={200} step={1} value={display.contrast} onInput={(e) => { const v = +(e.target as HTMLInputElement).value; setDisplay((d) => ({ ...d, contrast: v })); }} /></label>
          <label class="check"><input type="checkbox" checked={display.smooth} onChange={tog('smooth')} />Clear display <span class="sub">(bicubic upscaling for display; untick for exact SPHEREx pixels; data unchanged)</span></label>
        </div>
      )}
    </div>
  );
}

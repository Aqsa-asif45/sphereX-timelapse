import { render } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import './styles.css';
import * as api from './api';
import type { Featured, FindProgress, FindResult, Target } from './api';
import { positionAt, REF_MJD } from './astro';
import type { Colours } from './scene';
import { FOVS, Workspace, type Mode, type Phase } from './Workspace';

const COLOURS: Colours[] = ['all', 'six', 'rgb', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6'];

/** URL state: everything needed to reproduce a view, so links and embeds just work.
 *  ?q=<name or coordinates>  or  ?ra=<deg>&dec=<deg>, plus fov, mode, colours, embed. */
function readUrl() {
  const p = new URLSearchParams(location.search);
  const num = (k: string) => (p.has(k) && Number.isFinite(+p.get(k)!) ? +p.get(k)! : undefined);
  const ra = num('ra'), dec = num('dec');
  const band = num('band'); // older links
  return {
    q: p.get('q') || (ra !== undefined && dec !== undefined ? `${ra} ${dec}` : ''),
    fov: FOVS.includes(num('fov') ?? 0) ? num('fov')! : 4,
    mode: (['visits', 'frames', 'combine'].includes(p.get('mode') || '') ? p.get('mode') : 'visits') as Mode,
    colours: (COLOURS.includes(p.get('colours') as Colours) ? p.get('colours') : band ? `d${band}` : 'all') as Colours,
    embed: p.get('embed') === '1',
  };
}
function writeUrl(s: { q: string; fov: number; mode: Mode; colours: Colours; embed: boolean }) {
  const p = new URLSearchParams();
  const c = s.q.match(/^\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*$/);
  if (c) { p.set('ra', c[1]); p.set('dec', c[2]); } else if (s.q) p.set('q', s.q);
  if (s.fov !== 4) p.set('fov', String(s.fov));
  if (s.mode !== 'visits') p.set('mode', s.mode);
  if (s.colours !== 'all') p.set('colours', s.colours);
  if (s.embed) p.set('embed', '1');
  const u = `${location.pathname}${p.toString() ? '?' + p : ''}`;
  if (u !== location.pathname + location.search) history.replaceState(null, '', u);
}

function App() {
  const init = useMemo(readUrl, []);
  const [query, setQuery] = useState(init.q);
  const [fov, setFov] = useState(init.fov);
  const [mode, setMode] = useState<Mode>(init.mode);
  const [colours, setColours] = useState<Colours>(init.colours);
  const [embed] = useState(init.embed);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [target, setTarget] = useState<Target | null>(null);
  const [result, setResult] = useState<FindResult | null>(null);
  const [progress, setProgress] = useState<FindProgress | null>(null);
  const [featuredList, setFeatured] = useState<Featured[]>([]);
  const [panel, setPanel] = useState(innerWidth > 900);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { api.featured().then(setFeatured).catch(() => {}); }, []);
  useEffect(() => { writeUrl({ q: target ? query : '', fov, mode, colours, embed }); }, [query, fov, mode, colours, embed, target]);

  const open = useCallback(async (q: string) => {
    q = q.trim();
    if (!q) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setQuery(q); setError(''); setResult(null); setProgress(null); setTarget(null); setPhase('resolving');
    try {
      const t = await api.resolveTarget(q, ac.signal);
      setTarget(t); setPhase('finding');
      const [rc, dc] = positionAt(t, REF_MJD);
      const r = await api.findFrames(rc, dc, setProgress, ac.signal);
      if (ac.signal.aborted) return;
      setResult(r); setPhase('ready');
    } catch (e) {
      if (ac.signal.aborted) return;
      setError((e as Error).message); setPhase('error');
    }
  }, []);

  useEffect(() => { if (init.q) open(init.q); }, []);
  const goHome = () => { abortRef.current?.abort(); setPhase('idle'); setTarget(null); setResult(null); setQuery(''); history.replaceState(null, '', location.pathname); };

  return (
    <>
      {!embed && (
        <header class="top">
          <a class="brand" href="/" onClick={(e) => { e.preventDefault(); goHome(); }}>
            <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="10" fill="none" stroke="#ffb84d" stroke-width="2.4" /><circle cx="22" cy="11.5" r="2.8" fill="#ffe2ad" /><circle cx="10.5" cy="19.5" r="1.6" fill="#7d8bff" /></svg>
            <span><b>SPHEREx Time-Lapse</b><small>Spot what moves in NASA's infrared sky</small></span>
          </a>
          <form class="search" role="search" onSubmit={(e) => { e.preventDefault(); open(query); }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <label class="sr" for="q">Star name or sky coordinates</label>
            <input id="q" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} placeholder="A star name, or coordinates like 08h55m10.8s −07d14m42s" autocomplete="off" spellcheck={false} />
            <button type="submit">Show me</button>
          </form>
        </header>
      )}
      {phase === 'idle' ? (
        <Welcome featured={featuredList} onPick={(n) => open(n)} />
      ) : (
        <Workspace {...{ phase, error, target, result, progress, fov, setFov, mode, setMode, colours, setColours, panel: panel && !embed, setPanel, embed, retry: () => open(query) }} />
      )}
    </>
  );
}

function Welcome({ featured, onPick }: { featured: Featured[]; onPick: (n: string) => void }) {
  return (
    <main class="welcome">
      <h1>Watch the infrared sky <em>change</em>.</h1>
      <p class="lede">NASA's SPHEREx telescope photographs the whole sky every six months in 102 colours of infrared light. Pick a target and see its patch of sky as a time-lapse. Anything that shifts or changes between visits is worth a closer look.</p>
      <div class="cards">
        {featured.map((f) => (
          <button class="card" key={f.slug} onClick={() => onPick(f.name)}>
            <span class="thumb"><img src={`/api/preview?slug=${f.slug}`} alt="" loading="lazy" width={156} height={156} onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} /></span>
            <b>{f.name}</b>
            <span class="kind">{f.kind}</span>
            <p>{f.blurb}</p>
            <span class="go">Show time-lapse →</span>
          </button>
        ))}
      </div>
      <div class="how">
        <div><span class="n">1</span><b>Choose a spot</b>Type a star's name or its coordinates, or pick a target above.</div>
        <div><span class="n">2</span><b>Watch it blink</b>Each image adds up one SPHEREx visit; visits are months apart. Moving things jump.</div>
        <div><span class="n">3</span><b>Dig deeper</b>Split the 102 colours into bands, subtract visits, measure a spectrum, overlay Gaia and WISE.</div>
      </div>
    </main>
  );
}

render(<App />, document.getElementById('app')!);

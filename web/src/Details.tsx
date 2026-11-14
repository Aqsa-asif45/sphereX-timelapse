import { useMemo, useState } from 'preact/hooks';
import type { CatResult, FindResult, Target } from './api';
import { BANDS, fmtDate, fmtDateTime, fmtDec, fmtRa, gridToSky, PIXEL_ARCSEC, wlColor, wlGradient, type Visit } from './astro';
import { exportCsv, exportJson, type Candidate } from './candidates';
import { Chart, type Series } from './Chart';
import type { FrameStore } from './data';
import { BAD_BITS, INFO_BITS } from './render';
import type { Item } from './scene';
import { SkyMap } from './SkyMap';
import { compass } from './movers';
import type { FoundHere } from './Workspace';

const VISIT_COLOURS = ['#ffb84d', '#6ec3ff', '#7fdca4', '#ff7a6b', '#c792ff', '#f6d746', '#9aa6bb'];

interface Props {
  target: Target | null; result: FindResult | null; cur?: Item; visits: Visit[]; store: FrameStore;
  science: { pts: Array<{ f: FindResult['frames'][number]; v: number; flux: number }> } | null;
  probe: [number, number] | null; setProbe: (p: [number, number] | null) => void; n: number; center: [number, number] | null;
  cands: Candidate[]; setCands: (f: (l: Candidate[]) => Candidate[]) => void;
  cats: { gaia?: CatResult | null; wise?: CatResult | null; err: Record<string, string> }; overlays: { gaia: boolean; wise: boolean; bad: boolean };
  fov: number; targetPx: (mjd: number) => [number, number] | null;
  finds: FoundHere[] | null; pick: number; setPick: (k: number) => void; saveFind: (f: FoundHere) => void;
}

function FindsSection({ finds, pick, setPick, saveFind, setProbe, loaded, total }: { finds: FoundHere[]; pick: number; setPick: (k: number) => void; saveFind: (f: FoundHere) => void; setProbe: (p: [number, number] | null) => void; loaded: number; total: number }) {
  const [saved, setSaved] = useState<number[]>([]);
  const kept = finds.map((f, k) => [f, k] as const).filter(([f]) => !f.dismissed), dropped = finds.map((f, k) => [f, k] as const).filter(([f]) => f.dismissed);
  const movers = kept.filter(([f]) => f.kind === 'moving').length;
  const item = ([f, k]: readonly [FoundHere, number]) => (
          <li class={k === pick ? 'on' : ''}>
            <b>{f.kind === 'moving' ? `Moving ${f.rate.toFixed(1)}″ per year toward the ${compass(f.pa)}` : `Seen only in visit ${f.visits[0] + 1}`}</b>
            <span class="note">
              {f.kind === 'moving' ? `Shifted ${f.shift.toFixed(1)} px over ${f.visits.length} visits · confidence ${Math.min(99, f.sig).toFixed(0)}×` : `Signal ${f.sig.toFixed(0)}× the noise. Could be an asteroid or comet passing through, or a glitch.`}
              {f.gaia
                ? f.kind === 'moving' && f.gaia.pm < 50
                  ? <> · <span class="warn-t">Gaia sees a star here that does not move</span>: probably a false alarm (glare or a blend of two stars).</>
                  : <> · <span class="ok">Known star in Gaia</span> (G {f.gaia.g.toFixed(1)}{f.gaia.pm > 50 ? `, moves ${(f.gaia.pm / 1000).toFixed(2)}″/yr` : ''})</>
                : f.gaia === null ? <> · <span class="hot">Not in Gaia: worth a closer look</span></> : null}
            </span>
            <span class="row">
              <button class="link" onClick={() => { setPick(k); setProbe([(f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2]); }}>Show &amp; measure</button>
              <button class="link" disabled={saved.includes(k)} onClick={() => { saveFind(f); setSaved((s) => [...s, k]); }}>{saved.includes(k) ? 'Saved' : 'Save to my list'}</button>
            </span>
          </li>
  );
  return (
    <section data-tour="finds">
      <h3>Things that moved or appeared</h3>
      {kept.length === 0
        ? <p class="note">Nothing here clearly moved between visits, and nothing appeared in just one visit: this patch looks still.{loaded < total ? ` (Checked with ${loaded} of ${total} images loaded; try again when all have loaded.)` : ''}</p>
        : <p class="note">{movers} moving, {kept.length - movers} seen only once. Pink arrows on the image show where each mover went; dashed circles mark one-visit objects.</p>}
      <ul class="finds">{kept.map(item)}</ul>
      {dropped.length > 0 && (
        <details class="dismissed">
          <summary>{dropped.length} more ruled out using Gaia (known, steady stars)</summary>
          <p class="note">Small apparent shifts can come from glare or two stars blending, and saturated stars can look like they come and go. Gaia measures these stars far more precisely, so they are almost certainly not real changes.</p>
          <ul class="finds">{dropped.map(item)}</ul>
        </details>
      )}
    </section>
  );
}

export function Details(p: Props) {
  const { target, result, cur, visits, store, science } = p;
  const [tab, setTab] = useState<'spectrum' | 'time'>('spectrum');
  const [copied, setCopied] = useState('');
  const [sky, setSky] = useState(false);
  const copy = (what: string, text: string) => { navigator.clipboard?.writeText(text).then(() => { setCopied(what); setTimeout(() => setCopied(''), 1500); }); };
  const f = cur?.frames.length === 1 && !cur.ref ? cur.frames[0] : null;
  const embedUrl = `${location.origin}${location.pathname}?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(location.search)), embed: '1' })}`;
  const c0 = (p.n - 1) / 2;
  const probeSky = p.probe && p.center ? gridToSky(p.center[0], p.center[1], p.probe[0] - c0, p.probe[1] - c0, PIXEL_ARCSEC) : null;

  // spectrum: one series per visit; brightness over time: one series per detector band
  const spectrum: Series[] = useMemo(() => {
    if (!science) return [];
    return visits.map((v) => ({
      name: `Visit ${v.i + 1}`, color: VISIT_COLOURS[v.i % VISIT_COLOURS.length], line: true,
      points: science.pts.filter((x) => x.v === v.i).map((x) => ({ x: x.f.lambda, y: x.flux, label: `${x.f.lambda.toFixed(2)} µm · ${fmtDate(x.f.mjd)}: ${x.flux.toFixed(0)} µJy` })),
    })).filter((s) => s.points.length);
  }, [science, visits]);
  const lightcurve: Series[] = useMemo(() => {
    if (!science) return [];
    return BANDS.map((b) => {
      const pts = visits.map((v) => {
        const xs = science.pts.filter((x) => x.v === v.i && x.f.det === b.det).map((x) => x.flux);
        if (!xs.length) return null;
        xs.sort((a, c) => a - c);
        return { x: v.mjd, y: xs[xs.length >> 1], label: `${b.lo.toFixed(1)}–${b.hi.toFixed(1)} µm · ${fmtDate(v.mjd)}: ${xs[xs.length >> 1].toFixed(0)} µJy (${xs.length})` };
      }).filter((x): x is NonNullable<typeof x> => !!x);
      return { name: `${b.lo.toFixed(1)}–${b.hi.toFixed(1)} µm`, color: wlColor((b.lo + b.hi) / 2), line: true, points: pts };
    }).filter((s) => s.points.length);
  }, [science, visits]);

  // flags at the probe (or target) pixel for the frames on screen
  const flagsHere = useMemo(() => {
    if (!cur) return null;
    const at = p.probe ?? p.targetPx(cur.mjd);
    if (!at) return null;
    const i = Math.round(at[1]) * p.n + Math.round(at[0]);
    const counts = new Map<number, number>();
    let withFlags = 0;
    for (const fr of [...cur.frames, ...(cur.ref ?? [])]) {
      const d = store.get(fr.id);
      if (!d?.flags) continue;
      withFlags++;
      const v = d.flags[i];
      if (v > 0) for (let b = 0; b < 24; b++) if (v & (1 << b)) counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    return { withFlags, counts: [...counts.entries()].sort((a, b) => b[1] - a[1]) };
  }, [cur, p.probe, store.version]);

  // can this spectrum be trusted? Very bright stars saturate SPHEREx: their centre pixels are
  // blanked, or flagged as overflowing / non-linear.
  const quality = useMemo(() => {
    if (!science || !result) return null;
    const loadedFrames = result.frames.filter((f) => store.get(f.id)).length;
    const blank = loadedFrames - science.pts.length;
    // a typical high value (80th percentile), not the maximum: one cosmic-ray hit should not trigger the caution
    const sorted = science.pts.map((x) => x.flux).sort((a, b) => a - b), maxFlux = sorted.length ? sorted[Math.floor(sorted.length * 0.8)] : 0;
    let flagged = 0, withFlags = 0;
    for (const fr of result.frames) {
      const d = store.get(fr.id), at = p.probe ?? p.targetPx(fr.mjd);
      if (!d?.flags || !at) continue;
      withFlags++;
      const v = d.flags[Math.round(at[1]) * p.n + Math.round(at[0])];
      if (v > 0 && v & ((1 << 1) | (1 << 15))) flagged++; // OVERFLOW, NONLINEAR
    }
    return { loadedFrames, blank, measured: science.pts.length, maxFlux, flagged, withFlags };
  }, [science, store.version, p.probe]);

  return (
    <aside class="details" aria-label="Details">
      {p.finds && result && <FindsSection finds={p.finds} pick={p.pick} setPick={p.setPick} saveFind={p.saveFind} setProbe={p.setProbe} loaded={store.loaded} total={result.frames.length} />}
      {target && (
        <section>
          <h3>Target</h3>
          <dl class="kv">
            <dt>Name</dt><dd>{target.name}</dd>
            <dt>RA</dt><dd class="mono">{fmtRa(target.ra)}</dd>
            <dt>Dec</dt><dd class="mono">{fmtDec(target.dec)}</dd>
            {target.pmra || target.pmdec ? <><dt>Moves</dt><dd class="num">{(Math.hypot(target.pmra ?? 0, target.pmdec ?? 0) / 1000).toFixed(2)}″ per year</dd></> : null}
          </dl>
          <p class="note">Position: {target.source}.</p>
        </section>
      )}

      {result && (
        <section data-tour="spectrum">
          <div class="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'spectrum'} onClick={() => setTab('spectrum')}>Spectrum</button>
            <button role="tab" aria-selected={tab === 'time'} onClick={() => setTab('time')}>Brightness over time</button>
          </div>
          <p class="note" style={{ marginTop: 0 }}>
            {p.probe ? <>At the point you clicked{probeSky ? <> (<span class="mono">{probeSky[0].toFixed(4)}°, {probeSky[1].toFixed(4)}°</span>)</> : null}. <button class="link" onClick={() => p.setProbe(null)}>Back to the target</button></>
              : <>At the target{target?.pmra || target?.pmdec ? ', following its motion' : ''}. Click anywhere on the image to measure there instead.</>}
          </p>
          {quality && (quality.withFlags > 0 && quality.flagged / quality.withFlags > 0.2
            ? <p class="warnbox"><b>Saturated:</b> in {quality.flagged} of {quality.withFlags} exposures SPHEREx flags this spot as overflowing or non-linear (too bright to measure). Treat this curve as unreliable.</p>
            : quality.loadedFrames > 0 && quality.blank / quality.loadedFrames > 0.25
              ? <p class="warnbox"><b>Too bright for SPHEREx:</b> the centre is blank (saturated) in {quality.blank} of {quality.loadedFrames} exposures, so only {quality.measured} could be measured, and those are likely low.</p>
              : quality.maxFlux > 3e5
                ? <p class="cautionbox"><b>Very bright:</b> stars this bright can saturate SPHEREx. Turn on “Bad pixels” (under More) to check before trusting the curve.</p>
                : null)}
          {tab === 'spectrum'
            ? <Chart series={spectrum} xLabel="Wavelength (µm)" yLabel="Flux (µJy)" xMin={0.7} xMax={5.05} ariaLabel="Spectrum: brightness against wavelength" />
            : <Chart series={lightcurve} xLabel="Date" yLabel="Flux (µJy)" xFmt={(x) => new Date((x - 40587) * 864e5).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })} ariaLabel="Brightness over time, one line per wavelength band" />}
          <p class="note">{tab === 'spectrum'
            ? `Every exposure measures one colour, so ${science?.pts.length ?? 0} exposures build up a spectrum on the fly. Aperture 1.6 px (≈10″), sky subtracted.`
            : 'Median brightness per visit in each of the six bands. A variable star rises and falls in every band; a steady star stays flat.'}</p>
        </section>
      )}

      {cur && (
        <section>
          <h3>This image</h3>
          <dl class="kv">
            <dt>{f ? 'Taken' : 'Dates'}</dt><dd>{f ? fmtDateTime(f.mjd) : cur.sub}</dd>
            {f ? <>
              <dt>Wavelength</dt><dd class="num">{f.lambda.toFixed(3)} µm <span style={{ color: 'var(--mute)' }}>± {(f.dlambda / 2).toFixed(3)}</span></dd>
              <dt>Detector</dt><dd>D{f.det} ({f.det <= 3 ? 'short-wave' : 'long-wave'})</dd>
              <dt>Release</dt><dd>{f.release.toUpperCase()}</dd>
              <dt>Exposure</dt><dd class="mono">{f.folder}_{String(f.obs).padStart(4, '0')}_{f.exp}</dd>
              <dt>On detector</dt><dd class="num mono">x {f.x.toFixed(1)}, y {f.y.toFixed(1)}</dd>
            </> : <>
              <dt>Exposures</dt><dd class="num">{cur.frames.length}{cur.ref ? ` and ${cur.ref.length}` : ''}</dd>
              <dt>Wavelengths</dt><dd class="num">{Math.min(...cur.frames.map((x) => x.lambda)).toFixed(2)}–{Math.max(...cur.frames.map((x) => x.lambda)).toFixed(2)} µm</dd>
            </>}
          </dl>
          <h3 style={{ marginTop: '.9rem' }}>Data-quality flags {p.probe ? 'at the clicked point' : 'at the target'}</h3>
          {!p.overlays.bad || !flagsHere || flagsHere.withFlags === 0
            ? <p class="note">{p.overlays.bad ? 'Loading flags…' : 'Turn on “Bad pixels” to load SPHEREx’s per-pixel quality flags.'}</p>
            : flagsHere.counts.length === 0 ? <p class="note">No flags here in {flagsHere.withFlags} exposure{flagsHere.withFlags === 1 ? '' : 's'}: clean data.</p>
              : <div class="flags">{flagsHere.counts.map(([b, c]) => <span class={BAD_BITS[b] ? 'warn' : ''} title={`bit ${b}`}>{BAD_BITS[b] ?? INFO_BITS[b] ?? `bit ${b}`} · {c}/{flagsHere.withFlags}</span>)}</div>}
          {f && <p class="note"><a href={`https://nasa-irsa-spherex.s3.amazonaws.com/${f.key}`} rel="noopener">Original file</a> (≈72 MB FITS, from NASA's AWS archive)</p>}
        </section>
      )}

      {(p.overlays.gaia || p.overlays.wise) && (
        <section>
          <h3>Overlays</h3>
          {p.overlays.gaia && <p class="note"><i class="dot" style={{ borderColor: '#6ec3ff' }} />{p.cats.gaia ? `${p.cats.gaia.rows.length} Gaia DR3 stars (G < 20), placed at this image's date using their measured motion; arrows show fast movers over the whole data set. ${p.cats.gaia.source}.` : 'Loading Gaia…'}</p>}
          {p.overlays.wise && <p class="note"><i class="sq" style={{ borderColor: '#7fdca4' }} />{p.cats.wise ? `${p.cats.wise.rows.length} CatWISE2020 sources (W2 < 17, 4.6 µm), positions near 2015. ${p.cats.wise.source}.` : 'Loading WISE…'}</p>}
        </section>
      )}

      {p.cands.length > 0 && (
        <section>
          <h3>Things you spotted ({p.cands.length})</h3>
          <ul class="cands">
            {p.cands.map((c) => (
              <li>
                <div><b>{c.target}</b> <span class="mono">{c.ra.toFixed(4)}°, {c.dec.toFixed(4)}°</span></div>
                <div class="note" style={{ margin: 0 }}>{c.view}</div>
                <input placeholder="Add a note (what did you see?)" value={c.note} onInput={(e) => { const v = (e.target as HTMLInputElement).value; p.setCands((l) => l.map((x) => (x.id === c.id ? { ...x, note: v } : x))); }} />
                <button class="link" onClick={() => p.setCands((l) => l.filter((x) => x.id !== c.id))}>Remove</button>
              </li>
            ))}
          </ul>
          <div style={{ display: 'flex', gap: '.5rem' }}>
            <button class="btn" onClick={() => exportCsv(p.cands)}>Export CSV</button>
            <button class="btn" onClick={() => exportJson(p.cands)}>Export JSON</button>
          </div>
        </section>
      )}

      {result && (
        <section>
          <h3>Data</h3>
          <dl class="kv">
            <dt>Exposures</dt><dd class="num">{result.frames.length} in {visits.length} visit{visits.length === 1 ? '' : 's'}</dd>
            <dt>Loaded</dt><dd class="num">{store.loaded}{store.failed ? ` (${store.failed} failed)` : ''}</dd>
            <dt>Found via</dt><dd>{result.source === 'irsa' ? "IRSA's archive search" : result.source === 'both' ? "IRSA's archive search + local sky index" : 'local sky index (AWS)'}</dd>
            {result.source === 'index' && <><dt>Index covers</dt><dd class="num">{result.indexed} of {result.folders} weeks</dd></>}
            {result.observations?.available > result.observations?.checked && <><dt>Sampled</dt><dd class="num">{result.observations.checked} of {result.observations.available} exposures</dd></>}
            {result.failed > 0 && <><dt>Not reached</dt><dd class="num">{result.failed} (network)</dd></>}
          </dl>
          <div class="legend" style={{ background: wlGradient }} aria-hidden="true" />
          <div class="legend-l"><span>0.75 µm</span><span>Timeline colours = wavelength</span><span>5 µm</span></div>
        </section>
      )}

      {p.center && (
        <section>
          <h3>Sky around it</h3>
          {sky ? <SkyMap ra={p.center[0]} dec={p.center[1]} fovArcmin={p.fov} /> : <button class="btn" onClick={() => setSky(true)}>Open sky map (Aladin)</button>}
        </section>
      )}

      <section>
        <h3>Share</h3>
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          <button class="btn" onClick={() => copy('link', location.href)}>{copied === 'link' ? 'Copied!' : 'Copy link'}</button>
          <button class="btn" onClick={() => copy('embed', `<iframe src="${embedUrl}" width="760" height="720" style="border:0" title="SPHEREx time-lapse"></iframe>`)}>{copied === 'embed' ? 'Copied!' : 'Copy embed code'}</button>
        </div>
        <p class="note">Links carry the position, field, mode and colours, e.g. <span class="mono">?ra=133.79&amp;dec=-7.24&amp;fov=6</span>.</p>
      </section>
    </aside>
  );
}

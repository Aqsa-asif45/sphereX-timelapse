/** The right-hand inspector: what you are looking at, where every number came from, and data quality. */
import { useMemo, useState } from 'preact/hooks';
import type { FindResult, Target } from '../../web/src/api';
import { fmtDec, fmtRa, PIXEL_ARCSEC, type Visit } from '../../web/src/astro';
import { BAD_BITS, INFO_BITS } from '../../web/src/render';
import type { Item } from '../../web/src/scene';
import { SkyMap } from '../../web/src/SkyMap';
import { Icon } from './icons';
import { describe, gaiaVerdict, REVIEWS, why, type Cand, type Review, type ReviewRec } from './movers';
import type { Store } from './store';
import { coverageOf, fmtDateTime, fmtSpan, plural, type Mode } from './util';

interface Props {
  mode: Mode; open: boolean; onClose: () => void;
  target: Target | null; lookFor?: { what: string; hint: string };
  result: FindResult | null; visits: Visit[]; store: Store;
  cur: Item | null; n: number; fov: number; center: [number, number] | null;
  probe: [number, number] | null; setProbe: (p: [number, number] | null) => void;
  targetPx: (mjd: number) => [number, number] | null;
  showBad: boolean; setShowBad: (b: boolean) => void;
  cand: Cand | null; reviewOf: (c: Cand) => ReviewRec; setReview: (c: Cand, r: Partial<ReviewRec>) => void; onRemoveMark: (c: Cand) => void;
  irsa: boolean | null;
}

export function Inspector(p: Props) {
  const [sky, setSky] = useState(false);
  const [copied, setCopied] = useState(false);
  const { target, result, cur } = p;
  const single = cur && cur.frames.length === 1 && !cur.ref ? cur.frames[0] : null;
  const span = result?.frames.length ? [result.frames[0].mjd, result.frames[result.frames.length - 1].mjd] : null;
  const releases = result ? [...new Set(result.frames.map((f) => f.release.toUpperCase()))].join(', ') : '';
  const cov = result ? coverageOf(result) : null;

  // SPHEREx quality flags at the measured point, over the exposures on screen
  const flagsHere = useMemo(() => {
    if (!cur || !p.showBad) return null;
    const at = p.probe ?? p.targetPx(cur.mjd);
    if (!at) return null;
    const i = Math.round(at[1]) * p.n + Math.round(at[0]), counts = new Map<number, number>();
    let withFlags = 0;
    for (const fr of [...cur.frames, ...(cur.ref ?? [])]) {
      const d = p.store.get(fr.id);
      if (!d?.flags) continue;
      withFlags++;
      const v = d.flags[i];
      if (v > 0) for (let b = 0; b < 24; b++) if (v & (1 << b)) counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    return { withFlags, counts: [...counts.entries()].sort((a, b) => b[1] - a[1]) };
  }, [cur, p.probe?.[0], p.probe?.[1], p.store.version, p.showBad]);

  const copy = () => navigator.clipboard?.writeText(location.href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }).catch(() => {});
  const c = p.cand;

  return (
    <aside class={'inspector' + (p.open ? ' open' : '')} aria-label="Details" id="inspector">
      <div class="insp-head">
        <h2>Details</h2>
        <button class="iconbtn" aria-label="Close details" onClick={p.onClose}><Icon name="close" /></button>
      </div>

      {c && (
        <section class="insp-sec cand-detail">
          <h3><span class="mono">{c.id}</span> · {describe(c)}</h3>
          <p class="why">{why(c)}</p>
          <dl class="kv">
            <dt>Position</dt><dd class="mono">{fmtRa(c.ra)}<br />{fmtDec(c.dec)}</dd>
            {c.kind === 'moving' && <><dt>Shift</dt><dd class="mono">{(c.shift * PIXEL_ARCSEC).toFixed(1)}″ ({c.shift.toFixed(2)} px)</dd><dt>Motion</dt><dd class="mono">{c.rate.toFixed(2)}″ / yr</dd></>}
            {c.visits.length > 0 && <><dt>Visits used</dt><dd class="mono">{c.visits.map((v) => v + 1).join(', ')}</dd></>}
            {c.kind !== 'yours' && <><dt>Confidence</dt><dd class="mono">{Math.min(99, c.sig).toFixed(0)}× the noise</dd></>}
            <dt>Gaia DR3</dt><dd><span class={'chip ' + gaiaVerdict(c).tone}>{gaiaVerdict(c).text}</span>{c.gaia && <span class="sub mono"> G {c.gaia.g.toFixed(1)} · {c.gaia.sep.toFixed(1)}″ away</span>}</dd>
          </dl>
          {c.gaia === null && c.kind !== 'yours' && <p class="note">Not in Gaia does not mean new: Gaia sees visible light, and very cold objects such as brown dwarfs are often too faint for it.</p>}
          {c.dismissed && <p class="note">Gaia measures this star far more precisely and finds it steady, so the apparent change is almost certainly glare or two stars blending.</p>}
          <label class="field">Review status
            <select class="select" value={p.reviewOf(c).status} onChange={(e) => p.setReview(c, { status: (e.target as HTMLSelectElement).value as Review })}>
              {REVIEWS.map(([v, l]) => <option value={v}>{l}</option>)}
            </select>
          </label>
          <label class="field">Note
            <textarea rows={2} placeholder="What did you see?" value={p.reviewOf(c).note} onInput={(e) => p.setReview(c, { note: (e.target as HTMLTextAreaElement).value })} />
          </label>
          <p class="note">Measured in your browser from the SPHEREx images on screen. Saved on this device only.{c.kind === 'yours' && <> <button class="link" onClick={() => p.onRemoveMark(c)}>Remove this mark</button></>}</p>
        </section>
      )}

      {target && (
        <section class="insp-sec">
          <h3>Target</h3>
          <p class="insp-name">{target.name}{target.kind && <span>{target.kind}</span>}</p>
          {p.lookFor && <p class="lookfor"><span class="chip amber">Look for: {p.lookFor.what}</span>{p.lookFor.hint}</p>}
          <dl class="kv">
            <dt>RA</dt><dd class="mono">{fmtRa(target.ra)} <span class="sub">{target.ra.toFixed(5)}°</span></dd>
            <dt>Dec</dt><dd class="mono">{fmtDec(target.dec)} <span class="sub">{target.dec.toFixed(5)}°</span></dd>
            {(target.pmra || target.pmdec) ? <><dt>Moves</dt><dd class="mono">{(Math.hypot(target.pmra ?? 0, target.pmdec ?? 0) / 1000).toFixed(2)}″ per year</dd></> : null}
            {result && cov && <><dt>Coverage</dt><dd>
              <span class={'chip ' + cov.tone}>{cov.label}</span>
              {result.frames.length > 0 && <span class="sub"> {plural(result.frames.length, 'exposure')} in {plural(p.visits.length, 'visit')}</span>}
              <span class="sub" style={{ display: 'block', marginTop: '3px' }}>{cov.note}</span>
            </dd></>}
            {span && <><dt>Dates</dt><dd>{fmtSpan(span[0], span[1])}</dd></>}
          </dl>
          <p class="note">Position: {target.source}.{target.pmra || target.pmdec ? ' The amber ring shows where it should be on each date, using its known motion.' : ''}</p>
        </section>
      )}

      {cur && (
        <section class="insp-sec">
          <h3>On screen</h3>
          <dl class="kv">
            <dt>Showing</dt><dd>{cur.label}</dd>
            <dt>{single ? 'Taken' : 'Dates'}</dt><dd class={single ? 'mono' : ''}>{single ? fmtDateTime(single.mjd) : cur.sub}</dd>
            {single ? <>
              <dt>Wavelength</dt><dd class="mono">{single.lambda.toFixed(3)} µm ± {(single.dlambda / 2).toFixed(3)}</dd>
              <dt>Detector</dt><dd>Band {single.det} ({single.det <= 3 ? 'short-wave' : 'long-wave'} array)</dd>
              <dt>Release</dt><dd>{single.release.toUpperCase()} · {single.version}</dd>
              <dt>Exposure</dt><dd class="mono wrap">{single.folder}_{String(single.obs).padStart(4, '0')}_{single.exp}</dd>
              <dt>File</dt><dd><a href={`https://nasa-irsa-spherex.s3.amazonaws.com/${single.key}`} target="_blank" rel="noopener">Original FITS (≈72 MB) <Icon name="external" size={13} /></a></dd>
            </> : <>
              <dt>Exposures</dt><dd class="mono">{cur.frames.length}{cur.ref ? ` minus ${cur.ref.length}` : ''}</dd>
              {cur.frames.length > 0 && <><dt>Wavelengths</dt><dd class="mono">{Math.min(...cur.frames.map((x) => x.lambda)).toFixed(2)}–{Math.max(...cur.frames.map((x) => x.lambda)).toFixed(2)} µm</dd></>}
            </>}
            <dt>Field</dt><dd class="mono">{p.fov}′ × {p.fov}′ · {p.n}×{p.n} px</dd>
          </dl>
          {p.probe && <p class="note">Measuring at the point you clicked. <button class="link" onClick={() => p.setProbe(null)}>Back to the target</button></p>}
        </section>
      )}

      {result && result.frames.length > 0 && (
        <section class="insp-sec">
          <h3>Data quality</h3>
          <label class="check"><input type="checkbox" checked={p.showBad} onChange={(e) => p.setShowBad((e.target as HTMLInputElement).checked)} />Load SPHEREx quality flags (tints bad pixels cyan)</label>
          {p.showBad && p.store.flagsFailed > 0 && p.store.flagsLoaded + p.store.flagsFailed >= p.store.loaded && (
            <p class="note warn-t">Quality flags could not be loaded for {plural(p.store.flagsFailed, 'image')}. Untick and tick the box to try again.</p>
          )}
          {p.showBad && (!flagsHere || flagsHere.withFlags === 0
            ? (p.store.flagsLoaded + p.store.flagsFailed < p.store.loaded ? <p class="note">Loading flags… {p.store.flagsLoaded} of {p.store.loaded}</p> : null)
            : flagsHere.counts.length === 0
              ? <p class="note">No flags {p.probe ? 'at the clicked point' : 'at the target'} in {plural(flagsHere.withFlags, 'exposure')}: clean data.</p>
              : <div class="flags">{flagsHere.counts.map(([b, k]) => <span class={'chip ' + (BAD_BITS[b] ? 'warn' : 'mute')} title={`flag bit ${b}`}>{BAD_BITS[b] ?? INFO_BITS[b] ?? `bit ${b}`} · {k}/{flagsHere.withFlags}</span>)}</div>)}
          <p class="note">Loaded {p.store.loaded} of {result.frames.length} images{p.store.failed ? `; ${p.store.failed} could not be read` : ''}. Pixels SPHEREx left blank (saturated or missing) stay blank: nothing is filled in.</p>
        </section>
      )}

      {result && (
        <section class="insp-sec">
          <h3>Where this comes from</h3>
          <dl class="kv">
            <dt>Images</dt><dd>NASA SPHEREx {releases && <span class="sub">({releases})</span>}</dd>
            <dt>Found via</dt><dd>{result.source === 'irsa' ? "IRSA's archive search" : 'TimeLens sky index of the AWS archive'}</dd>
            {result.source === 'index' && <><dt>Index</dt><dd class="mono">{result.indexed} of {result.folders} weeks</dd></>}
            {result.observations?.available > result.observations?.checked && <><dt>Sampled</dt><dd class="mono">{result.observations.checked} of {result.observations.available} observations</dd></>}
            {result.failed > 0 && <><dt>Not reached</dt><dd class="mono">{result.failed} (network)</dd></>}
            {p.irsa !== null && <><dt>IRSA now</dt><dd>{p.irsa ? 'reachable' : 'unreachable (using the sky index)'}</dd></>}
          </dl>
          <p class="note">Cut from the original files in NASA's public archive on AWS (s3://nasa-irsa-spherex), turned north-up at SPHEREx's own {PIXEL_ARCSEC}″ pixels. Wavelengths come from each file's own wavelength table. <a href="/timelens/about">How TimeLens works</a></p>
        </section>
      )}

      {p.center && (
        <section class="insp-sec">
          <h3>Sky around it</h3>
          {sky ? <SkyMap ra={p.center[0]} dec={p.center[1]} fovArcmin={p.fov} />
            : <><button class="btn" onClick={() => setSky(true)}>Open the AllWISE sky map</button><p class="note">Another telescope's view of the wider area (Aladin Lite, about 2.4 MB). Not SPHEREx data.</p></>}
        </section>
      )}

      {target && (
        <section class="insp-sec">
          <h3>Share this view</h3>
          <button class="btn" onClick={copy}><Icon name="link" size={16} />{copied ? 'Link copied' : 'Copy link'}</button>
          <p class="note">The link keeps the target, field, mode, compared visits, colours and zoom.</p>
        </section>
      )}
    </aside>
  );
}

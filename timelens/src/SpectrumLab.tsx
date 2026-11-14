/**
 * Spectral Laboratory. SPHEREx's filters change wavelength across each detector, so every
 * exposure measures the target at a different wavelength: aperture photometry on all of them
 * builds a spectrum on the fly (one colour per visit), and per-band medians per visit give a
 * light curve for variable stars. Each point links back to the exposure it came from.
 */
import { useMemo, useState } from 'preact/hooks';
import type { FindResult, Frame, Target } from '../../web/src/api';
import { BANDS, gridToSky, PIXEL_ARCSEC, wlColor, type Visit } from '../../web/src/astro';
import { download } from '../../web/src/candidates';
import { Chart, FEATURES, type Series } from './Chart';
import { Icon } from './icons';
import type { Store } from './store';
import { fmtDateTime, fmtDay, fmtFlux, fmtMonth, measure, median, plural, timeColour } from './util';

interface Props {
  result: FindResult; visits: Visit[]; store: Store; n: number; target: Target | null; center: [number, number] | null;
  probe: [number, number] | null; setProbe: (p: [number, number] | null) => void;
  targetPx: (mjd: number) => [number, number] | null;
  onShowExposure: (f: Frame) => void;
}

export function SpectrumLab(p: Props) {
  const [tab, setTab] = useState<'spectrum' | 'time'>('spectrum');
  const [features, setFeatures] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const visitColour = (i: number) => timeColour(i, p.visits.length);
  const visitOf =useMemo(() => { const m = new Map<string, number>(); p.visits.forEach((v) => v.frames.forEach((f) => m.set(f.id, v.i))); return m; }, [p.visits]);

  const pts = useMemo(() => p.result.frames.map((f) => {
    const d = p.store.get(f.id), at = p.probe ?? p.targetPx(f.mjd);
    const m = d && at ? measure(d.raw, p.n, at[0], at[1]) : { flux: NaN, err: NaN };
    return { f, v: visitOf.get(f.id) ?? 0, ...m };
  }).filter((x) => Number.isFinite(x.flux)), [p.result, p.store.version, p.probe?.[0], p.probe?.[1], p.n, p.target, visitOf]);

  const spectrum: Series[] = useMemo(() => p.visits.map((v) => ({
    name: `Visit ${v.i + 1} · ${fmtMonth(v.mjd)}`, color: visitColour(v.i),
    points: pts.filter((x) => x.v === v.i).map((x) => ({
      x: x.f.lambda, y: x.flux, dy: x.err, id: x.f.id,
      label: `${x.f.lambda.toFixed(3)} µm · ${fmtFlux(x.flux, x.err)} · ${fmtDay(x.f.mjd)}`,
    })),
  })).filter((s) => s.points.length), [pts, p.visits]);

  const lightcurve: Series[] = useMemo(() => BANDS.map((b) => {
    const points = p.visits.map((v) => {
      const fl = pts.filter((x) => x.v === v.i && x.f.det === b.det);
      if (!fl.length) return null;
      const ys = fl.map((x) => x.flux), m = median(ys);
      const mad = 1.4826 * median(ys.map((y) => Math.abs(y - m)));
      const dy = fl.length >= 3 ? (1.253 * mad) / Math.sqrt(fl.length) : median(fl.map((x) => x.err));
      return { x: v.mjd, y: m, dy, id: `b${b.det}v${v.i}`, label: `${fmtDay(v.mjd)} · ${fmtFlux(m, dy)} · median of ${fl.length}` };
    }).filter((x): x is NonNullable<typeof x> => !!x);
    // join neighbouring visits only: no line across months without a measurement in this band
    return { name: `Band ${b.det} · ${b.lo.toFixed(2)}–${b.hi.toFixed(2)} µm`, color: wlColor((b.lo + b.hi) / 2), line: true, breakAbove: 75, points };
  }).filter((s) => s.points.length), [pts, p.visits]);

  // can this be trusted? very bright stars saturate SPHEREx: centre pixels blank, or flagged overflowing / non-linear
  const quality = useMemo(() => {
    const loaded = p.result.frames.filter((f) => p.store.get(f.id)).length, blank = loaded - pts.length;
    const sorted = pts.map((x) => x.flux).sort((a, b) => a - b), high = sorted.length ? sorted[Math.floor(sorted.length * 0.8)] : 0;
    let flagged = 0, withFlags = 0;
    for (const fr of p.result.frames) {
      const d = p.store.get(fr.id), at = p.probe ?? p.targetPx(fr.mjd);
      if (!d?.flags || !at) continue;
      withFlags++;
      const v = d.flags[Math.round(at[1]) * p.n + Math.round(at[0])];
      if (v > 0 && v & ((1 << 1) | (1 << 15))) flagged++;
    }
    return { loaded, blank, high, flagged, withFlags };
  }, [pts, p.store.version, p.probe?.[0], p.probe?.[1]]);

  const selPt = sel ? pts.find((x) => x.f.id === sel) : undefined;
  const c0 = (p.n - 1) / 2;
  const probeSky = p.probe && p.center ? gridToSky(p.center[0], p.center[1], p.probe[0] - c0, p.probe[1] - c0, PIXEL_ARCSEC) : null;
  const where = probeSky ? `${probeSky[0].toFixed(5)} ${probeSky[1].toFixed(5)}` : (p.target?.name ?? 'target');

  const csv = () => {
    const rows = ['visit,exposure,date_utc,mjd,band,wavelength_um,bandwidth_um,flux_uJy,flux_err_uJy,measured_at']
      .concat(pts.map((x) => [x.v + 1, x.f.id, fmtDateTime(x.f.mjd), x.f.mjd.toFixed(5), x.f.det, x.f.lambda.toFixed(4), x.f.dlambda.toFixed(4), x.flux.toFixed(2), x.err.toFixed(2), `"${where.replace(/"/g, '""')}"`].join(',')));
    download(`${(p.target?.name ?? 'spherex').replace(/[^\w]+/g, '-')}-spectrum.csv`, 'text/csv', '﻿' + rows.join('\r\n'));
  };

  const timeTicks = (lo: number, hi: number) => {
    const out: Array<{ v: number; label: string }> = [];
    const d0 = new Date((lo - 40587) * 864e5), months = Math.max(1, Math.ceil((hi - lo) / 30.44 / 5));
    for (let d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1)); ; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1))) {
      const mjd = d.getTime() / 864e5 + 40587;
      if (mjd > hi) break;
      out.push({ v: mjd, label: fmtMonth(mjd) });
      if (out.length > 8) break;
    }
    return out;
  };

  return (
    <div class="lab" data-tour="spectrum">
      <div class="lab-bar">
        <div class="seg" role="tablist" aria-label="Chart">
          <button role="tab" aria-selected={tab === 'spectrum'} onClick={() => setTab('spectrum')}>Spectrum</button>
          <button role="tab" aria-selected={tab === 'time'} onClick={() => setTab('time')}>Brightness over time</button>
        </div>
        <p class="lab-where">
          {p.probe ? <>Measured at the point you clicked{probeSky && <span class="mono"> ({probeSky[0].toFixed(4)}°, {probeSky[1].toFixed(4)}°)</span>}. <button class="link" onClick={() => p.setProbe(null)}>Back to the target</button></>
            : <>Measured at {p.target?.name ?? 'the target'}{p.target?.pmra || p.target?.pmdec ? ', following its motion' : ''}. Click the image to measure anywhere else.</>}
        </p>
        <span class="spacer" />
        {tab === 'spectrum' && (
          <label class="check"><input type="checkbox" checked={features} onChange={(e) => setFeatures((e.target as HTMLInputElement).checked)} />Molecule markers</label>
        )}
        <button class="btn sm" onClick={csv} disabled={!pts.length}><Icon name="download" size={16} />CSV</button>
      </div>
      {quality.withFlags > 0 && quality.flagged / quality.withFlags > 0.2
        ? <p class="box warn"><Icon name="warn" size={16} /><span><b>Saturated.</b> In {quality.flagged} of {quality.withFlags} exposures SPHEREx flags this spot as overflowing or non-linear (too bright to measure). Treat these values as unreliable.</span></p>
        : quality.loaded > 0 && quality.blank / quality.loaded > 0.25
          ? <p class="box warn"><Icon name="warn" size={16} /><span><b>Too bright for SPHEREx.</b> The centre is blank (saturated) in {quality.blank} of {quality.loaded} exposures, so only {pts.length} could be measured, and those are likely too low.</span></p>
          : quality.high > 3e5
            ? <p class="box caution"><Icon name="warn" size={16} /><span><b>Very bright.</b> Stars this bright can saturate SPHEREx. Turn on Bad pixels (Display menu) to check the quality flags before trusting this.</span></p>
            : null}
      {tab === 'spectrum'
        ? <Chart series={spectrum} xLabel="Wavelength (µm)" yLabel="Flux" xDomain={[0.7, 5.05]} xTicks={() => [1, 2, 3, 4, 5].map((v) => ({ v, label: String(v) }))} bands features={features}
            selected={sel} onSelect={(q) => setSel(q?.id ?? null)}
            ariaLabel={`Spectrum of ${where}: ${plural(pts.length, 'exposure')} in ${plural(spectrum.length, 'visit')}, flux against wavelength from 0.75 to 5 µm. Use the arrow keys to step through points.`} />
        : <Chart series={lightcurve} xLabel="Date" yLabel="Flux" xTicks={timeTicks}
            ariaLabel={`Brightness of ${where} over time: median flux per visit in each of the six SPHEREx bands.`} />}
      <div class="lab-foot" aria-live="polite">
        {tab === 'spectrum' && selPt ? (
          <div class="lab-sel">
            <span class="sw" style={{ background: visitColour(selPt.v) }} />
            <span class="mono">{selPt.f.lambda.toFixed(3)} µm ± {(selPt.f.dlambda / 2).toFixed(3)} · {fmtFlux(selPt.flux, selPt.err)}</span>
            <span>Visit {selPt.v + 1} · Band {selPt.f.det} · {fmtDateTime(selPt.f.mjd)}</span>
            <button class="link" onClick={() => p.onShowExposure(selPt.f)}>Show this exposure</button>
            <a class="link" href={`https://nasa-irsa-spherex.s3.amazonaws.com/${selPt.f.key}`} rel="noopener" target="_blank">Original file <Icon name="external" size={13} /></a>
          </div>
        ) : (
          <p class="note">
            {tab === 'spectrum'
              ? <>Each point is one exposure, coloured by date (blue earliest, amber latest), measured in a 1.6-pixel (≈10″) aperture with the sky around it subtracted. Error bars are approximate (±1σ from the local sky noise).{features && <> Molecule markers show where {FEATURES.map((f) => f.long).join(', ')} would absorb; they are not detections.</>} Click a point to see where it came from.</>
              : <>Median brightness per visit in each band. A variable star rises and falls in every band; a steady star stays flat. Error bars: scatter of the exposures in that visit.</>}
          </p>
        )}
      </div>
    </div>
  );
}

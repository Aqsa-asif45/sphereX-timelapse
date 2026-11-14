import { Badge } from '@/components/ui/badge';
import { BANDS, fmtMjdUtc, fmtNum } from '@/lib/format';
import type { Cutout, Observation } from '@/lib/types';

function Row({ k, children, mono }: { k: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <>
      <dt className="text-ink-3">{k}</dt>
      <dd className={mono ? 'break-all font-mono text-ink' : 'text-ink'}>{children}</dd>
    </>
  );
}

export function MetaPanel({ obs, cutout }: { obs: Observation; cutout: Cutout | undefined }) {
  const band = BANDS[obs.detector];
  const defs = cutout ? Object.entries(cutout.flags.definitions) : [];
  return (
    <div className="space-y-5 text-xs">
      <section aria-labelledby="prov-h">
        <h2 id="prov-h" className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-3">Provenance</h2>
        <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1">
          <Row k="Release"><Badge tone="info">{obs.release.toUpperCase()}</Badge> <span className="text-ink-2">{obs.survey} survey</span></Row>
          <Row k="Collection" mono>{obs.collection}</Row>
          <Row k="Observation ID" mono>{obs.obs_id}</Row>
          <Row k="Pipeline" mono>{obs.pipeline}-{obs.version}{cutout?.header.VERSION ? ` (software ${cutout.header.VERSION})` : ''}</Row>
          <Row k="Processed" mono>{obs.processing_date}</Row>
          <Row k="Found via">{obs.adapter}</Row>
          <Row k="Retrieved" mono>{obs.retrieved_utc}</Row>
          <Row k="File"><a className="break-all text-focus underline underline-offset-2" href={obs.access_url} target="_blank" rel="noreferrer">{obs.access_url.split('/').pop()}</a></Row>
          {cutout && <Row k="Cutout"><a className="text-focus underline underline-offset-2" href={cutout.cutout_url} target="_blank" rel="noreferrer">IRSA cutout service</a>{cutout.from_cache && <span className="text-ink-3"> (from local cache)</span>}</Row>}
        </dl>
      </section>

      <section aria-labelledby="obs-meta-h">
        <h2 id="obs-meta-h" className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-3">Observation</h2>
        <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1">
          <Row k="Time" mono>{fmtMjdUtc(cutout?.mjd_avg ?? obs.mjd)}</Row>
          <Row k="MJD" mono>{fmtNum(cutout?.mjd_avg ?? obs.mjd, 6)} {cutout?.timesys ?? ''}</Row>
          <Row k="Detector" mono>D{obs.detector} · band {fmtNum(band?.lo, 2)}–{fmtNum(band?.hi, 2)} µm · R≈{band?.r}</Row>
          {cutout && <Row k="At the target" mono>λ {fmtNum(cutout.wavelength_um, 4)} µm, bandwidth {fmtNum(cutout.bandwidth_um, 4)} µm</Row>}
          {cutout && <Row k="Units" mono>{cutout.bunit} (variance {cutout.variance_unit ?? '–'})</Row>}
          {cutout && <Row k="Target pixel" mono>{cutout.target_pixel_0based.map((v) => v.toFixed(2)).join(', ')} in cutout{cutout.target_pixel_original_1based && ` · ${cutout.target_pixel_original_1based.map((v) => v.toFixed(2)).join(', ')} in the full image (1-based)`}</Row>}
          {cutout && <Row k="Field" mono>{cutout.nx} × {cutout.ny} px · {(cutout.size_deg * 60).toFixed(1)}′</Row>}
          {cutout && <Row k="Background" mono>median {fmtNum(cutout.stats.median, 3)} · robust σ {fmtNum(cutout.stats.sigma_mad, 3)} {cutout.bunit}</Row>}
        </dl>
        <p className="mt-2 text-ink-3">Wavelengths come from the file's WCS-WAVE table (about 1 nm, for display). Science-grade values use IRSA's CWAVE/CBAND calibration files (Phase 5).</p>
      </section>

      {cutout && (
        <section aria-labelledby="flags-h">
          <h2 id="flags-h" className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-3">Quality flags {cutout.flags.compressed && <span className="normal-case tracking-normal text-ink-3">(decompressed from RICE tiles)</span>}</h2>
          {defs.length === 0 ? <p className="text-ink-2">This file names no flag bits.</p> : (
            <table className="w-full border-collapse">
              <caption className="sr-only">Flag bits defined in this file, and how many pixels in this cutout have each</caption>
              <thead><tr className="text-left text-ink-3"><th className="font-normal">Bit</th><th className="font-normal">Name</th><th className="font-normal">Kind</th><th className="text-right font-normal">Pixels</th></tr></thead>
              <tbody>
                {defs.map(([bit, d]) => (
                  <tr key={bit} className="border-t border-line" title={d.description}>
                    <td className="py-0.5 font-mono text-ink-2">{bit}</td>
                    <td className="py-0.5 font-mono text-ink">{d.name}</td>
                    <td className="py-0.5 text-ink-3">{d.category === 'bad' ? 'unreliable' : d.category === 'artifact' ? 'artifact' : 'information'}</td>
                    <td className="py-0.5 text-right font-mono text-ink-2">{cutout.flags.counts[bit] ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {cutout && (
        <section aria-labelledby="hdu-h">
          <h2 id="hdu-h" className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-3">File structure</h2>
          <p className="font-mono text-ink-2">{cutout.hdus.map((h) => `${h.name} (${h.type.replace('HDU', '')})`).join(' · ')}</p>
        </section>
      )}
    </div>
  );
}

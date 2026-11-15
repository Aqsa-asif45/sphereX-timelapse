import { useEffect, useMemo, useState } from 'react'
import { fmtDateTime, fmtMonth, gridToSky, plural, positionAt, wlColor } from '../../lib/astro'
import { skyToGrid } from '../../lib/overlays'
import { APERTURE_PX, FEATURES, download, fmtFlux, lightCurve, timeColour } from '../../lib/photometry'
import Chart from './Chart'

const fmtDay = (mjd) => fmtDateTime(mjd).split(',')[0]
const btn = 'rounded-ctl border border-ctl px-3 py-1 text-sm text-ink hover:bg-hover disabled:opacity-40'

/** Grid position (0-based pixel centres) of the target on a date. */
const targetAt = (t, center, n, mjd) => skyToGrid(center, n, ...positionAt(t, mjd)).map((v) => v - 0.5)

/** Months on the time axis. */
function timeTicks(lo, hi) {
  const out = []
  const d0 = new Date((lo - 40587) * 864e5)
  const step = Math.max(1, Math.ceil((hi - lo) / 30.44 / 5))
  for (let d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1)); out.length <= 8; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + step, 1))) {
    const mjd = d.getTime() / 864e5 + 40587
    if (mjd > hi) break
    out.push({ v: mjd, label: fmtMonth(mjd) })
  }
  return out
}

/**
 * The Spectrum lab (SP-1 to SP-6). SPHEREx's filters change wavelength across each detector, so every
 * exposure measures the spot at a different wavelength: photometry on all of them (in the image worker)
 * builds a spectrum, coloured by date, and per-band medians per visit give brightness over time.
 * Each point links back to its exposure and file.
 */
export default function SpectrumLab({ q, target, frames, visits, engine, version, n, center, images, probe, setProbe, onShowExposure }) {
  const [tab, setTab] = useState('spectrum')
  const [features, setFeatures] = useState(false)
  const [sel, setSel] = useState(null)
  const [res, setRes] = useState({ key: '', rows: [] })

  const visitOf = useMemo(() => new Map(visits.flatMap((v) => v.frames.map((f) => [f.id, v.i]))), [visits])
  const at = (mjd) => (probe ? probe : target && center ? targetAt(target, center, n, mjd) : null)
  const key = `${probe?.join(',') ?? 'target'}|${n}|${center?.join(',')}|${frames.length}`

  useEffect(() => {
    if (!center) return undefined
    let live = true
    const items = frames.map((f) => {
      const [x, y] = probe ?? (target ? targetAt(target, center, n, f.mjd) : [(n - 1) / 2, (n - 1) / 2])
      return { id: f.id, x, y }
    })
    engine.measure(n, items).then((rows) => live && rows && setRes({ key, rows }))
    return () => {
      live = false // a newer measurement (more images, another point) replaces this one
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key covers probe, n, centre and frames
  }, [key, version, engine, target])

  const byId = useMemo(() => new Map(frames.map((f) => [f.id, f])), [frames])
  const pts = useMemo(
    () =>
      (res.key === key ? res.rows : [])
        .filter((r) => Number.isFinite(r.flux) && byId.has(r.id))
        .map((r) => ({ ...r, f: byId.get(r.id), v: visitOf.get(r.id) ?? 0 })),
    [res, key, byId, visitOf],
  )

  const spectrum = useMemo(
    () =>
      visits
        .map((v) => ({
          name: `Visit ${v.i + 1} · ${fmtMonth(v.mjd)}`,
          color: timeColour(v.i, visits.length),
          points: pts
            .filter((x) => x.v === v.i)
            .map((x) => ({ x: x.f.lambda_um, y: x.flux, dy: x.err, id: x.f.id, label: `${x.f.lambda_um.toFixed(3)} µm · ${fmtFlux(x.flux, x.err)} · ${fmtDay(x.f.mjd)}` })),
        }))
        .filter((s) => s.points.length),
    [pts, visits],
  )
  const curve = useMemo(
    () =>
      lightCurve(pts, visits).map(({ band: b, points }) => ({
        name: `Band ${b.det} · ${b.lo.toFixed(2)}–${b.hi.toFixed(2)} µm`,
        color: wlColor((b.lo + b.hi) / 2),
        line: true,
        breakAbove: 75, // days: never join visits across a gap with no data in this band
        points: points.map((p) => ({ ...p, id: `b${b.det}v${p.v}`, label: `${fmtDay(p.x)} · ${fmtFlux(p.y, p.dy)} · median of ${p.k}` })),
      })),
    [pts, visits],
  )

  // can this be trusted? very bright stars saturate SPHEREx: centre blank, or flagged overflowing / non-linear
  const quality = useMemo(() => {
    const loaded = frames.filter((f) => images.has(f.id)).length
    const sorted = pts.map((x) => x.flux).sort((a, b) => a - b)
    let flagged = 0
    let withFlags = 0
    for (const f of frames) {
      const d = images.get(f.id)
      const p = at(f.mjd)
      if (!d?.flags || !p) continue
      const v = d.flags[Math.round(p[1]) * n + Math.round(p[0])]
      if (v === undefined || v < 0) continue
      withFlags++
      if (v & ((1 << 1) | (1 << 15))) flagged++
    }
    return { loaded, blank: loaded - pts.length, high: sorted.length ? sorted[Math.floor(sorted.length * 0.8)] : 0, flagged, withFlags }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- images is filled as cutouts arrive; pts follows version
  }, [pts, frames, images, n])

  const selPt = sel ? pts.find((x) => x.f.id === sel) : undefined
  const c0 = (n - 1) / 2
  const probeSky = probe && center ? gridToSky(center[0], center[1], probe[0] - c0, probe[1] - c0) : null
  const where = probeSky ? `${probeSky[0].toFixed(5)} ${probeSky[1].toFixed(5)}` : (target?.name ?? q)

  const csv = () => {
    const rows = ['visit,exposure,date_utc,mjd,band,wavelength_um,bandwidth_um,flux_uJy,flux_err_uJy,release,file_url,measured_at'].concat(
      pts.map((x) =>
        [
          x.v + 1,
          x.f.id,
          fmtDateTime(x.f.mjd),
          x.f.mjd.toFixed(5),
          x.f.det,
          x.f.lambda_um.toFixed(4),
          x.f.dlambda_um.toFixed(4),
          x.flux.toFixed(2),
          x.err.toFixed(2),
          x.f.release,
          x.f.file_url,
          `"${where.replace(/"/g, '""')}"`,
        ].join(','),
      ),
    )
    download(`${String(target?.name ?? 'spherex').replace(/[^\w]+/g, '-')}-spectrum.csv`, 'text/csv', '﻿' + rows.join('\r\n'))
  }

  const tabCls = (on) => `rounded-[4px] px-3 py-1 text-sm ${on ? 'bg-focus/20 text-ink' : 'text-ink-2 hover:text-ink'}`
  const warn = 'rounded-ctl border px-3 py-2 text-sm'
  return (
    <div className="flex flex-col gap-3" data-testid="spectrum-lab">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div role="tablist" aria-label="Chart" className="flex rounded-ctl border border-ctl p-0.5">
          <button type="button" role="tab" aria-selected={tab === 'spectrum'} className={tabCls(tab === 'spectrum')} onClick={() => setTab('spectrum')}>
            Spectrum
          </button>
          <button type="button" role="tab" aria-selected={tab === 'time'} className={tabCls(tab === 'time')} onClick={() => setTab('time')}>
            Brightness over time
          </button>
        </div>
        <p className="min-w-0 flex-1 text-sm text-ink-2">
          {probe ? (
            <>
              Measured at the point you clicked{probeSky && <span className="num font-mono"> ({probeSky[0].toFixed(4)}°, {probeSky[1].toFixed(4)}°)</span>}.{' '}
              <button type="button" className="text-focus underline underline-offset-2" onClick={() => setProbe(null)}>
                Back to the target
              </button>
            </>
          ) : (
            <>
              Measured at {target?.name ?? 'the target'}
              {target?.pmra || target?.pmdec ? ', following its motion' : ''}. Click the image to measure anywhere else.
            </>
          )}
        </p>
        {tab === 'spectrum' && (
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={features} onChange={(e) => setFeatures(e.target.checked)} />
            Molecule markers
          </label>
        )}
        <button type="button" className={btn} onClick={csv} disabled={!pts.length}>
          Download CSV
        </button>
      </div>

      {quality.withFlags > 0 && quality.flagged / quality.withFlags > 0.2 ? (
        <p className={`${warn} border-time/50 text-ink`} role="note">
          <b className="text-time">Saturated.</b> In {quality.flagged} of {quality.withFlags} exposures SPHEREx flags this spot as overflowing or non-linear (too bright to
          measure). Treat these values as unreliable.
        </p>
      ) : quality.loaded > 0 && quality.blank / quality.loaded > 0.25 ? (
        <p className={`${warn} border-time/50 text-ink`} role="note">
          <b className="text-time">Too bright for SPHEREx.</b> The centre is blank (saturated) in {quality.blank} of {quality.loaded} exposures, so only {pts.length} could be
          measured, and those are likely too low.
        </p>
      ) : quality.high > 3e5 ? (
        <p className={`${warn} border-line-2 text-ink-2`} role="note">
          <b className="text-ink">Very bright.</b> Stars this bright can saturate SPHEREx. Switch on Bad pixels to check the quality flags before trusting this.
        </p>
      ) : null}

      {tab === 'spectrum' ? (
        <Chart
          series={spectrum}
          xLabel="Wavelength (µm)"
          yLabel="Flux"
          xDomain={[0.7, 5.05]}
          xTicks={() => [1, 2, 3, 4, 5].map((v) => ({ v, label: String(v) }))}
          bands
          features={features}
          selected={sel}
          onSelect={(pt) => setSel(pt?.id ?? null)}
          ariaLabel={`Spectrum of ${where}: ${plural(pts.length, 'exposure')} in ${plural(spectrum.length, 'visit')}, flux against wavelength from 0.75 to 5 µm. Use the arrow keys to step through points.`}
        />
      ) : (
        <Chart series={curve} xLabel="Date" yLabel="Flux" xTicks={timeTicks} ariaLabel={`Brightness of ${where} over time: median flux per visit in each of the six SPHEREx bands.`} />
      )}

      <div aria-live="polite" className="text-sm">
        {tab === 'spectrum' && selPt ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="spectrum-point">
            <i className="h-2.5 w-2.5 rounded-full" style={{ background: timeColour(selPt.v, visits.length) }} aria-hidden="true" />
            <span className="num font-mono text-ink">
              {selPt.f.lambda_um.toFixed(3)} µm ± {(selPt.f.dlambda_um / 2).toFixed(3)} · {fmtFlux(selPt.flux, selPt.err)}
            </span>
            <span className="text-ink-2">
              Visit {selPt.v + 1} · Band {selPt.f.det} · {fmtDateTime(selPt.f.mjd)} · {selPt.f.release.toUpperCase()}
            </span>
            <button type="button" className="text-focus underline underline-offset-2" onClick={() => onShowExposure(selPt.f)}>
              Show this exposure
            </button>
            <a className="text-focus underline underline-offset-2" href={selPt.f.file_url} target="_blank" rel="noopener noreferrer">
              Original file
            </a>
          </div>
        ) : (
          <p className="text-xs text-ink-3">
            {tab === 'spectrum' ? (
              <>
                Each point is one exposure, coloured by date (blue earliest, amber latest), measured in a {APERTURE_PX}-pixel (≈10″) aperture with the sky ring around it
                subtracted; no aperture correction, so this is not the total flux. Error bars: ±1σ from the local sky noise.
                {features && <> Dashed lines mark where {FEATURES.map((f) => f.long).join(', ')} would absorb here: they are not detections.</>} Click a point to see
                where it came from.
              </>
            ) : (
              <>Median brightness per visit in each band. A variable star rises and falls in every band; a steady star stays flat. Error bars: scatter of that visit’s exposures. Lines never cross months with no data.</>
            )}
          </p>
        )}
      </div>
    </div>
  )
}

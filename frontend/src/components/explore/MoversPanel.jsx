import { useState } from 'react'
import { PIXEL_ARCSEC, plural } from '../../lib/astro'
import { REVIEWS, describe, gaiaVerdict, why } from '../../lib/movers'
import { download } from '../../lib/photometry'
import { BTN } from '../../lib/ui'

const btn = 'rounded-ctl border border-ctl px-3 py-1 text-sm text-ink hover:bg-hover disabled:opacity-40'
const TONE = { ok: 'border-ok/50 text-ok', warn: 'border-time/60 text-time', hot: 'border-[#ff5cf0]/60 text-[#ff8cf5]', mute: 'border-line-2 text-ink-3' }
const sel = 'rounded-ctl border border-ctl bg-raised px-2 py-1 text-sm text-ink'

function Chip({ c }) {
  const g = gaiaVerdict(c)
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${TONE[g.tone]}`}>{g.text}</span>
}

/**
 * The Movers dock (MV-1 to MV-7): run the finder, list candidates with their Gaia check, hide those Gaia
 * rules out, mark your own spots, set a review status and note (this device only), export CSV / JSON.
 */
export default function MoversPanel(p) {
  const [showRuled, setShowRuled] = useState(false)
  const auto = p.cands ?? []
  const kept = auto.filter((c) => !c.dismissed)
  const ruled = auto.filter((c) => c.dismissed)
  const list = [...kept, ...p.yours, ...(showRuled ? ruled : [])]
  const picked = [...auto, ...p.yours].find((c) => c.id === p.pick)

  const exportAs = (kind) => {
    const rows = [...auto, ...p.yours].map((c) => ({
      id: c.id,
      target: p.targetName,
      kind: c.kind,
      what: describe(c),
      ra_deg: +c.ra.toFixed(6),
      dec_deg: +c.dec.toFixed(6),
      visits: c.visits.map((v) => v + 1).join(' '),
      shift_arcsec: c.kind === 'moving' ? +(c.shift * PIXEL_ARCSEC).toFixed(2) : '',
      rate_arcsec_per_yr: c.kind === 'moving' ? +c.rate.toFixed(2) : '',
      direction_deg_east_of_north: c.kind === 'moving' ? +c.pa.toFixed(1) : '',
      confidence_x_noise: c.sig ? +c.sig.toFixed(1) : '',
      gaia: gaiaVerdict(c).text,
      ruled_out_by_gaia: !!c.dismissed,
      review: p.reviewOf(c).status,
      note: p.reviewOf(c).note,
      why: why(c),
    }))
    const name = `${p.targetName.replace(/[^\w]+/g, '-')}-candidates`
    if (kind === 'json') return download(`${name}.json`, 'application/json', JSON.stringify(rows, null, 2))
    const keys = Object.keys(rows[0] ?? { id: '' })
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`
    download(`${name}.csv`, 'text/csv', '﻿' + [keys.join(','), ...rows.map((r) => keys.map((k) => q(r[k])).join(','))].join('\r\n'))
  }

  return (
    <div className="flex flex-col gap-3" data-testid="movers">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={p.onRun} disabled={p.finding || !p.canRun} className="rounded-ctl bg-time px-3 py-1.5 text-sm font-medium text-bg hover:brightness-110 disabled:opacity-50">
          {p.finding ? 'Looking…' : p.cands ? 'Look again' : 'Find moving things'}
        </button>
        <span className="min-w-0 flex-1 text-xs text-ink-3">{p.runNote}</span>
        <button type="button" aria-pressed={p.marking} onClick={() => p.setMarking(!p.marking)} className={`${btn} ${p.marking ? 'border-focus bg-focus/15' : ''}`}>
          {p.marking ? 'Now click the image…' : 'I spotted something'}
        </button>
        <button type="button" className={btn} onClick={() => exportAs('csv')} disabled={!auto.length && !p.yours.length}>
          CSV
        </button>
        <button type="button" className={btn} onClick={() => exportAs('json')} disabled={!auto.length && !p.yours.length}>
          JSON
        </button>
      </div>

      {p.error && (
        <p role="alert" className="text-sm text-danger">
          {p.error}
        </p>
      )}
      {p.cands === null && !p.yours.length ? (
        <p className="text-sm text-ink-2">
          TimeLens measures every star’s position in each visit and flags anything that moved more than the noise allows, or appeared in only one visit. Each find is
          then checked against ESA’s Gaia catalogue. Finds are evidence to look at, never discoveries.
        </p>
      ) : (
        <>
          {p.cands && (
            <p className="text-sm text-ink-2" data-testid="movers-summary">
              {kept.length === 0 ? (
                <>
                  Nothing here clearly moved or appeared once{p.loaded < p.total ? ` (checked with ${p.loaded} of ${p.total} images loaded)` : ''}: this patch looks
                  still.
                </>
              ) : (
                <>
                  {plural(kept.filter((c) => c.kind === 'moving').length, 'moving source')} and {plural(kept.filter((c) => c.kind === 'once').length, 'one-visit source')}. Pink
                  arrows on the image show where each one went.
                </>
              )}
              {ruled.length > 0 && (
                <>
                  {' '}
                  <button type="button" className={`${BTN.small} ml-1 align-middle`} aria-expanded={showRuled} onClick={() => setShowRuled(!showRuled)}>
                    {showRuled ? 'Hide' : 'Show'} {ruled.length} ruled out by Gaia
                  </button>
                </>
              )}
            </p>
          )}
          {list.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs text-ink-3">
                  <tr>
                    {['ID', 'What', 'Position (RA, Dec)', 'Visits', 'Confidence', 'Gaia check', 'Review'].map((h) => (
                      <th key={h} scope="col" className="border-b border-line px-2 py-1.5 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => p.onPick(c.id === p.pick ? null : c.id)}
                      className={`cursor-pointer border-b border-line ${c.id === p.pick ? 'bg-focus/10' : 'hover:bg-hover'} ${c.dismissed ? 'text-ink-3' : ''}`}
                    >
                      <td className="px-2 py-1.5">
                        <button
                          type="button"
                          className={`${BTN.small} font-mono ${c.id === p.pick ? 'border-focus bg-focus/15' : ''}`}
                          aria-pressed={c.id === p.pick}
                          onClick={(e) => {
                            e.stopPropagation()
                            p.onPick(c.id === p.pick ? null : c.id)
                          }}
                        >
                          {c.id}
                        </button>
                      </td>
                      <td className="px-2 py-1.5">{describe(c)}</td>
                      <td className="num px-2 py-1.5 font-mono text-xs">
                        {c.ra.toFixed(4)}°, {c.dec >= 0 ? '+' : '−'}
                        {Math.abs(c.dec).toFixed(4)}°
                      </td>
                      <td className="num px-2 py-1.5 font-mono text-xs">{c.visits.length ? c.visits.map((v) => v + 1).join(', ') : '–'}</td>
                      <td className="num px-2 py-1.5 font-mono text-xs">{c.sig ? `${Math.min(99, c.sig).toFixed(0)}×` : '–'}</td>
                      <td className="px-2 py-1.5">
                        <Chip c={c} />
                      </td>
                      <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                        <select className={sel} aria-label={`Review status for ${c.id}`} value={p.reviewOf(c).status} onChange={(e) => p.setReview(c, { status: e.target.value })}>
                          {REVIEWS.map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {picked && (
            <section aria-label={`Candidate ${picked.id}`} className="flex flex-col gap-2 rounded-panel border border-line-2 p-3" data-testid="candidate">
              <h3 className="text-sm font-semibold">
                <span className="font-mono">{picked.id}</span> · {describe(picked)}
              </h3>
              <p className="text-sm text-ink-2">{why(picked)}</p>
              <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
                Gaia DR3: <Chip c={picked} />
                {picked.gaia && (
                  <span className="num font-mono text-xs text-ink-3">
                    G {picked.gaia.g?.toFixed(1)} · {picked.gaia.sep.toFixed(1)}″ away
                  </span>
                )}
              </p>
              {picked.gaia === null && picked.kind !== 'yours' && (
                <p className="text-xs text-ink-3">
                  Not in Gaia does not mean new: Gaia sees visible light, and very cold objects such as brown dwarfs are often too faint for it. Worth a closer look.
                </p>
              )}
              {picked.dismissed && <p className="text-xs text-ink-3">Gaia measures this star far more precisely and finds it steady, so the apparent change is almost certainly glare or two stars blending.</p>}
              <label className="flex flex-col gap-1 text-sm text-ink-2">
                Note
                <textarea
                  rows={2}
                  className="rounded-ctl border border-ctl bg-bg-2 px-2 py-1 text-sm text-ink"
                  placeholder="What did you see?"
                  value={p.reviewOf(picked).note}
                  onChange={(e) => p.setReview(picked, { note: e.target.value })}
                />
              </label>
              {picked.kind === 'yours' && (
                <button type="button" className={`${BTN.danger} self-start`} onClick={() => p.onRemoveMark(picked)}>
                  Remove this mark
                </button>
              )}
            </section>
          )}
          <p className="text-xs text-ink-3">
            Review status, notes and your marks are saved in this browser on this device only{p.storageOk ? '' : ' (storage is blocked here, so they will be forgotten when you leave)'}.
            Measured in your browser from the SPHEREx images on screen.
          </p>
        </>
      )}
    </div>
  )
}

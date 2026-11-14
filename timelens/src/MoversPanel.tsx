/** The Movers dock: run the finder, list candidates, set review status, export. */
import { useState } from 'preact/hooks';
import { download } from '../../web/src/candidates';
import { Icon } from './icons';
import { describe, gaiaVerdict, REVIEWS, why, type Cand, type Review, type ReviewRec } from './movers';
import { plural } from './util';

interface Props {
  cands: Cand[] | null; yours: Cand[];
  finding: boolean; canRun: boolean; runNote: string; onRun: () => void;
  pick: string | null; onPick: (id: string | null) => void;
  marking: boolean; setMarking: (b: boolean) => void;
  reviews: Record<string, ReviewRec>; reviewOf: (c: Cand) => ReviewRec; setReview: (c: Cand, r: Partial<ReviewRec>) => void;
  targetName: string; loaded: number; total: number;
}

export function MoversPanel(p: Props) {
  const [showRuled, setShowRuled] = useState(false);
  const auto = p.cands ?? [];
  const kept = auto.filter((c) => !c.dismissed), ruled = auto.filter((c) => c.dismissed);
  const list = [...kept, ...p.yours, ...(showRuled ? ruled : [])];
  const exportAs = (kind: 'csv' | 'json') => {
    const rows = [...auto, ...p.yours].map((c) => ({
      id: c.id, target: p.targetName, kind: c.kind, what: describe(c), ra_deg: +c.ra.toFixed(6), dec_deg: +c.dec.toFixed(6),
      visits: c.visits.map((v) => v + 1).join(' '), shift_arcsec: c.kind === 'moving' ? +(c.shift * 6.15).toFixed(2) : '', rate_arcsec_per_yr: c.kind === 'moving' ? +c.rate.toFixed(2) : '',
      confidence: c.sig ? +c.sig.toFixed(1) : '', gaia: gaiaVerdict(c).text, ruled_out_by_gaia: !!c.dismissed, review: p.reviewOf(c).status, note: p.reviewOf(c).note, why: why(c),
    }));
    const name = `${p.targetName.replace(/[^\w]+/g, '-')}-candidates`;
    if (kind === 'json') return download(`${name}.json`, 'application/json', JSON.stringify(rows, null, 2));
    const keys = Object.keys(rows[0] ?? { id: '' }), q = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
    download(`${name}.csv`, 'text/csv', '﻿' + [keys.join(','), ...rows.map((r) => keys.map((k) => q((r as Record<string, unknown>)[k])).join(','))].join('\r\n'));
  };

  return (
    <div class="movers">
      <div class="movers-bar">
        <button class="btn primary" onClick={p.onRun} disabled={p.finding || !p.canRun} data-tour="find">
          <Icon name="spark" size={16} />{p.finding ? 'Looking…' : p.cands ? 'Look again' : 'Find moving things'}
        </button>
        <span class="note">{p.runNote}</span>
        <span class="spacer" />
        <button class={'btn' + (p.marking ? ' on' : '')} aria-pressed={p.marking} onClick={() => p.setMarking(!p.marking)}>
          <Icon name="target" size={16} />{p.marking ? 'Now click the image…' : 'Mark a spot myself'}
        </button>
        <button class="btn sm" onClick={() => exportAs('csv')} disabled={!auto.length && !p.yours.length}><Icon name="download" size={16} />CSV</button>
        <button class="btn sm" onClick={() => exportAs('json')} disabled={!auto.length && !p.yours.length}>JSON</button>
      </div>
      {p.cands === null && !p.yours.length ? (
        <p class="empty-line">TimeLens measures every star's position in each visit and flags anything that moved more than the noise allows, or appeared in only one visit. Each find is then checked against ESA's Gaia catalogue.</p>
      ) : (
        <>
          {p.cands && (
            <p class="note movers-sum">
              {kept.length === 0
                ? <>Nothing here clearly moved or appeared once{p.loaded < p.total ? ` (checked with ${p.loaded} of ${p.total} images loaded)` : ''}: this patch looks still.</>
                : <>{plural(kept.filter((c) => c.kind === 'moving').length, 'moving source')} and {plural(kept.filter((c) => c.kind === 'once').length, 'one-visit source')}. Pink arrows on the image show where each mover went.</>}
              {ruled.length > 0 && <> <button class="link" aria-expanded={showRuled} onClick={() => setShowRuled(!showRuled)}>{showRuled ? 'Hide' : 'Show'} {ruled.length} ruled out by Gaia</button></>}
            </p>
          )}
          {list.length > 0 && (
            <div class="table-wrap">
              <table class="cands">
                <thead><tr><th scope="col">ID</th><th scope="col">What</th><th scope="col">Position (RA, Dec)</th><th scope="col">Visits</th><th scope="col" class="r">Confidence</th><th scope="col">Gaia check</th><th scope="col">Review</th></tr></thead>
                <tbody>
                  {list.map((c) => {
                    const g = gaiaVerdict(c), r = p.reviewOf(c);
                    return (
                      <tr class={(c.id === p.pick ? 'on' : '') + (c.dismissed ? ' ruled' : '')} onClick={() => p.onPick(c.id === p.pick ? null : c.id)}>
                        <td><button class="link mono" aria-pressed={c.id === p.pick} onClick={(e) => { e.stopPropagation(); p.onPick(c.id === p.pick ? null : c.id); }}>{c.id}</button></td>
                        <td>{describe(c)}</td>
                        <td class="mono">{c.ra.toFixed(4)}°, {c.dec >= 0 ? '+' : '−'}{Math.abs(c.dec).toFixed(4)}°</td>
                        <td class="mono">{c.visits.length ? c.visits.map((v) => v + 1).join(', ') : '–'}</td>
                        <td class="mono r">{c.sig ? `${Math.min(99, c.sig).toFixed(0)}×` : '–'}</td>
                        <td><span class={'chip ' + g.tone}>{g.text}</span></td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <select class="select sm" aria-label={`Review status for ${c.id}`} value={r.status} onChange={(e) => p.setReview(c, { status: (e.target as HTMLSelectElement).value as Review })}>
                            {REVIEWS.map(([v, l]) => <option value={v}>{l}</option>)}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p class="note">Review status and notes are saved on this device only.</p>
        </>
      )}
    </div>
  );
}

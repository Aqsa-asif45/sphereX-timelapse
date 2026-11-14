import { Badge } from '@/components/ui/badge';
import { fmtMjdUtc, fmtNum } from '@/lib/format';
import type { Observation, SearchResult } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useApp } from '@/state/store';

const RELEASE_LABEL: Record<string, string> = { dr1: 'DR1 · Data Release 1', qr3: 'QR3 · Quick Release 3' };

export function ObservationList({ result }: { result: SearchResult }) {
  const selected = useApp((s) => s.selected);
  const select = useApp((s) => s.select);
  const releases = Object.keys(result.by_release);
  const first = (rel: string) => result.observations.find((o) => o.release === rel);

  return (
    <section aria-labelledby="obs-h" className="flex min-h-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="obs-h" className="text-xs font-medium uppercase tracking-wider text-ink-3">Observations</h2>
        <span className="font-mono text-xs text-ink-2">{result.count} exposures</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Badge tone={result.complete ? 'ok' : 'danger'}>{result.complete ? 'Complete' : 'May be incomplete'}</Badge>
        <span className="text-ink-3">via {result.adapter} · {result.elapsed_s.toFixed(1)} s</span>
      </div>
      {result.notes.map((n) => <p key={n} className="text-xs text-time">{n}</p>)}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Jump to an example">
        {releases.map((r) => (
          <button key={r} type="button" onClick={() => { const o = first(r); if (o) select(o); }}
            className="rounded-ctl border border-line-2 px-2 py-1 text-xs text-ink-2 hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            First {r.toUpperCase()} ({result.by_release[r]})
          </button>
        ))}
      </div>
      <ol className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1" aria-label="Exposures, oldest first">
        {releases.map((rel) => (
          <li key={rel}>
            <h3 className="sticky top-0 z-10 bg-bg py-1 text-xs font-medium text-ink-2">{RELEASE_LABEL[rel] ?? rel.toUpperCase()} · {result.by_release[rel]}</h3>
            <ol className="space-y-1">
              {result.observations.filter((o) => o.release === rel).map((o) => <Row key={o.access_url} o={o} active={selected?.access_url === o.access_url} onSelect={() => select(o)} />)}
            </ol>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Row({ o, active, onSelect }: { o: Observation; active: boolean; onSelect: () => void }) {
  return (
    <li>
      <button type="button" onClick={onSelect} aria-current={active ? 'true' : undefined}
        className={cn('grid w-full grid-cols-[1fr_auto] gap-x-2 rounded-ctl border border-transparent px-2 py-1.5 text-left text-xs hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
          active && 'border-focus bg-raised')}>
        <span className="font-mono text-ink">{fmtMjdUtc(o.mjd)}</span>
        <span className="font-mono text-ink-2">D{o.detector}</span>
        <span className="truncate text-ink-3">{o.obs_id} · {o.version} ({o.processing_date})</span>
        <span className="font-mono text-ink-3">{fmtNum(o.lambda_min_um, 2)}–{fmtNum(o.lambda_max_um, 2)} µm</span>
      </button>
    </li>
  );
}

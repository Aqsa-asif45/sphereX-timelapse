import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getTargets, resolve } from '@/lib/api';
import { emit } from '@/lib/events';
import { fmtDec, fmtRa } from '@/lib/format';
import type { Resolved, Target } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useApp, type Position } from '@/state/store';

export interface Picked extends Position { epoch: number; pmra?: number | null; pmdec?: number | null }

const kindTone = (k: string | null | undefined) => (k === 'brown dwarf' ? 'info' : k === 'variable star' ? 'warn' : 'neutral') as 'info' | 'warn' | 'neutral';

export function TargetPicker({ onPick }: { onPick: (p: Picked) => void }) {
  const targets = useQuery({ queryKey: ['targets'], queryFn: ({ signal }) => getTargets(signal), staleTime: Infinity });
  const current = useApp((s) => s.position);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = (r: Resolved, input: string) => {
    emit({ type: 'COORDINATES_VALIDATED', input, ra: r.ra, dec: r.dec, source: r.source });
    onPick({ ra: r.ra, dec: r.dec, label: r.name, source: r.source, slug: r.slug, kind: r.kind, classification: r.classification, epoch: r.epoch_mjd, pmra: r.pmra, pmdec: r.pmdec });
  };

  const run = async (input: string) => {
    setBusy(true);
    setError(null);
    try {
      apply(await resolve(input), input);
    } catch (e) {
      const reason = (e as Error).message;
      setError(reason);
      emit({ type: 'COORDINATES_INVALID', input, reason });
    } finally {
      setBusy(false);
    }
  };

  const pickTarget = (t: Target) => {
    emit({ type: 'TARGET_SELECTED', slug: t.slug, name: t.name });
    void run(t.slug);
  };

  return (
    <section aria-labelledby="pick-h" className="space-y-3">
      <h2 id="pick-h" className="text-xs font-medium uppercase tracking-wider text-ink-3">Target</h2>
      <ul className="space-y-1.5">
        {targets.isPending && <li className="text-sm text-ink-3">Loading the five challenge targets…</li>}
        {targets.isError && <li role="alert" className="text-sm text-danger">Could not load targets: {(targets.error as Error).message}</li>}
        {targets.data?.map((t) => (
          <li key={t.slug}>
            <button
              type="button"
              onClick={() => pickTarget(t)}
              aria-pressed={current?.slug === t.slug}
              className={cn(
                'w-full rounded-ctl border border-line-2 bg-panel px-3 py-2 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                current?.slug === t.slug && 'border-focus bg-raised',
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium text-ink">{t.name}</span>
                <Badge tone={kindTone(t.kind)}>{t.kind}</Badge>
              </span>
              <span className="mt-0.5 block text-xs leading-snug text-ink-3">{t.classification}</span>
            </button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e: FormEvent) => { e.preventDefault(); if (q.trim()) void run(q); }}
        className="space-y-1.5"
      >
        <label htmlFor="q" className="block text-xs text-ink-2">Or a name or coordinates</label>
        <div className="flex gap-2">
          <input
            id="q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="08h55m10.8s −07°14′42″"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!error}
            aria-describedby={error ? 'q-err' : undefined}
            className="h-10 min-w-0 flex-1 rounded-ctl border border-ctl bg-bg-2 px-3 font-mono text-sm text-ink placeholder:text-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          />
          <Button type="submit" variant="primary" disabled={busy || !q.trim()} aria-label="Find"><Search size={16} aria-hidden /></Button>
        </div>
        {error && <p id="q-err" role="alert" className="text-xs text-danger">{error}</p>}
      </form>
      {current && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-ctl border border-line bg-bg-2 p-3 text-xs">
          <dt className="text-ink-3">Name</dt><dd className="text-ink">{current.label}</dd>
          <dt className="text-ink-3">RA</dt><dd className="font-mono text-ink">{fmtRa(current.ra)} <span className="text-ink-3">{current.ra.toFixed(5)}°</span></dd>
          <dt className="text-ink-3">Dec</dt><dd className="font-mono text-ink">{fmtDec(current.dec)} <span className="text-ink-3">{current.dec.toFixed(5)}°</span></dd>
          <dt className="text-ink-3">Position</dt><dd className="text-ink-2">{current.source}</dd>
        </dl>
      )}
    </section>
  );
}

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { getCutout, searchObservations } from '@/lib/api';
import { positionAt, REF_MJD } from '@/lib/astro';
import { emit } from '@/lib/events';
import type { Observation, SearchResult } from '@/lib/types';
import { useApp } from '@/state/store';
import { ActivityLog } from './ActivityLog';
import { MetaPanel } from './MetaPanel';
import { ObservationList } from './ObservationList';
import { TargetPicker, type Picked } from './TargetPicker';
import { ViewerPanel } from './ViewerPanel';

/** What has arrived so far, shown as an explicitly incomplete result until every collection has answered. */
function partialResult(obs: Observation[], startedAt?: number): SearchResult {
  const by: Record<string, number> = {};
  for (const o of obs) by[o.release] = (by[o.release] ?? 0) + 1;
  return {
    ra: 0, dec: 0, radius_deg: 0, collections: [], adapter: 'IRSA SIA2', complete: false, count: obs.length, by_release: by, observations: obs,
    errors: {}, notes: ['Still searching the other collections; more exposures may appear.'], elapsed_s: startedAt ? (Date.now() - startedAt) / 1000 : 0, retrieved_utc: '',
  };
}

/** Phase 1: real data proof. Find every SPHEREx exposure of a spot, open one, and show it with its full provenance. */
export function ProofPage() {
  const { position, search, selected, view, setPosition, setSearch, select } = useApp();

  const onPick = (p: Picked) => {
    // search where a moving target is in mid-2026 (Barnard's Star moves 10″ a year)
    const [ra, dec] = positionAt(p.ra, p.dec, p.epoch, p.pmra, p.pmdec, REF_MJD);
    setPosition({ ...p, ra, dec, ra0: p.ra, dec0: p.dec });
  };

  useEffect(() => {
    if (!position) return;
    const ac = new AbortController();
    setSearch({ status: 'running', progress: [], partial: undefined, startedAt: Date.now(), result: undefined, error: undefined });
    emit({ type: 'SEARCH_STARTED', ra: position.ra, dec: position.dec, collections: ['spherex_dr1', 'spherex_qr3'] });
    const lines: string[] = [];
    const partial: Observation[] = [];
    searchObservations(position.ra, position.dec, (p) => {
      if (p.type === 'COLLECTION_DONE') {
        emit({ type: 'COLLECTION_DONE', collection: p.collection!, count: p.count! });
        lines.push(`${p.collection}: ${p.count} exposures`);
        if (p.observations?.length) {
          // progressive: list and open what has arrived without waiting for slower collections
          partial.push(...p.observations);
          partial.sort((a, b) => a.mjd - b.mjd || a.detector - b.detector);
          setSearch({ partial: [...partial] });
          if (!useApp.getState().selected) select(partial.find((o) => o.release === 'dr1') ?? partial[0]);
        }
      }
      if (p.type === 'COLLECTION_FAILED') { emit({ type: 'COLLECTION_FAILED', collection: p.collection!, error: p.error! }); lines.push(`${p.collection}: failed (${p.error})`); }
      if (p.type === 'FALLBACK') { emit({ type: 'FALLBACK', adapter: p.adapter!, reason: p.reason }); lines.push(`asking ${p.adapter}…`); }
      setSearch({ progress: [...lines] });
    }, ac.signal).then((result) => {
      setSearch({ status: 'done', result });
      if (result.count) emit({ type: 'OBSERVATIONS_FOUND', count: result.count, byRelease: result.by_release, adapter: result.adapter, complete: result.complete });
      else emit({ type: 'SEARCH_FAILED', error: 'No SPHEREx exposures cover this position yet.' });
      // keep what the user is looking at if it is in the final list; otherwise open the first DR1 exposure
      const current = useApp.getState().selected;
      if (!current || !result.observations.some((o) => o.access_url === current.access_url)) {
        select(result.observations.find((o) => o.release === 'dr1') ?? result.observations[0] ?? null);
      }
    }).catch((e: Error) => {
      if (e.name === 'AbortError') return;
      setSearch({ status: 'error', error: e.message });
      emit({ type: 'SEARCH_FAILED', error: e.message });
    });
    return () => ac.abort();
  }, [position, setSearch, select]);

  // the cutout is centred where the target is on that exposure's date
  const centre = selected && position
    ? positionAt(position.ra0 ?? position.ra, position.dec0 ?? position.dec, position.epoch ?? REF_MJD, position.pmra, position.pmdec, selected.mjd)
    : null;
  const cut = useQuery({
    queryKey: ['cutout', selected?.access_url, centre?.[0].toFixed(7), centre?.[1].toFixed(7), view.sizeDeg],
    queryFn: ({ signal }) => getCutout(selected!.access_url, centre![0], centre![1], view.sizeDeg, signal),
    enabled: !!selected && !!centre,
    staleTime: Infinity,
    retry: 1,
  });

  const started = useRef(0);
  useEffect(() => {
    if (!selected) return;
    started.current = performance.now();
    emit({ type: 'CUTOUT_REQUESTED', obsId: selected.obs_id, detector: selected.detector, release: selected.release });
  }, [selected]);
  useEffect(() => {
    if (!selected) return;
    if (cut.isSuccess) emit({ type: 'IMAGE_READY', obsId: selected.obs_id, ms: Math.round(performance.now() - started.current), fromCache: cut.data.from_cache });
    if (cut.isError) emit({ type: 'IMAGE_FAILED', obsId: selected.obs_id, error: (cut.error as Error).message });
  }, [cut.isSuccess, cut.isError, cut.data, cut.error, selected]);

  return (
    <div className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[19rem_minmax(0,1fr)_22rem]">
      <aside className="flex min-h-0 flex-col gap-5 lg:max-h-[calc(100dvh-5.5rem)]" aria-label="Target and observations">
        <TargetPicker onPick={onPick} />
        {search.status === 'running' && (
          <div role="status" className="space-y-1 text-xs text-ink-2">
            <p className="text-ink">Searching IRSA for every SPHEREx exposure here…</p>
            {search.progress.map((l) => <p key={l} className="font-mono">{l}</p>)}
          </div>
        )}
        {search.status === 'running' && search.partial?.length ? <ObservationList result={partialResult(search.partial, search.startedAt)} /> : null}
        {search.status === 'error' && <p role="alert" className="text-sm text-danger">Search failed: {search.error}</p>}
        {search.status === 'done' && search.result && (search.result.count ? <ObservationList result={search.result} /> : <p className="text-sm text-ink-2">No SPHEREx exposures cover this position in DR1 or QR3 yet.</p>)}
      </aside>

      <main id="main" className="flex min-h-[420px] min-w-0 flex-col gap-3 lg:max-h-[calc(100dvh-5.5rem)]">
        {!selected && (
          <div className="grid flex-1 place-items-center rounded-panel border border-dashed border-line-2 p-8 text-center">
            <div className="max-w-md space-y-2">
              <p className="text-lg text-ink">Pick a target to see a real SPHEREx exposure.</p>
              <p className="text-sm text-ink-2">Every image here is a cutout of NASA's own file, read with Astropy, with its release, pipeline version, processing date and quality flags shown alongside.</p>
            </div>
          </div>
        )}
        {selected && cut.isPending && <div role="status" className="grid flex-1 place-items-center rounded-panel border border-line text-sm text-ink-2">Fetching the cutout from IRSA and reading it with Astropy…</div>}
        {selected && cut.isError && (
          <div role="alert" className="grid flex-1 place-items-center rounded-panel border border-danger/40 p-6 text-center text-sm text-danger">
            <div className="space-y-3"><p>This image could not be loaded: {(cut.error as Error).message}</p>
              <button type="button" onClick={() => void cut.refetch()} className="rounded-ctl border border-ctl px-3 py-1.5 text-ink hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">Try again</button></div>
          </div>
        )}
        {selected && cut.isSuccess && <ViewerPanel cutout={cut.data} />}
        <ActivityLog />
      </main>

      {selected && (
        <aside className="min-h-0 overflow-y-auto rounded-panel border border-line bg-panel p-4 lg:col-span-2 xl:col-span-1 xl:max-h-[calc(100dvh-5.5rem)]" aria-label="Details of this exposure">
          <MetaPanel obs={selected} cutout={cut.data} />
        </aside>
      )}
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { ProofPage } from '@/features/proof/ProofPage';

export function App() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: async ({ signal }) => { const r = await fetch('/api/v2/health', { signal }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<{ version: string; astropy: string }>; },
    refetchInterval: 30_000,
  });
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-ctl focus:bg-raised focus:px-3 focus:py-2 focus:text-ink">Skip to the image</a>
      <header className="flex h-14 items-center gap-3 border-b border-line px-4">
        <span aria-hidden className="grid h-6 w-6 place-items-center rounded-full border border-ink-2"><span className="h-2 w-2 rounded-full bg-time" /></span>
        <span className="font-medium tracking-tight">SPHEREx TimeLens</span>
        <Badge tone="info" className="hidden sm:inline-flex">v2 preview · Phase 1: real data proof</Badge>
        <span className="ml-auto flex items-center gap-2 text-xs text-ink-2" role="status">
          <span className={`h-2 w-2 rounded-full ${health.isSuccess ? 'bg-ok' : health.isError ? 'bg-danger' : 'bg-ink-3'}`} aria-hidden />
          {health.isSuccess ? `API ${health.data.version} · Astropy ${health.data.astropy}` : health.isError ? 'API unreachable' : 'Connecting…'}
        </span>
      </header>
      <ProofPage />
      <footer className="border-t border-line px-4 py-3 text-xs text-ink-3">
        SPHEREx data: NASA/JPL-Caltech/IPAC, via the NASA/IPAC Infrared Science Archive (IRSA). Images are shown as stored; nothing is filled in or simulated.
      </footer>
    </div>
  );
}

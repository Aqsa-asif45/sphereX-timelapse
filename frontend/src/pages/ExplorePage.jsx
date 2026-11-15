import { useSearchParams } from 'react-router'
import { useTitle } from '../hooks/useTitle'

/** The TimeLens workspace. Phase 4: the route and its URL; Phase 6 builds the viewer. */
export default function ExplorePage() {
  const [params] = useSearchParams()
  const q =
    params.get('q') ||
    (params.get('ra') && params.get('dec') ? `${params.get('ra')} ${params.get('dec')}` : '')
  useTitle(q || 'Explore')
  return (
    <main id="main" className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-10">
      <h1 className="text-2xl font-semibold">Explore</h1>
      {q ? (
        <p className="text-ink-2">
          Target: <span className="font-mono text-ink">{q}</span>
        </p>
      ) : (
        <p className="text-ink-2">
          Search for a star name or coordinates above, or pick a target on the home page.
        </p>
      )}
      <p className="rounded-panel border border-dashed border-line-2 p-6 text-sm text-ink-3">
        The workspace (Sky, Time, Spectrum and Movers) is built in Phases 6–10.
      </p>
    </main>
  )
}

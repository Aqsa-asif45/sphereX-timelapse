import { Link, useLocation, useSearchParams } from 'react-router'
import { useTitle } from '../hooks/useTitle'
import { BTN } from '../lib/ui'

/** The viewer alone, for iframes on other sites (no top bar, no details panel). Phase 11 fills it in. */
export default function EmbedPage() {
  const [params] = useSearchParams()
  const { search } = useLocation()
  useTitle(params.get('q') || 'Embed')
  return (
    <main
      id="main"
      className="flex min-h-dvh flex-col items-center justify-center gap-3 p-4 text-center"
    >
      <p className="text-ink-2">
        Embedded view of{' '}
        <span className="font-mono text-ink">{params.get('q') || 'a SPHEREx target'}</span>
      </p>
      <Link
        to={`/explore${search}`}
        target="_blank"
        className={BTN.secondary}
      >
        Open in TimeLens <span aria-hidden="true">↗</span>
      </Link>
    </main>
  )
}

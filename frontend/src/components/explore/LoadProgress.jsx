/** How many images have arrived, about how long is left, and a way to fetch failed ones again. */
export default function LoadProgress({ loaded, failed, total, secondsLeft, error, onRetry }) {
  if (!total || (loaded === total && !failed)) return null
  const done = loaded + failed
  const pct = Math.round((100 * loaded) / total)
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm" role="status" data-testid="load-progress">
      {done < total && (
        <>
          <span className="h-1.5 w-40 overflow-hidden rounded-full bg-line" aria-hidden="true">
            <span className="block h-full bg-time transition-[width]" style={{ width: `${pct}%` }} />
          </span>
          <span className="num text-ink-2">
            Loading images: {loaded} of {total}
            {Number.isFinite(secondsLeft) && ` · about ${secondsLeft < 90 ? `${Math.ceil(secondsLeft)} s` : `${Math.ceil(secondsLeft / 60)} min`} left`}
          </span>
        </>
      )}
      {failed > 0 && done >= total && (
        <span className="flex items-center gap-2 text-ink">
          {failed} of {total} images could not be loaded{error ? ` (${error})` : ''}.
          <button type="button" onClick={onRetry} className="rounded-ctl border border-ctl px-3 py-1 hover:bg-hover">
            Try again
          </button>
        </span>
      )}
    </div>
  )
}

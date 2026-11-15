import { useServerStatus } from '../../hooks/useServerStatus'

/** Says out loud when the backend cannot be reached, with a way to try again. */
export default function ServerBanner() {
  const { state, retry } = useServerStatus()
  if (state !== 'down') return null
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 border-b border-danger/40 bg-danger/10 px-4 py-2 text-sm text-ink"
    >
      <span>
        Cannot reach the TimeLens server, so no SPHEREx data can load. Is the backend running on
        port 8000?
      </span>
      <button
        type="button"
        onClick={retry}
        className="rounded-ctl border border-ctl px-3 py-1 text-ink hover:bg-hover"
      >
        Try again
      </button>
    </div>
  )
}

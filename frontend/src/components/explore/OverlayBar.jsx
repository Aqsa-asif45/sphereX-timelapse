import { OVERLAY_COLOURS } from '../../lib/overlays'
import { BTN } from '../../lib/ui'
import { useExploreStore } from '../../store/exploreStore'

/** A small key so each overlay is named, not shown by colour alone. */
function Key({ kind }) {
  const common = 'inline-block h-3 w-3 shrink-0'
  if (kind === 'ring') return <i className={`${common} rounded-full border-2`} style={{ borderColor: OVERLAY_COLOURS.ring }} aria-hidden="true" />
  if (kind === 'gaia') return <i className={`${common} rounded-full border`} style={{ borderColor: OVERLAY_COLOURS.gaia }} aria-hidden="true" />
  if (kind === 'wise') return <i className={`${common} border`} style={{ borderColor: OVERLAY_COLOURS.wise }} aria-hidden="true" />
  return <i className={`${common} rounded-[2px]`} style={{ background: 'rgba(0,230,255,.7)' }} aria-hidden="true" />
}

function status(q, what) {
  if (!q) return null
  if (q.isFetching) return <span className="text-ink-3">loading…</span>
  if (q.isError)
    return (
      <span className="text-danger">
        {q.error.message}{' '}
        <button type="button" className={`${BTN.small} ml-1`} onClick={() => q.refetch()}>
          Try again
        </button>
      </span>
    )
  if (q.data) return <span className="num text-ink-3">{q.data.count ?? q.data.rows.length} {what}</span>
  return null
}

/**
 * Overlay switches (OV-1 to OV-4): target ring, Gaia DR3 stars moved to each image's date (arrows for fast
 * movers), CatWISE2020 sources, and bad pixels from the data-quality flags.
 */
export default function OverlayBar({ hasTarget, gaia, wise, flagsNote }) {
  const { overlays, setOverlay } = useExploreStore()
  const items = [
    ['ring', 'Target ring', 'Where the target should be on each date, using its known motion', !hasTarget],
    ['gaia', 'Gaia DR3 stars', 'Stars from ESA Gaia DR3, moved to each image’s date; arrows show fast movers'],
    ['wise', 'CatWISE2020', 'Infrared sources from WISE/NEOWISE (CatWISE2020)'],
    ['bad', 'Bad pixels', 'Pixels SPHEREx flagged as untrustworthy, tinted cyan (stronger = flagged in more exposures)'],
  ]
  return (
    <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2" data-testid="overlays">
      <legend className="sr-only">Overlays</legend>
      <span className="text-xs text-ink-3" aria-hidden="true">
        Overlays
      </span>
      {items.map(([k, label, hint, disabled]) => (
        <label key={k} className={`flex items-center gap-1.5 ${disabled ? 'opacity-50' : ''}`} title={hint}>
          <input type="checkbox" checked={overlays[k] && !disabled} disabled={disabled} onChange={(e) => setOverlay(k, e.target.checked)} />
          <Key kind={k} />
          {label}
          {k === 'gaia' && overlays.gaia && status(gaia, 'stars')}
          {k === 'wise' && overlays.wise && status(wise, 'sources')}
          {k === 'bad' && overlays.bad && flagsNote && <span className="text-ink-3">{flagsNote}</span>}
        </label>
      ))}
    </fieldset>
  )
}

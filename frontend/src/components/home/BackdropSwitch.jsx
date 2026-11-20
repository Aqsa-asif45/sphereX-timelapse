import { useBackdrop } from '../../store/backdropStore'
import { BACKDROP_LABEL, BACKDROP_SHORT } from './SkyBackdrop'

const OPTIONS = [
  ['illustration', 'Illustration'],
  ['real', 'Real SPHEREx sky'],
]

/**
 * Switch the backdrop between the 3D nebula (an illustration) and NASA's real SPHEREx all-sky map, and say
 * which one is showing. The choice is remembered on this device.
 */
export default function BackdropSwitch({ className = '' }) {
  const { mode, setMode } = useBackdrop()
  return (
    <div className={`flex flex-col items-end gap-1.5 ${className}`}>
      <div role="group" aria-label="Backdrop" className="flex rounded-full border border-white/15 bg-bg-2/60 p-0.5 text-xs backdrop-blur">
        {OPTIONS.map(([m, label]) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            className={`rounded-full px-3 py-1 transition ${mode === m ? 'bg-white/15 text-ink' : 'text-ink-3 hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === 'real' ? (
        <p
          className="max-w-[calc(100vw-2rem)] text-right text-xs text-ink-3"
          title={`${BACKDROP_LABEL}, NASA/IPAC. Never used for measurements. Dark gaps are where NASA masked very bright stars: no data, nothing filled in.`}
        >
          Backdrop: {BACKDROP_SHORT}
        </p>
      ) : (
        <p className="text-right text-xs text-ink-3">Nebula: an illustration, not SPHEREx data</p>
      )}
    </div>
  )
}

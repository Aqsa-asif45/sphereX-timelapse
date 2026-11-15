import { FOVS, fmtSpan, plural } from '../../lib/astro'
import { STRETCHES } from '../../lib/render'
import { COLOURS, COLOUR_LABEL } from '../../lib/scenes'
import { useExploreStore } from '../../store/exploreStore'

const MODES = [
  ['sky', 'Sky', 'The deepest picture: every visit added together'],
  ['time', 'Time', 'Compare visits months apart'],
  ['spectrum', 'Spectrum', 'Brightness across 102 infrared colours'],
  ['movers', 'Movers', 'Let TimeLens search for motion'],
]
const moon = (fov) => (fov / 31 >= 0.9 ? 'about the width of the full Moon' : `about 1/${Math.round(31 / fov)} of the full Moon's width`)
const ctl = 'rounded-ctl border border-ctl bg-raised px-2 py-1 text-sm text-ink'

/** Target and coverage, the four workspace modes, and the view settings. */
export default function StageBar({ target, frames, visits, p, set, disabledColours, detailsOpen, onDetails }) {
  const { contrast, stretch, smooth, set: setUi } = useExploreStore()
  const span = frames.length ? fmtSpan(frames[0].mjd, frames[frames.length - 1].mjd) : ''
  return (
    <div className="flex flex-col gap-3 border-b border-line pb-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{target?.name ?? p.q}</h1>
        {target?.kind && <span className="text-sm text-ink-3">{target.kind}</span>}
        {frames.length > 0 && (
          <span className="num text-sm text-ink-2" data-testid="coverage">
            {plural(frames.length, 'exposure')} · {plural(visits.length, 'visit')} · {span}
          </span>
        )}
        {onDetails && p.q && (
          <button
            type="button"
            onClick={onDetails}
            aria-expanded={detailsOpen}
            aria-controls="details-h"
            className={`ml-auto self-center rounded-ctl border px-3 py-1 text-sm ${detailsOpen ? 'border-focus bg-focus/15 text-ink' : 'border-ctl text-ink-2 hover:bg-hover hover:text-ink'}`}
          >
            Details
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div role="tablist" aria-label="Workspace" className="flex rounded-ctl border border-ctl p-0.5">
          {MODES.map(([m, label, hint]) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={p.mode === m}
              title={hint}
              onClick={() => set({ mode: m })}
              className={`rounded-[4px] px-3 py-1 text-sm ${p.mode === m ? 'bg-focus/20 text-ink' : 'text-ink-2 hover:text-ink'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          Colours
          <select className={ctl} value={p.colours} onChange={(e) => set({ colours: e.target.value })}>
            {COLOURS.map((c) => (
              <option key={c} value={c} disabled={disabledColours?.includes(c)}>
                {COLOUR_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          Field
          <select className={ctl} value={p.fov} onChange={(e) => set({ fov: +e.target.value, z: 1 })}>
            {FOVS.map((f) => (
              <option key={f} value={f}>
                {f}′ wide{f >= 20 ? ' (slower)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          Stretch
          <select className={ctl} value={stretch} onChange={(e) => setUi({ stretch: e.target.value })}>
            {STRETCHES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          Contrast
          <input
            type="range"
            min={4}
            max={200}
            value={contrast}
            onChange={(e) => setUi({ contrast: +e.target.value })}
            aria-valuetext={`full white at ${contrast} sigma`}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-2" title="Blend neighbouring pixels for a softer look (the data are unchanged)">
          <input type="checkbox" checked={smooth} onChange={(e) => setUi({ smooth: e.target.checked })} />
          Smooth display
        </label>
      </div>
      <p className="text-xs text-ink-3">
        {MODES.find(([m]) => m === p.mode)[2]} · Field {p.fov}′, {moon(p.fov)}
      </p>
    </div>
  )
}

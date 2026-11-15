import { fmtMonth } from '../../lib/astro'
import { VIEW_LABEL } from '../../lib/scenes'
import { SPEEDS, useExploreStore } from '../../store/exploreStore'

const seg = (on) => `rounded-[4px] px-3 py-1 text-sm ${on ? 'bg-focus/20 text-ink' : 'text-ink-2 hover:text-ink'}`
const ctl = 'rounded-ctl border border-ctl bg-raised px-2 py-1 text-sm text-ink'
const iconBtn = 'grid h-8 min-w-8 place-items-center rounded-ctl border border-ctl px-2 text-ink hover:bg-hover disabled:opacity-40'

/** Views, visit A/B pickers, the plus/minus switch, and the player (previous, play/pause, next, speed). */
export default function TimeControls({ p, set, visits, seqLen, step }) {
  const { playing, speed, togglePlay, set: setUi } = useExploreStore()
  const compare = ['blink', 'side', 'diff', 'combine'].includes(p.view)
  const nv = visits.length
  const A = p.a ?? nv - 1
  const B = p.b ?? 0
  const picker = (label, value, key, colour) => (
    <label className="flex items-center gap-1.5 text-sm text-ink-2">
      <span className={`rounded px-1.5 text-xs font-semibold text-bg ${colour}`}>{label}</span>
      <select className={ctl} value={value} onChange={(e) => set({ [key]: +e.target.value })} aria-label={`Visit ${label}`}>
        {visits.map((v, i) => (
          <option key={i} value={i}>
            Visit {i + 1} · {fmtMonth(v.mjd)}
          </option>
        ))}
      </select>
    </label>
  )
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div role="group" aria-label="How to compare" className="flex flex-wrap rounded-ctl border border-ctl p-0.5">
        {Object.entries(VIEW_LABEL).map(([v, label]) => (
          <button key={v} type="button" aria-pressed={p.view === v} onClick={() => set({ view: v })} className={seg(p.view === v)}>
            {label}
          </button>
        ))}
      </div>
      {compare && nv > 0 && (
        <>
          {picker('A', A, 'a', 'bg-time')}
          {picker('B', B, 'b', 'bg-earlier')}
        </>
      )}
      {p.view === 'combine' && (
        <div role="group" aria-label="Operation" className="flex rounded-ctl border border-ctl p-0.5">
          <button type="button" aria-pressed={p.op === 'sub'} onClick={() => set({ op: 'sub' })} className={seg(p.op === 'sub')} title="Show what changed">
            minus
          </button>
          <button type="button" aria-pressed={p.op === 'add'} onClick={() => set({ op: 'add' })} className={seg(p.op === 'add')} title="Add the two visits for a deeper image">
            plus
          </button>
        </div>
      )}
      {seqLen > 1 && (
        <div role="group" aria-label="Player" className="flex items-center gap-1">
          <button type="button" className={iconBtn} aria-label="Previous (←)" onClick={() => step(-1)}>
            ‹
          </button>
          <button type="button" className={`${iconBtn} min-w-16`} aria-label={playing ? 'Pause (space)' : 'Play (space)'} onClick={togglePlay}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <button type="button" className={iconBtn} aria-label="Next (→)" onClick={() => step(1)}>
            ›
          </button>
          <label className="ml-2 flex items-center gap-1.5 text-sm text-ink-2">
            Speed
            <select className={ctl} value={speed} onChange={(e) => setUi({ speed: +e.target.value })}>
              {SPEEDS.map((s, i) => (
                <option key={s.label} value={i}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  )
}

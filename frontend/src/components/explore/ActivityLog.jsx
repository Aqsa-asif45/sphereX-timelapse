import { useActivity } from '../../store/activityStore'

const TONE = { info: 'text-ink-2', ok: 'text-ok', warn: 'text-time', error: 'text-danger' }
const MARK = { info: '·', ok: '✓', warn: '!', error: '×' }

/** What the app is doing (HL-5): searching, fallbacks used, images ready or failed, catalogues. */
export default function ActivityLog() {
  const entries = useActivity((s) => s.entries)
  const last = entries[entries.length - 1]
  return (
    <details className="group rounded-panel border border-line bg-panel" data-testid="activity">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm text-ink-2 hover:text-ink">
        <span aria-hidden="true" className="text-ink-3 transition-transform group-open:rotate-90">
          ▸
        </span>
        Activity
        <span className="num text-xs text-ink-3">({entries.length})</span>
        {last && <span className={`min-w-0 truncate text-xs ${TONE[last.tone]}`}>{last.text}</span>}
      </summary>
      <ol role="log" aria-live="polite" className="max-h-56 overflow-y-auto border-t border-line px-3 py-2 font-mono text-xs">
        {entries.length === 0 && <li className="text-ink-3">Nothing yet.</li>}
        {entries.map((e) => (
          <li key={e.id} className={`flex gap-2 ${TONE[e.tone]}`}>
            <span className="num shrink-0 text-ink-3">{e.at.toLocaleTimeString('en-GB')}</span>
            <span aria-hidden="true">{MARK[e.tone]}</span>
            <span>{e.text}</span>
          </li>
        ))}
      </ol>
    </details>
  )
}

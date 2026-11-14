import { useApp } from '@/state/store';

/** The typed event stream, newest first. Lets reviewers see exactly what the app asked for and when. */
export function ActivityLog() {
  const events = useApp((s) => s.events);
  return (
    <details className="rounded-panel border border-line bg-panel">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
        Activity ({events.length} events)
      </summary>
      <ol className="max-h-56 overflow-y-auto border-t border-line px-3 py-2 font-mono text-[11px] leading-5">
        {[...events].reverse().map((e) => {
          const { id, at, type, ...rest } = e;
          return (
            <li key={id} className="grid grid-cols-[5.5rem_11rem_1fr] gap-2">
              <span className="text-ink-3">{new Date(at).toISOString().slice(11, 23)}</span>
              <span className={type.endsWith('FAILED') || type.endsWith('INVALID') ? 'text-danger' : 'text-focus'}>{type}</span>
              <span className="truncate text-ink-2">{JSON.stringify(rest)}</span>
            </li>
          );
        })}
      </ol>
    </details>
  );
}

import { useServerStatus } from '../../hooks/useServerStatus'

const LABEL = {
  checking: 'Checking the server…',
  down: 'Cannot reach the TimeLens server',
}
/** One or two words next to the dot, so the colour is never the only signal (NF-10). */
const WORD = { live: 'Live', backup: 'Backup index', down: 'Offline', checking: 'Checking' }

/** A small dot in the top bar. Status is never colour alone: the words are there for screen readers and on hover. */
export default function StatusDot() {
  const { state, irsa } = useServerStatus()
  const text =
    state === 'ok'
      ? irsa
        ? 'Connected. NASA/IPAC IRSA is reachable.'
        : 'Connected. IRSA unreachable: using the local sky index.'
      : LABEL[state]
  const colour =
    state === 'ok' ? (irsa ? 'bg-ok' : 'bg-time') : state === 'down' ? 'bg-danger' : 'bg-ink-3'
  const word = WORD[state === 'ok' ? (irsa === false ? 'backup' : 'live') : state]
  return (
    <span
      className="flex items-center gap-2 rounded-full border border-white/10 px-2.5 py-1 text-xs text-ink-2"
      title={text}
      data-testid="status-dot"
      data-state={state}
    >
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${colour}`} />
      <span aria-hidden="true">
        {word}
      </span>
      <span className="sr-only" role="status">
        {text}
      </span>
    </span>
  )
}

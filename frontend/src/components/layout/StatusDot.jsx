import { useServerStatus } from '../../hooks/useServerStatus'

const LABEL = {
  checking: 'Checking the server…',
  down: 'Cannot reach the TimeLens server',
}

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
  return (
    <span
      className="flex items-center gap-2"
      title={text}
      data-testid="status-dot"
      data-state={state}
    >
      <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${colour}`} />
      <span className="sr-only" role="status">
        {text}
      </span>
    </span>
  )
}

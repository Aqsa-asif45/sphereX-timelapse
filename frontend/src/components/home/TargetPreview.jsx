import { useEffect, useState } from 'react'
import { previewUrl } from '../../lib/api'

const RETRIES = 4
const WAIT_MS = 30_000

/**
 * A target's looping SPHEREx preview (one frame per visit). If the server has not built it yet, asking for
 * it starts the build, so we show a note and try again every 30 s, a few times.
 * @param {{ slug: string, size: number, alt: string }} props
 */
export default function TargetPreview({ slug, size, alt }) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState('loading') // loading | ok | none

  useEffect(() => {
    if (state !== 'none' || attempt >= RETRIES) return undefined
    const t = setTimeout(() => {
      setState('loading')
      setAttempt((a) => a + 1)
    }, WAIT_MS)
    return () => clearTimeout(t)
  }, [state, attempt])

  return (
    <span
      className="relative grid shrink-0 place-items-center overflow-hidden rounded-ctl bg-bg-2"
      style={{ width: size, height: size }}
    >
      {state !== 'none' && (
        <img
          src={attempt ? `${previewUrl(slug)}?try=${attempt}` : previewUrl(slug)}
          alt={alt}
          width={size}
          height={size}
          loading="lazy"
          onLoad={() => setState('ok')}
          onError={() => setState('none')}
          className={`h-full w-full object-cover transition-opacity ${state === 'ok' ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
      {state === 'loading' && <span className="absolute text-xs text-ink-3">Loading…</span>}
      {state === 'none' && (
        <span className="absolute p-3 text-center text-xs text-ink-3" role="status">
          Preview not built yet.
          {attempt < RETRIES ? ' It is being made now.' : ' Open the target to load its images.'}
        </span>
      )}
    </span>
  )
}

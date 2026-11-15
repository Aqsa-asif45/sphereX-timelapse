import { Link } from 'react-router'
import TargetPreview from './TargetPreview'

/** "Watch a star move": the live SPHEREx preview of Barnard's Star (SH-2), on /start. */
export default function StarPreview() {
  return (
    <figure className="flex w-full max-w-[312px] flex-col gap-3">
      <div className="rounded-panel border border-line-2 bg-panel/70 p-2 backdrop-blur">
        <Link
          to={`/explore?q=${encodeURIComponent("Barnard's Star")}`}
          aria-label="Open Barnard's Star"
        >
          <TargetPreview
            slug="barnard"
            size={296}
            alt="Barnard's Star: one frame per SPHEREx visit, looping. The star shifts between visits."
          />
        </Link>
      </div>
      <figcaption className="text-sm text-ink-2">
        <b className="font-medium text-ink">Barnard&apos;s Star</b>, a 4′ patch of sky. Each frame
        is one SPHEREx visit, months apart; the amber ring marks where the star should be.{' '}
        <span className="rounded-full border border-ok/40 px-2 py-0.5 text-xs whitespace-nowrap text-ok">
          Real SPHEREx data
        </span>
      </figcaption>
    </figure>
  )
}

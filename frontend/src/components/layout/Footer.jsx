import { Link } from 'react-router'

const CREDITS = [
  'SPHEREx (IRSA/AWS)',
  'Gaia DR3',
  'CatWISE2020',
  'Aladin Lite',
]

/** Concise footer credits and method link. */
export default function Footer() {
  return (
    <footer className="border-t border-line/70 px-4 py-3 text-xs text-ink-3">
      <div className="mx-auto flex max-w-7xl flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <p className="leading-relaxed">
          <span className="text-ink-2">Data:</span>{' '}
          {CREDITS.map((c, i) => (
            <span key={c}>
              {i > 0 && (
                <span aria-hidden="true" className="px-1.5 text-line-2">
                  ·
                </span>
              )}
              {c}
            </span>
          ))}
          <span aria-hidden="true" className="px-1.5 text-line-2">
            ·
          </span>
          <span className="text-ink-2">Real NASA data, nothing simulated</span>
        </p>
        <Link
          to="/about"
          className="shrink-0 rounded-ctl px-2 py-0.5 text-ink-2 transition hover:bg-hover hover:text-ink"
        >
          Methods and credits →
        </Link>
      </div>
    </footer>
  )
}

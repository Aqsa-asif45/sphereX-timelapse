import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import {
  PIXEL_ARCSEC,
  REF_MJD,
  fmtDateTime,
  fmtDec,
  fmtRa,
  fmtSpan,
  plural,
  positionAt,
} from '../../lib/astro'
import { PHONE_PX, flagName, isBadBit, readPixel, skyToGrid } from '../../lib/overlays'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { LOOK_FOR } from '../../lib/targets'
import SkyMap from './SkyMap'

const SOURCES = {
  sia2: "IRSA's image search (SIA2)",
  tap: "IRSA's table search (TAP)",
  index: "TimeLens's sky index of NASA's AWS copy",
}

function Section({ title, children }) {
  return (
    <section className="flex flex-col gap-2 border-b border-line px-4 py-3 last:border-b-0">
      <h3 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">{title}</h3>
      {children}
    </section>
  )
}

function KV({ rows }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
      {rows.filter(Boolean).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-3">{k}</dt>
          <dd className="min-w-0 break-words text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

const Note = ({ children, tone }) => (
  <p className={`text-xs ${tone === 'warn' ? 'text-time' : 'text-ink-3'}`}>{children}</p>
)
const mono = (s) => <span className="num font-mono text-[13px]">{s}</span>

/** A few headline numbers as small tiles: the first thing to read. */
function Stats({ items }) {
  const shown = items.filter(Boolean)
  if (!shown.length) return null
  return (
    <dl className="grid grid-cols-[repeat(auto-fit,minmax(66px,1fr))] gap-2">
      {shown.map(([k, v]) => (
        <div key={k} className="rounded-ctl border border-line bg-bg-2 px-2.5 py-1.5">
          <dt className="text-[11px] text-ink-3">{k}</dt>
          <dd className="num text-sm font-medium text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** The exact figures (provenance, ids, coordinates), folded away until asked for. */
function More({ children }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-focus select-none [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="transition-transform group-open:rotate-90">
          ›
        </span>
        Technical details
      </summary>
      <div className="mt-2 flex flex-col gap-2">{children}</div>
    </details>
  )
}

const shortSpan = (a, b) => {
  const f = (mjd) =>
    new Date((mjd - 40587) * 86400000).toLocaleDateString('en-GB', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    })
  return f(a) === f(b) ? f(a) : `${f(a)} – ${f(b)}`
}

/** The six sections of the Details panel (OV-6): plain facts first, exact figures under “Technical details”. */
function InspectorBody(p) {
  const { target: t, result, frames, visits, cur, fov, n, center, cut, images, flagNames, irsa } = p
  const [sky, setSky] = useState(false)
  const [copied, setCopied] = useState('')
  const single = cur && cur.frames.length === 1 && !cur.ref ? cur.frames[0] : null
  const look = t?.slug ? LOOK_FOR[t.slug] : null
  const releases = result ? Object.entries(result.by_release ?? {}) : []

  // flags at the target over the exposures on screen
  const quality = useMemo(() => {
    if (!cur || !center || !cut.quality || !t) return null
    const [gx, gy] = skyToGrid(center, n, ...positionAt(t, cur.mjd)).map(Math.floor)
    if (gx < 0 || gy < 0 || gx >= n || gy >= n) return null
    return readPixel(
      images,
      [...cur.frames, ...(cur.ref ?? [])].map((f) => f.id),
      gy * n + gx,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- images is mutated as cutouts arrive; version tracks it
  }, [cur, center, n, t, cut.quality, cut.version, images])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied('Link copied')
    } catch {
      setCopied('Copying is blocked here: copy the address bar instead')
    }
    setTimeout(() => setCopied(''), 2000)
  }

  const moves = t && (t.pmra || t.pmdec) ? Math.hypot(t.pmra ?? 0, t.pmdec ?? 0) / 1000 : 0
  const badFlags = quality ? quality.flags.filter(([b]) => isBadBit(b)).length : 0

  return (
    <>
      {t && (
        <Section title="Target">
          <p className="text-base font-semibold">
            {t.name} {t.kind && <span className="text-sm font-normal text-ink-3">· {t.kind}</span>}
          </p>
          {look && (
            <p className="text-sm text-ink-2">
              <span className="mr-1.5 rounded-full border border-time/60 px-2 py-0.5 text-xs text-time">
                Look for: {look.what}
              </span>
              {look.hint}
            </p>
          )}
          <Stats
            items={[
              frames.length > 0 && ['Visits', visits.length],
              frames.length > 0 && ['Images', frames.length],
              frames.length > 0 && [
                'When',
                shortSpan(frames[0].mjd, frames[frames.length - 1].mjd),
              ],
              moves > 0 && ['Moves', `${moves.toFixed(2)}″/yr`],
            ]}
          />
          {moves > 0 && <Note>The amber ring shows where it should be on each date.</Note>}
          {t.in_gaia === false && (
            <Note tone="warn">
              Not in Gaia: brown dwarfs are too faint in visible light. Nearby Gaia stars still
              show.
            </Note>
          )}
          {t.note && <Note>{t.note}</Note>}
          <More>
            <KV
              rows={[
                [
                  'RA',
                  <>
                    {mono(fmtRa(t.ra))} <span className="text-ink-3">{t.ra.toFixed(5)}°</span>
                  </>,
                ],
                [
                  'Dec',
                  <>
                    {mono(fmtDec(t.dec))} <span className="text-ink-3">{t.dec.toFixed(5)}°</span>
                  </>,
                ],
                ['Epoch', mono(`MJD ${(+t.epoch_mjd).toFixed(1)}`)],
                moves > 0 && ['Motion', mono(`${moves.toFixed(3)}″ per year`)],
                frames.length > 0 && [
                  'Dates',
                  fmtSpan(frames[0].mjd, frames[frames.length - 1].mjd),
                ],
                ['Position from', t.source],
                t.pm_source && ['Motion from', t.pm_source],
              ]}
            />
          </More>
        </Section>
      )}

      {cur && (
        <Section title="On screen">
          <KV
            rows={[
              ['Showing', cur.label],
              [single ? 'Taken' : 'Dates', single ? mono(fmtDateTime(single.mjd)) : cur.sub],
              single
                ? [
                    'Colour',
                    mono(
                      `${single.lambda_um.toFixed(3)} µm ± ${(single.dlambda_um / 2).toFixed(3)}`,
                    ),
                  ]
                : cur.frames.length > 0 && [
                    'Colours',
                    mono(
                      `${Math.min(...cur.frames.map((f) => f.lambda_um)).toFixed(2)}–${Math.max(...cur.frames.map((f) => f.lambda_um)).toFixed(2)} µm`,
                    ),
                  ],
              ['Field', mono(`${fov}′ wide`)],
            ]}
          />
          {single && (
            <a
              href={single.file_url}
              target="_blank"
              rel="noopener noreferrer"
              className="self-start text-sm text-focus underline underline-offset-2"
            >
              Original FITS at IRSA (about 70 MB)
            </a>
          )}
          <More>
            <KV
              rows={[
                ...(single
                  ? [
                      [
                        'Detector',
                        `Band ${single.det} (${single.det <= 3 ? 'short' : 'long'}-wave array)`,
                      ],
                      ['Release', `${single.release.toUpperCase()} · ${single.version}`],
                      ['Exposure', mono(`${single.week} · obs ${single.obs} · exp ${single.exp}`)],
                    ]
                  : [
                      [
                        'Exposures',
                        mono(`${cur.frames.length}${cur.ref ? ` minus ${cur.ref.length}` : ''}`),
                      ],
                    ]),
                ['Pixels', mono(`${n} × ${n} of ${PIXEL_ARCSEC}″`)],
                center && ['Centre', mono(`${fmtRa(center[0])} ${fmtDec(center[1])}`)],
              ]}
            />
            {moves > 0 && (
              <Note>
                Centred where {t.name} was at the end of 2025 (MJD {REF_MJD}).
              </Note>
            )}
          </More>
        </Section>
      )}

      {result && frames.length > 0 && (
        <Section title="Data quality">
          <Stats
            items={[
              [
                'Loaded',
                `${cut.loaded}/${cut.total}${cut.failed ? ` · ${cut.failed} failed` : ''}`,
              ],
              cut.quality &&
                quality &&
                quality.withFlags > 0 && [
                  'At the target',
                  quality.flags.length === 0
                    ? '✓ Clean'
                    : badFlags
                      ? `⚠ ${plural(badFlags, 'warning')}`
                      : 'Info only',
                ],
            ]}
          />
          {!cut.quality && (
            <Note>Pixel flags load for fields up to 10′. Turn on “Bad pixels” to see them.</Note>
          )}
          {cut.quality && quality && quality.flags.length > 0 && (
            <>
              <ul className="flex flex-wrap gap-1.5" aria-label="Flags at the target">
                {quality.flags.map(([b, k]) => (
                  <li
                    key={b}
                    title={`flag bit ${b}${isBadBit(b) ? ': do not trust this pixel' : ': information only'}`}
                    className={`rounded-full border px-2 py-0.5 font-mono text-xs ${isBadBit(b) ? 'border-time/60 text-time' : 'border-line-2 text-ink-2'}`}
                  >
                    {flagName(b, flagNames)} · {k}/{quality.withFlags}
                    <span className="sr-only">
                      {isBadBit(b) ? ' (bad pixel)' : ' (information)'}
                    </span>
                  </li>
                ))}
              </ul>
              <Note>Amber: don’t trust that pixel. Grey: information only.</Note>
            </>
          )}
          {cut.quality && quality && quality.withFlags === 0 && cut.loaded > 0 && (
            <Note>No flag information at the target.</Note>
          )}
          <Note>Blank pixels stay blank: nothing is filled in.</Note>
        </Section>
      )}

      {result && (
        <Section title="Where this comes from">
          <p className="text-sm text-ink-2">
            Real NASA SPHEREx images
            {releases.length > 0 && (
              <span className="text-ink-3">
                {' '}
                ({releases.map(([r, k]) => `${r.toUpperCase()} ${k}`).join(' · ')})
              </span>
            )}
            , found via{' '}
            {(result.sources ?? []).map((s) => SOURCES[s] ?? s).join(' + ') || 'a saved search'}.
          </p>
          {(result.errors ?? []).length > 0 && <Note tone="warn">{result.errors.join(' · ')}</Note>}
          <More>
            <KV
              rows={[
                result.exposures_available > result.exposures_kept && [
                  'Sampled',
                  mono(
                    `${result.exposures_kept} of about ${result.exposures_available}, evenly over time`,
                  ),
                ],
                result.files_failed > 0 && [
                  'Not reached',
                  mono(`${result.files_failed} files (network)`),
                ],
                [
                  'Searched',
                  mono(
                    `${result.retrieved_utc.replace('T', ' ').replace('Z', ' UTC')}${result.from_cache ? ' (saved)' : ''}`,
                  ),
                ],
                irsa !== null && [
                  'IRSA now',
                  irsa ? 'reachable' : 'unreachable (the sky index is used)',
                ],
                ...(single
                  ? [
                      ['Collection', mono(single.collection)],
                      ['Pipeline', mono(`${single.version}, processed ${single.processing_date}`)],
                      ['This file', single.found_via],
                    ]
                  : []),
              ]}
            />
            <Note>
              Cut from the original files, turned north-up and east-left at SPHEREx’s {PIXEL_ARCSEC}
              ″ pixels (Lanczos-3). Wavelengths from each file’s spectral WCS. Each week from one
              release: DR1, else QR3, else QR2.
            </Note>
          </More>
          <Link to="/about" className="self-start text-sm text-focus underline underline-offset-2">
            How TimeLens works
          </Link>
        </Section>
      )}

      {center && (
        <Section title="Sky around it">
          {sky ? (
            <SkyMap ra={center[0]} dec={center[1]} fovArcmin={fov} />
          ) : (
            <>
              <button
                type="button"
                onClick={() => setSky(true)}
                className="self-start rounded-ctl border border-ctl px-3 py-1.5 text-sm text-ink hover:bg-hover"
              >
                Open the sky map
              </button>
              <Note>Other telescopes’ view, not SPHEREx (2.4 MB).</Note>
            </>
          )}
        </Section>
      )}

      {p.q && (
        <Section title="Share">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={copy}
              className="rounded-ctl border border-ctl px-3 py-1.5 text-sm text-ink hover:bg-hover"
            >
              Copy link
            </button>
            <p role="status" className="text-xs text-ok">
              {copied}
            </p>
          </div>
          <Note>Opens this exact view: target, mode, dates and zoom.</Note>
        </Section>
      )}
    </>
  )
}

/**
 * The Details panel: a side column on wide screens, a drawer below 1200 px and a bottom sheet on phones.
 * The drawer and sheet hold focus inside while open, close with Esc or the backdrop, and return focus to
 * the button that opened them.
 */
export default function Inspector({ open, wide, onClose, ...body }) {
  const phone = useMediaQuery(`(max-width: ${PHONE_PX - 1}px)`)
  const panel = useRef(null)
  const opener = useRef(null)
  const modal = !wide

  useEffect(() => {
    if (!open || !modal) return undefined
    opener.current = document.activeElement
    panel.current?.querySelector('[data-close]')?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      } else if (e.key === 'Tab' && panel.current) {
        const els = [
          ...panel.current.querySelectorAll(
            'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
          ),
        ].filter((el) => !el.disabled && el.offsetParent !== null)
        if (!els.length) return
        const first = els[0]
        const last = els[els.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      opener.current?.focus?.()
    }
  }, [open, modal, onClose])

  const head = (
    <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
      <h2 id="details-h" className="text-sm font-semibold">
        Details
      </h2>
      <button
        type="button"
        data-close
        onClick={onClose}
        aria-label="Close details"
        className="grid h-8 w-8 place-items-center rounded-ctl text-ink-2 hover:bg-hover hover:text-ink"
      >
        ✕
      </button>
    </div>
  )

  if (wide) {
    if (!open) return null
    return (
      <aside
        aria-labelledby="details-h"
        className="sticky top-3 flex max-h-[calc(100dvh-1.5rem)] min-h-0 flex-col self-start overflow-hidden rounded-panel border border-line bg-panel"
        data-testid="details"
        data-layout="side"
      >
        {head}
        <div className="overflow-y-auto">
          <InspectorBody {...body} />
        </div>
      </aside>
    )
  }

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-40 overflow-hidden"
          data-testid="details"
          data-layout={phone ? 'sheet' : 'drawer'}
        >
          <motion.div
            className="absolute inset-0 bg-black/60"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            aria-hidden="true"
          />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby="details-h"
            className={
              phone
                ? 'absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-panel border-t border-line-2 bg-panel'
                : 'absolute inset-y-0 right-0 flex w-[min(400px,92vw)] flex-col border-l border-line-2 bg-panel'
            }
            initial={phone ? { y: '100%' } : { x: '100%' }}
            animate={phone ? { y: 0 } : { x: 0 }}
            exit={phone ? { y: '100%' } : { x: '100%' }}
            transition={{ type: 'tween', duration: 0.25, ease: 'easeOut' }}
          >
            {phone && (
              <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-2" aria-hidden="true" />
            )}
            {head}
            <div className="min-h-0 overflow-y-auto overscroll-contain">
              <InspectorBody {...body} />
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

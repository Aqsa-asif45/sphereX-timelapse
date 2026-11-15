import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { Link } from 'react-router'
import * as api from '../../lib/api'
import { LOOK_FOR, SKY_TARGETS } from '../../lib/targets'
import { inView, rise, stagger } from './motion'
import TargetPreview from './TargetPreview'

const chip = { Motion: 'border-time/50 text-time', Brightness: 'border-[#b48cff]/50 text-[#c9adff]' }

/** The five challenge targets: preview, name, kind, blurb and what to look for. */
export default function TargetCards() {
  const q = useQuery({ queryKey: ['targets'], queryFn: ({ signal }) => api.targets(signal), staleTime: Infinity })
  // until the server answers, show names from the local list so the section never jumps
  const targets = q.data ?? SKY_TARGETS.map((t) => ({ slug: t.slug, name: t.name, kind: t.kind, blurb: '' }))

  return (
    <motion.section aria-labelledby="targets-h" className="border-t border-line pt-8" {...inView} variants={stagger}>
      <motion.div variants={rise} className="mb-4">
        <h2 id="targets-h" className="text-2xl font-medium tracking-tight">
          Five targets from the challenge
        </h2>
        <p className="mt-1.5 text-ink-2">
          Three that move, two that change brightness. Each preview is built from that target&apos;s real SPHEREx
          visits.
        </p>
      </motion.div>
      <motion.ul variants={stagger} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {targets.map((t) => {
          const look = LOOK_FOR[t.slug]
          return (
            <motion.li key={t.slug} variants={rise} whileHover={{ y: -4, transition: { duration: 0.2 } }}>
              <Link
                to={`/explore?q=${encodeURIComponent(t.name)}`}
                className="flex h-full gap-3 rounded-panel border border-line-2 bg-panel p-3 hover:border-ctl hover:bg-raised xl:flex-col"
                data-testid="target-card"
              >
                <TargetPreview slug={t.slug} size={120} alt="" />
                <span className="flex min-w-0 flex-col gap-1">
                  <b className="font-medium text-ink">{t.name}</b>
                  <span className="text-xs text-ink-3">{t.kind}</span>
                  {t.blurb && <span className="text-sm text-ink-2">{t.blurb}</span>}
                  {look && (
                    <span
                      title={look.hint}
                      className={`mt-auto self-start rounded-full border px-2 py-0.5 text-xs ${chip[look.what]}`}
                    >
                      Look for: {look.what}
                    </span>
                  )}
                </span>
              </Link>
            </motion.li>
          )
        })}
      </motion.ul>
      {q.isError && (
        <p role="status" className="mt-3 text-sm text-ink-3">
          Target details could not load from the server; the links still work.
        </p>
      )}
    </motion.section>
  )
}

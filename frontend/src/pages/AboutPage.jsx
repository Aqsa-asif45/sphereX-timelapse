import { useTitle } from '../hooks/useTitle'

/** Methods and credits. Phase 12 writes the full page. */
export default function AboutPage() {
  useTitle('Methods and data')
  return (
    <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-10">
      <h1 className="text-2xl font-semibold">How TimeLens works</h1>
      <p className="text-ink-2">
        TimeLens asks NASA&apos;s archive which SPHEREx exposures cover the spot you chose, reads
        only the small piece of each file it needs, lines every piece up on the same north-up grid,
        and stacks each visit. Every number shown comes from NASA&apos;s own files, and nothing is
        filled in or simulated.
      </p>
      <p className="text-sm text-ink-3">
        The full methods, limits and credits are written in Phase 12.
      </p>
    </main>
  )
}

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import * as api from '../../lib/api'

/**
 * Search by star name or coordinates; suggests the five challenge targets. Submitting opens Explore.
 * @param {{ initial?: string, big?: boolean, id?: string }} props
 */
export default function SearchBox({ initial = '', big = false, id = 'search' }) {
  const [q, setQ] = useState(initial)
  const navigate = useNavigate()
  const targets = useQuery({
    queryKey: ['targets'],
    queryFn: ({ signal }) => api.targets(signal),
    staleTime: Infinity,
  })

  const submit = (e) => {
    e.preventDefault()
    const text = q.trim()
    if (text) navigate(`/explore?q=${encodeURIComponent(text)}`)
  }

  return (
    <form
      role="search"
      onSubmit={submit}
      className={`flex w-full gap-2 ${big ? 'max-w-xl' : 'max-w-md'}`}
    >
      <label htmlFor={id} className="sr-only">
        Star name or sky coordinates
      </label>
      <input
        id={id}
        list={`${id}-targets`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="A star name, or coordinates like 08h55m10.8s −07d14m42s"
        autoComplete="off"
        spellCheck={false}
        className={`min-w-0 flex-1 rounded-ctl border border-ctl bg-bg-2 px-3 text-ink placeholder:text-ink-3 ${big ? 'py-3 text-base' : 'py-1.5 text-sm'}`}
      />
      <datalist id={`${id}-targets`}>
        {(targets.data ?? []).map((t) => (
          <option key={t.slug} value={t.name} />
        ))}
      </datalist>
      <button
        type="submit"
        className={`rounded-ctl bg-time font-medium text-bg hover:brightness-110 ${big ? 'px-5 py-3' : 'px-3 py-1.5 text-sm'}`}
      >
        {big ? 'Explore the sky' : 'Go'}
      </button>
    </form>
  )
}

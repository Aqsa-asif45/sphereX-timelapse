import { useEffect, useState } from 'react'

/** Does this CSS media query match right now? Follows changes (resizing, rotating). */
export function useMediaQuery(query) {
  const get = () => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches
  const [on, setOn] = useState(get)
  useEffect(() => {
    const m = window.matchMedia?.(query)
    if (!m) return undefined
    const f = () => setOn(m.matches)
    f()
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [query])
  return on
}

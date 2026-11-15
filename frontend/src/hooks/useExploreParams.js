import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { DEFAULT_FOV, FOVS } from '../lib/astro'
import { COLOURS } from '../lib/scenes'

export const MODES = ['sky', 'time', 'spectrum', 'movers']
export const VIEWS = ['blink', 'play', 'exposures', 'side', 'diff', 'combine']
const OPS = ['sub', 'add']

const DEFAULTS = { fov: DEFAULT_FOV, mode: 'time', view: 'blink', op: 'sub', colours: 'all', z: 1 }

/**
 * Everything that defines a view lives in the URL (section 8.3), so a copied link rebuilds it exactly.
 * Bad values fall back to the defaults; they never crash the page.
 */
export function readParams(search) {
  const p = new URLSearchParams(search)
  const num = (k) => {
    const v = p.get(k)
    return v !== null && v.trim() !== '' && Number.isFinite(+v) ? +v : undefined
  }
  const pick = (k, list, d) => (list.includes(p.get(k)) ? p.get(k) : d)
  const ra = num('ra')
  const dec = num('dec')
  const a = num('a')
  const b = num('b')
  return {
    q: (p.get('q') || (ra !== undefined && dec !== undefined ? `${ra} ${dec}` : '')).slice(0, 200),
    fov: FOVS.includes(num('fov')) ? num('fov') : DEFAULTS.fov,
    mode: pick('mode', MODES, DEFAULTS.mode),
    view: pick('view', VIEWS, DEFAULTS.view),
    a: a !== undefined && a >= 1 ? Math.round(a) - 1 : null, // URL is 1-based, state 0-based
    b: b !== undefined && b >= 1 ? Math.round(b) - 1 : null,
    op: pick('op', OPS, DEFAULTS.op),
    colours: pick('colours', COLOURS, DEFAULTS.colours),
    z: Math.min(16, Math.max(1, num('z') ?? 1)),
  }
}

export function writeParams(s) {
  const p = new URLSearchParams()
  const c = s.q.match(/^\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*$/)
  if (c) {
    p.set('ra', c[1])
    p.set('dec', c[2])
  } else if (s.q) p.set('q', s.q)
  for (const k of ['fov', 'mode', 'view', 'op', 'colours']) if (s[k] !== DEFAULTS[k]) p.set(k, String(s[k]))
  if (s.a !== null) p.set('a', String(s.a + 1))
  if (s.b !== null) p.set('b', String(s.b + 1))
  if (s.z !== 1) p.set('z', String(+s.z.toFixed(2)))
  return p
}

/** @returns {[ReturnType<typeof readParams>, (partial: object) => void]} */
export function useExploreParams() {
  const [search, setSearch] = useSearchParams()
  const state = useMemo(() => readParams(search.toString()), [search])
  const set = useCallback(
    (partial) => setSearch((cur) => writeParams({ ...readParams(cur.toString()), ...partial }), { replace: true }),
    [setSearch],
  )
  return [state, set]
}

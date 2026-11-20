/**
 * Safe browser storage. Storage can be blocked (private windows, strict settings), so every read and
 * write is wrapped: the app keeps working, it just forgets between visits.
 */

function area(kind) {
  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage
  } catch {
    return null // reading the property itself can throw when storage is blocked
  }
}

/** @template T @param {string} key @param {T} fallback @param {'local'|'session'} [kind] @returns {T} */
export function load(key, fallback, kind = 'local') {
  try {
    const v = area(kind)?.getItem(key)
    return v == null ? fallback : JSON.parse(v)
  } catch {
    return fallback
  }
}

/** @param {string} key @param {unknown} value @param {'local'|'session'} [kind] @returns {boolean} saved or not */
export function save(key, value, kind = 'local') {
  try {
    area(kind)?.setItem(key, JSON.stringify(value))
    return !!area(kind)
  } catch {
    return false
  }
}

export const KEYS = {
  splashSeen: 'timelens.splashSeen', // session
  introSeen: 'timelens.introSeen', // Nova's intro watched or skipped once
  lastExplore: 'timelens.lastExplore', // session: the last /explore view, for the Explore link
  backdrop: 'timelens.backdrop', // 'illustration' (the 3D nebula) or 'real' (the SPHEREx all-sky map)
  seenHelp: 'timelens.seenHelp',
  marks: 'timelens.marks',
  reviews: 'timelens.reviews',
}

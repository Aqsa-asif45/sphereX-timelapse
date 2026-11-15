import { create } from 'zustand'

const MAX = 60
let seq = 0

/**
 * The activity log (HL-5): what the app is doing, newest last. Each entry belongs to one view (target and
 * field); entries for a view the user has already left are dropped instead of being logged late.
 */
export const useActivity = create((set, get) => ({
  view: '',
  entries: [], // {id, at: Date, text, tone: 'info'|'ok'|'warn'|'error'}
  /** A new target or field: start a fresh log. @returns {boolean} true when the view is new */
  begin: (view) => {
    if (get().view === view) return false
    set({ view, entries: [] })
    return true
  },
  /** Log a line for `view`; ignored when the user has moved on to another view. */
  log: (view, text, tone = 'info') => {
    if (view !== get().view) return
    set((s) => ({ entries: [...s.entries.slice(-(MAX - 1)), { id: ++seq, at: new Date(), text, tone }] }))
  },
}))

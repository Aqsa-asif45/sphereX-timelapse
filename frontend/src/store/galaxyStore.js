import { create } from 'zustand'

/**
 * The galaxy zoom between "Start" and the /start page: `to` is where to go when it ends (null = not playing).
 */
export const useGalaxy = create((set) => ({
  to: null,
  go: (to) => set({ to }),
  clear: () => set({ to: null }),
}))

/** For links to /start: plain left clicks play the zoom; new-tab clicks (Ctrl, Shift, middle) work as usual. */
export function zoomOnClick(to) {
  return (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    useGalaxy.getState().go(to)
  }
}

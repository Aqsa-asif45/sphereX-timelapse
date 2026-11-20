import { create } from 'zustand'

/**
 * The transition between "Start" and the /start page: `to` is where to go when it ends (null = not playing).
 * `kind` 'galaxy' always plays the 2D spiral-galaxy zoom (the end of Nova's intro); 'auto' flies through the
 * 3D nebula when it is running, else plays the galaxy zoom.
 */
export const useGalaxy = create((set) => ({
  to: null,
  kind: 'auto',
  go: (to, kind = 'auto') => set({ to, kind }),
  clear: () => set({ to: null, kind: 'auto' }),
}))

/** For links to /start: plain left clicks play the zoom; new-tab clicks (Ctrl, Shift, middle) work as usual. */
export function zoomOnClick(to) {
  return (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    useGalaxy.getState().go(to)
  }
}

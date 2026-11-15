import { create } from 'zustand'

/**
 * Workspace settings that are not part of a shared link (the URL holds target, field, mode, view, visits,
 * colours and zoom; see useExploreParams).
 */
export const SPEEDS = [
  { label: 'Slow', ms: 1200 },
  { label: 'Normal', ms: 700 },
  { label: 'Fast', ms: 350 },
]

export const useExploreStore = create((set) => ({
  contrast: 25, // sigma level shown as full white
  stretch: 'asinh',
  smooth: false, // false = sharp SPHEREx pixels, exactly as recorded
  playing: false,
  speed: 1, // index into SPEEDS
  cur: 0, // current visit (Play visits) or exposure (Every exposure)
  phase: 0, // Blink: 0 shows A, 1 shows B
  overlays: { ring: true, gaia: false, wise: false, bad: false },
  probe: null, // Spectrum: the grid pixel [x, y] the user clicked (null = follow the target)
  jump: null, // an exposure to show once Time > Every exposure opens (set by "Show this exposure")
  details: null, // Details panel: null = the default for the screen size (open on wide screens), else true/false
  set: (partial) => set(partial),
  togglePlay: () => set((s) => ({ playing: !s.playing })),
  setOverlay: (k, on) => set((s) => ({ overlays: { ...s.overlays, [k]: on } })),
}))

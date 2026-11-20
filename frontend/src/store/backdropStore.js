import { create } from 'zustand'
import { KEYS, load, save } from '../lib/storage'

const MODES = ['illustration', 'real']

/**
 * The backdrop behind the splash, Home and /start: the 3D nebula (an illustration) or NASA's real SPHEREx
 * all-sky map. The choice is remembered on this device. `ready` is true while the 3D scene is running, and
 * `flying` asks it to speed forward (the fly-through on Start).
 */
export const useBackdrop = create((set) => ({
  mode: MODES.includes(load(KEYS.backdrop, 'illustration')) ? load(KEYS.backdrop, 'illustration') : 'illustration',
  ready: false,
  flying: false,
  setMode: (mode) => {
    save(KEYS.backdrop, mode)
    set({ mode })
  },
  setReady: (ready) => set({ ready }),
  setFlying: (flying) => set({ flying }),
}))

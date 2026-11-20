import { create } from 'zustand'

/** Whether Nova's intro is open (shown after the splash on a first visit, or replayed from Home). */
export const useIntro = create((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}))

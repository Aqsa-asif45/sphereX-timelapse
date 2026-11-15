/** Shared Motion presets for Home: fade and rise only (opacity + transform), once per element. */

export const EASE = [0.22, 1, 0.36, 1]

export const rise = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } },
}

export const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
}

/** Animate when scrolled into view, once. */
export const inView = { initial: 'hidden', whileInView: 'show', viewport: { once: true, amount: 0.15 } }

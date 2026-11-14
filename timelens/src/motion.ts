/** Shared Framer Motion presets: transform + opacity only, once per element, ease-out.
 *  Wrap trees in <MotionConfig reducedMotion="user"> so reduced-motion users get no movement.
 *  Framer Motion runs on preact/compat (see scripts/build.mjs); its React typings clash with Preact's JSX
 *  (`class`, children), so the few pieces used here are re-exported with Preact-friendly types. */
import { AnimatePresence as FmPresence, motion as fm, MotionConfig as FmConfig, type Variants } from 'framer-motion';
import type { ComponentChildren, FunctionComponent } from 'preact';

export const EASE = [0.22, 1, 0.36, 1] as const;
export const rise: Variants = { hidden: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } } };
export const stagger: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } } };
export const inView = { initial: 'hidden', whileInView: 'show', viewport: { once: true, amount: 0.15 } } as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MotionEl = FunctionComponent<Record<string, any> & { children?: ComponentChildren }>;
type Tag = 'div' | 'section' | 'p' | 'h1' | 'figure' | 'ul' | 'li';
export const motion = fm as unknown as Record<Tag, MotionEl>;
export const MotionConfig = FmConfig as unknown as FunctionComponent<{ reducedMotion: 'user' | 'always' | 'never'; children: ComponentChildren }>;
export const AnimatePresence = FmPresence as unknown as FunctionComponent<{ mode?: 'sync' | 'wait' | 'popLayout'; children: ComponentChildren }>;

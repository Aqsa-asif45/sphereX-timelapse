/**
 * Button styles, shared so every action looks like a button (and links stay for navigation inside text).
 * Use on <button>, on <Link> that acts as a button, and on external links to files.
 */
const base =
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-40'

export const BTN = {
  /** the main action of a view (amber) */
  primary: `${base} rounded-full bg-time px-5 py-2 text-sm font-semibold text-bg hover:brightness-110`,
  /** a second action next to a primary one */
  secondary: `${base} rounded-full border border-ctl bg-bg-2/60 px-4 py-2 text-sm text-ink backdrop-blur hover:border-ink-3 hover:bg-hover`,
  /** a small action inside a panel or a line of text */
  small: `${base} rounded-ctl border border-ctl bg-raised px-2.5 py-1 text-xs font-medium text-ink hover:border-ink-3 hover:bg-hover`,
  /** a small action that removes something */
  danger: `${base} rounded-ctl border border-danger/50 bg-raised px-2.5 py-1 text-xs font-medium text-danger hover:bg-danger/10`,
}

/** A small, consistent icon set: 24-unit grid, 1.8 stroke, round caps. */
import type { JSX } from 'preact';

const P: Record<string, JSX.Element> = {
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  play: <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" />,
  pause: <><rect x="6.5" y="5" width="3.8" height="14" rx="1" fill="currentColor" stroke="none" /><rect x="13.7" y="5" width="3.8" height="14" rx="1" fill="currentColor" stroke="none" /></>,
  prev: <path d="M15 5.5 8.5 12l6.5 6.5" />,
  next: <path d="m9 5.5 6.5 6.5L9 18.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  fit: <><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></>,
  full: <><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" /><rect x="8.5" y="8.5" width="7" height="7" rx="1" /></>,
  panel: <><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M14.5 4.5v15" /></>,
  help: <><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4" /><circle cx="12" cy="16.8" r=".6" fill="currentColor" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7L11.5 6.8" /><path d="M14 10a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.3-1.3" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  download: <><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" /><path d="M5 19h14" /></>,
  sliders: <><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>,
  chevron: <path d="m7 10 5 5 5-5" />,
  target: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" /></>,
  external: <><path d="M14 4h6v6M20 4l-8.5 8.5" /><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  swap: <><path d="M5 8.5h13M15 5.5l3 3-3 3" /><path d="M19 15.5H6M9 12.5l-3 3 3 3" /></>,
  warn: <><path d="M12 4 2.8 19.5h18.4z" /><path d="M12 10v4.2" /><circle cx="12" cy="16.9" r=".6" fill="currentColor" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5" />,
};

export function Icon({ name, size = 18, label }: { name: keyof typeof P | string; size?: number; label?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
      aria-hidden={label ? undefined : 'true'} role={label ? 'img' : undefined} aria-label={label} focusable="false">
      {P[name]}
    </svg>
  );
}

/** The TimeLens mark: an aperture with two moments in it (blue = earlier, amber = later). */
export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" stroke-width="2" />
      <circle cx="12.5" cy="17.5" r="3.2" fill="#6ec3ff" />
      <circle cx="19.5" cy="13.5" r="3.2" fill="#ffb84d" />
    </svg>
  );
}

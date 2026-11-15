/** The TimeLens mark: an amber ring (time) with a star inside. Decorative: the name is always next to it. */
export default function Logo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="10" fill="none" stroke="#ffb84d" strokeWidth="2.4" />
      <circle cx="22" cy="11.5" r="2.8" fill="#ffe2ad" />
      <circle cx="10.5" cy="19.5" r="1.6" fill="#6ec3ff" />
    </svg>
  )
}

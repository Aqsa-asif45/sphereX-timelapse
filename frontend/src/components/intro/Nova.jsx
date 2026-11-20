import { motion, useReducedMotion } from 'motion/react'

/**
 * Nova, the TimeLens space trooper: an original vector illustration (not SPHEREx data), drawn and animated in
 * code. Poses: 'wave' (hello), 'point' (at the scanner), 'cheer' (both arms up).
 * Only transform and opacity animate; with "reduce motion" Motion holds every part still.
 * @param {{ pose?: 'wave'|'point'|'cheer', size?: number, className?: string }} props
 */
export default function Nova({ pose = 'wave', size = 220, className = '' }) {
  const suit = '#e3e9f1'
  const shade = '#a3b1c4'
  const dark = '#1b2431'
  const amber = '#ffb84d'
  const cyan = '#5fd4e3'
  const reduce = useReducedMotion()
  // arm angles in degrees about each shoulder (0 = hanging down; SVG angles turn clockwise)
  const leftSide = { wave: 150, point: 12, cheer: 160 }[pose] // viewer's left arm
  const rightSide = { wave: -10, point: -100, cheer: -160 }[pose] // viewer's right arm (points at the scanner)
  /** An arm hanging from shoulder (sx, 128), turned exactly about that point; the wave swings it. */
  const arm = (sx, deg, swing) => (
    <g transform={`rotate(${deg} ${sx} 128)`}>
      {swing && !reduce && (
        <animateTransform attributeName="transform" type="rotate" values={`0 ${sx} 128;-35 ${sx} 128;0 ${sx} 128`} dur="1.2s" repeatCount="indefinite" additive="sum" />
      )}
      <rect x={sx - 8} y="122" width="16" height="50" rx="8" fill={suit} />
      <circle cx={sx} cy="174" r="9" fill={dark} />
    </g>
  )

  return (
    <motion.svg
      viewBox="0 0 200 260"
      width={size}
      height={size * 1.3}
      className={className}
      aria-hidden="true"
      animate={{ y: [0, -8, 0] }}
      transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
    >
      <defs>
        <linearGradient id="nova-visor" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe2ad" />
          <stop offset="0.45" stopColor={amber} />
          <stop offset="1" stopColor="#c46a1f" />
        </linearGradient>
        <radialGradient id="nova-flame" cx="0.5" cy="0" r="1">
          <stop offset="0" stopColor="#fff4d6" />
          <stop offset="0.5" stopColor={amber} />
          <stop offset="1" stopColor="#ff6b3d" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* jetpack flames */}
      {[78, 122].map((x, k) => (
        <motion.ellipse
          key={x}
          cx={x}
          cy={222}
          rx={8}
          ry={20}
          fill="url(#nova-flame)"
          style={{ originX: 0.5, originY: 0 }}
          animate={{ scaleY: [1, 1.35, 0.9, 1.2, 1], opacity: [0.9, 1, 0.8, 1, 0.9] }}
          transition={{ duration: 0.6, repeat: Infinity, delay: k * 0.15 }}
        />
      ))}
      {/* jetpack */}
      <rect x="66" y="118" width="68" height="84" rx="14" fill={shade} />
      <rect x="70" y="196" width="16" height="12" rx="3" fill={dark} />
      <rect x="114" y="196" width="16" height="12" rx="3" fill={dark} />

      {/* legs */}
      <rect x="76" y="186" width="20" height="42" rx="9" fill={suit} />
      <rect x="104" y="186" width="20" height="42" rx="9" fill={suit} />
      <rect x="72" y="222" width="28" height="14" rx="6" fill={dark} />
      <rect x="100" y="222" width="28" height="14" rx="6" fill={dark} />

      {/* viewer's right arm */}
      {arm(138, rightSide, false)}

      {/* body */}
      <rect x="62" y="110" width="76" height="86" rx="26" fill={suit} />
      <rect x="62" y="150" width="76" height="10" fill={shade} opacity="0.5" />
      {/* chest badge: the TimeLens ring */}
      <circle cx="100" cy="134" r="10" fill={dark} />
      <circle cx="100" cy="134" r="6.5" fill="none" stroke={amber} strokeWidth="2" />
      <circle cx="104" cy="130.5" r="1.8" fill="#ffe2ad" />
      <motion.circle cx="78" cy="176" r="3" fill={cyan} animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.6, repeat: Infinity }} />

      {/* viewer's left arm (waves hello) */}
      {arm(62, leftSide, pose === 'wave')}

      {/* helmet */}
      <line x1="128" y1="30" x2="138" y2="10" stroke={shade} strokeWidth="3" strokeLinecap="round" />
      <motion.circle cx="138" cy="9" r="4" fill={amber} animate={{ opacity: [1, 0.35, 1] }} transition={{ duration: 2, repeat: Infinity }} />
      <circle cx="100" cy="72" r="48" fill={suit} />
      <circle cx="100" cy="72" r="48" fill="none" stroke={shade} strokeWidth="3" />
      <rect x="58" y="96" width="84" height="14" rx="7" fill={shade} />
      {/* visor */}
      <rect x="64" y="48" width="72" height="46" rx="22" fill={dark} />
      <rect x="68" y="51" width="64" height="40" rx="19" fill="url(#nova-visor)" />
      <motion.path
        d="M78 60 Q90 54 104 56"
        stroke="#fff"
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
        animate={{ opacity: [0.85, 0.3, 0.85] }}
        transition={{ duration: 3, repeat: Infinity }}
      />
      <circle cx="118" cy="80" r="3" fill="#fff" opacity="0.5" />
    </motion.svg>
  )
}

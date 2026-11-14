import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

// Tokens from DESIGN.md ("night-shift instrument"): quiet ink, colour only where it means something.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: '#07090e', 2: '#0b0f16' },
        panel: '#0f141c',
        raised: '#151c27',
        hover: '#1b2431',
        line: { DEFAULT: '#1f2835', 2: '#2a3546' },
        ctl: '#5b6b82',
        ink: { DEFAULT: '#edf1f6', 2: '#a9b4c3', 3: '#8592a5' },
        time: '#ffb84d', // later visit A, primary action, target ring
        early: '#6ec3ff', // earlier visit B
        focus: '#5fd4e3', // focus rings, links, selected controls
        flag: '#00e5ff',
        danger: '#ff8a7a',
        ok: '#7fdca4',
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: { ctl: '6px', panel: '10px' },
    },
  },
  plugins: [animate],
} satisfies Config;

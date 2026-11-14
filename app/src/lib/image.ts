/** Display maths shared by the WebGL shader (same formulas) and the tests. Display only: data are never altered. */

export type Stretch = 'linear' | 'asinh' | 'log' | 'sqrt';
export type Colormap = 'inferno' | 'gray';
export type CutPreset = 'p99.5' | 'p99' | 'minmax' | 'sigma';

export const STRETCH_ID: Record<Stretch, number> = { linear: 0, asinh: 1, log: 2, sqrt: 3 };

/** Map t in [0, 1] through a stretch. Must match the GLSL in FitsView. */
export function stretch(t: number, s: Stretch): number {
  const x = Math.min(1, Math.max(0, t));
  if (s === 'asinh') return Math.asinh(10 * x) / Math.asinh(10);
  if (s === 'log') return Math.log(1 + 1000 * x) / Math.log(1001);
  if (s === 'sqrt') return Math.sqrt(x);
  return x;
}

/** Display cuts (MJy/sr) from finite pixels. NaN pixels (blank in SPHEREx) are ignored, never filled. */
export function cuts(data: Float32Array, preset: CutPreset): [number, number] {
  const v = Array.from(data).filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return [0, 1];
  const q = (p: number) => v[Math.min(v.length - 1, Math.max(0, Math.round((p / 100) * (v.length - 1))))];
  if (preset === 'minmax') return [v[0], v[v.length - 1]];
  if (preset === 'sigma') {
    const med = q(50);
    const dev = v.map((x) => Math.abs(x - med)).sort((a, b) => a - b);
    const sig = 1.4826 * dev[Math.floor(dev.length / 2)];
    return [med - 2 * sig, med + 8 * sig];
  }
  const hi = preset === 'p99' ? 99 : 99.5;
  return [q(1), q(hi)];
}

/** 256-entry RGBA colour tables. Inferno from its published deciles (as in v1). */
const INFERNO = ['#000004', '#160b39', '#420a68', '#6a176e', '#932667', '#bc3754', '#dd513a', '#f37819', '#fca50a', '#f6d746', '#fcffa4'];

export function lut(map: Colormap): Uint8Array {
  const out = new Uint8Array(256 * 4);
  const stops = INFERNO.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
  for (let k = 0; k < 256; k++) {
    let c: number[];
    if (map === 'gray') c = [k, k, k];
    else {
      const t = (k / 255) * 10, i = Math.min(9, Math.floor(t)), f = t - i;
      c = [0, 1, 2].map((j) => Math.round(stops[i][j] + (stops[i + 1][j] - stops[i][j]) * f));
    }
    out.set([c[0], c[1], c[2], 255], k * 4);
  }
  return out;
}

/** Names of the flag bits set in a pixel's value. */
export function flagNames(value: number, defs: Record<string, { name?: string }>): string[] {
  if (value <= 0) return [];
  return Object.entries(defs).filter(([b]) => (value >> Number(b)) & 1).map(([b, d]) => d.name ?? `bit ${b}`);
}

/** Shared helpers for TimeLens: URL state, storage, formatting, photometry with uncertainty. */
import type { Frame } from '../../web/src/api';
import { groupVisits as passes, mjdToDate, PIXEL_ARCSEC, type Visit } from '../../web/src/astro';
import type { Colours } from '../../web/src/scene';

/**
 * Visits. Most of the sky gets one SPHEREx pass every ~6 months, lasting days to weeks (grouped
 * by gaps, as in the original app). Near the ecliptic poles SPHEREx sees a spot almost
 * continuously, so one "pass" can last a year, which would hide a variable star's changes:
 * stretches longer than 100 days are cut into visits of about six weeks (an ordinary pass lasts
 * up to ~8 weeks and is left whole). Only real exposures, regrouped.
 */
export function groupVisits(frames: Frame[]): Visit[] {
  const out: Visit[] = [];
  for (const p of passes(frames)) {
    const span = p.end - p.start, k = span > 100 ? Math.round(span / 45) : 1;
    if (k <= 1) { out.push({ ...p, i: out.length }); continue; }
    const step = span / k;
    for (let j = 0; j < k; j++) {
      const lo = p.start + j * step, hi = j === k - 1 ? Infinity : p.start + (j + 1) * step;
      const fs = p.frames.filter((f) => f.mjd >= lo && f.mjd < hi);
      if (fs.length) out.push({ i: out.length, frames: fs, start: fs[0].mjd, end: fs[fs.length - 1].mjd, mjd: fs.reduce((a, f) => a + f.mjd, 0) / fs.length });
    }
  }
  return out;
}

/** One honest coverage status, used everywhere it is shown. */
export function coverageOf(r: { frames: unknown[]; failed: number; source: string; indexed: number; folders: number; observations?: { available: number; checked: number } }) {
  if (!r.frames.length) return { tone: 'mute', label: 'No SPHEREx images yet', note: 'The released data do not cover this position yet.' };
  if (r.failed > 0 || (r.source === 'index' && r.indexed < r.folders)) return { tone: 'warn', label: 'Partial coverage', note: 'Some data could not be reached, or is not indexed yet.' };
  if (r.observations && r.observations.available > r.observations.checked)
    return { tone: 'ok', label: 'Verified, sampled', note: `A busy field: ${r.observations.checked.toLocaleString('en-US')} of ${r.observations.available.toLocaleString('en-US')} observations were used, spread evenly over time.` };
  return { tone: 'ok', label: 'Verified coverage', note: 'Every exposure listed was found and confirmed.' };
}

/** Colour for a moment in the data: earliest blue (like B) through violet and pink to latest amber (like A). */
const TIME_STOPS = [[110, 195, 255], [166, 154, 255], [255, 143, 220], [255, 184, 77]];
export function timeColour(i: number, n: number): string {
  const t = n > 1 ? i / (n - 1) : 1, x = t * (TIME_STOPS.length - 1), k = Math.min(TIME_STOPS.length - 2, Math.floor(x)), f = x - k;
  return `rgb(${TIME_STOPS[k].map((c, j) => Math.round(c + (TIME_STOPS[k + 1][j] - c) * f)).join(',')})`;
}

export const BASE = '/timelens';
export const FOVS = [2, 4, 6, 10, 15, 20, 30]; // arcmin
export const DEFAULT_FOV = 4;
/** Grid size in SPHEREx pixels for a field of view (odd, so the target sits on a pixel centre). */
export const sizeFor = (fov: number) => Math.round((fov * 60) / PIXEL_ARCSEC) | 1;

export type Mode = 'sky' | 'time' | 'spectrum' | 'movers';
export type View = 'blink' | 'play' | 'exposures' | 'side' | 'diff';
export const MODES: Mode[] = ['sky', 'time', 'spectrum', 'movers'];
export const VIEWS: View[] = ['blink', 'play', 'exposures', 'side', 'diff'];
export const COLOURS: Colours[] = ['all', 'six', 'rgb', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6'];
export const COMPARE_VIEWS: View[] = ['blink', 'side', 'diff'];

// ── URL state: everything needed to reproduce a view ─────────────────────────

export interface ExploreState {
  q: string; fov: number; mode: Mode; view: View;
  /** visit indices (0-based) for comparisons; null = default (latest / earliest) */
  a: number | null; b: number | null;
  colours: Colours; z: number;
}

export function readExplore(search: string): ExploreState {
  const p = new URLSearchParams(search);
  const num = (k: string) => { const v = p.get(k); return v !== null && v.trim() !== '' && Number.isFinite(+v) ? +v : undefined; };
  const pick = <T extends string>(k: string, list: readonly T[], d: T): T => (list.includes(p.get(k) as T) ? (p.get(k) as T) : d);
  const ra = num('ra'), dec = num('dec'), a = num('a'), b = num('b');
  return {
    q: (p.get('q') || (ra !== undefined && dec !== undefined ? `${ra} ${dec}` : '')).slice(0, 200),
    fov: FOVS.includes(num('fov') ?? -1) ? num('fov')! : DEFAULT_FOV,
    mode: pick('mode', MODES, 'time'),
    view: pick('view', VIEWS, 'blink'),
    a: a !== undefined && a >= 1 ? Math.round(a) - 1 : null,
    b: b !== undefined && b >= 1 ? Math.round(b) - 1 : null,
    colours: pick('colours', COLOURS, 'all'),
    z: Math.min(16, Math.max(1, num('z') ?? 1)),
  };
}

export function exploreQuery(s: ExploreState): string {
  const p = new URLSearchParams();
  const c = s.q.match(/^\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*$/);
  if (c) { p.set('ra', c[1]); p.set('dec', c[2]); } else if (s.q) p.set('q', s.q);
  if (s.fov !== DEFAULT_FOV) p.set('fov', String(s.fov));
  if (s.mode !== 'time') p.set('mode', s.mode);
  if (s.view !== 'blink') p.set('view', s.view);
  if (s.a !== null) p.set('a', String(s.a + 1));
  if (s.b !== null) p.set('b', String(s.b + 1));
  if (s.colours !== 'all') p.set('colours', s.colours);
  if (s.z !== 1) p.set('z', String(+s.z.toFixed(2)));
  const q = p.toString();
  return q ? '?' + q : '';
}

// ── browser storage (conveniences only; the app works without it) ───────────

export function load<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v === null ? fallback : (JSON.parse(v) as T); } catch { return fallback; }
}
export function save(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage blocked: keep it in memory only */ }
}

// ── formatting ───────────────────────────────────────────────────────────────

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDay = (mjd: number) => { const d = mjdToDate(mjd); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
export const fmtMonth = (mjd: number) => { const d = mjdToDate(mjd); return `${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
export const fmtDateTime = (mjd: number) => mjdToDate(mjd).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

/** "12–19 Sep 2025", "28 Sep – 4 Oct 2025", "30 Dec 2025 – 3 Jan 2026" */
export function fmtSpan(a: number, b: number): string {
  if (b - a < 0.5) return fmtDay(a);
  const A = mjdToDate(a), B = mjdToDate(b);
  if (A.getUTCFullYear() !== B.getUTCFullYear()) return `${fmtDay(a)} – ${fmtDay(b)}`;
  if (A.getUTCMonth() !== B.getUTCMonth()) return `${A.getUTCDate()} ${MON[A.getUTCMonth()]} – ${B.getUTCDate()} ${MON[B.getUTCMonth()]} ${B.getUTCFullYear()}`;
  if (A.getUTCDate() === B.getUTCDate()) return fmtDay(a);
  return `${A.getUTCDate()}–${B.getUTCDate()} ${MON[B.getUTCMonth()]} ${B.getUTCFullYear()}`;
}

/** Length of a gap between visits in plain words. */
export function fmtGap(days: number): string {
  if (days < 1.5) return `${Math.max(1, Math.round(days * 24))} h`;
  if (days < 45) return `${Math.round(days)} days`;
  return `${Math.round(days / 30.44)} months`;
}

/** Numbers for people: 3 significant figures, thousands separated. */
export function fmtNum(v: number, sig = 3): string {
  if (!Number.isFinite(v)) return '–';
  if (Math.abs(v) >= 10 ** sig) return Math.round(v).toLocaleString('en-US');
  return (+v.toPrecision(sig)).toLocaleString('en-US', { maximumFractionDigits: 8 });
}

/** A flux in µJy in the unit that reads best (µJy, mJy or Jy), with its error in the same unit. */
export function fluxUnit(maxAbs: number): [number, string] {
  return maxAbs >= 1e6 ? [1e6, 'Jy'] : maxAbs >= 1e3 ? [1e3, 'mJy'] : [1, 'µJy'];
}
export function fmtFlux(v: number, err?: number): string {
  const [k, u] = fluxUnit(Math.abs(v));
  return `${fmtNum(v / k)}${err !== undefined && Number.isFinite(err) ? ` ± ${fmtNum(err / k, 2)}` : ''} ${u}`;
}

export const plural =(k: number, one: string, many = one + 's') => `${k.toLocaleString('en-US')} ${k === 1 ? one : many}`;

// ── photometry with an uncertainty ───────────────────────────────────────────

const PIX_SR = (PIXEL_ARCSEC / 206264.806) ** 2; // solid angle of one SPHEREx pixel, steradians

/**
 * Aperture photometry at grid pixel (x, y), the same measurement as the original app's
 * `aperture` (sum inside r minus the median of an annulus r+1.5…r+4.5, MJy/sr → µJy), plus an
 * approximate 1σ uncertainty from the annulus scatter: σ_sky·√(N_ap + N_ap²/N_ann).
 * The cutouts are resampled, so neighbouring pixels share noise: treat the error as a guide.
 */
export function measure(raw: Float32Array, n: number, x: number, y: number, r = 1.6): { flux: number; err: number } {
  let sum = 0, cnt = 0;
  const ann: number[] = [], R2 = (r + 4.5) ** 2, r1 = (r + 1.5) ** 2;
  for (let j = Math.floor(y - r - 5); j <= Math.ceil(y + r + 5); j++) for (let i = Math.floor(x - r - 5); i <= Math.ceil(x + r + 5); i++) {
    if (i < 0 || j < 0 || i >= n || j >= n) continue;
    const v = raw[j * n + i];
    if (!Number.isFinite(v)) continue;
    const d2 = (i - x) ** 2 + (j - y) ** 2;
    if (d2 <= r * r) { sum += v; cnt++; } else if (d2 >= r1 && d2 <= R2) ann.push(v);
  }
  if (cnt < 3 || ann.length < 8) return { flux: NaN, err: NaN };
  ann.sort((a, b) => a - b);
  const bg = ann[ann.length >> 1];
  const dev = ann.map((v) => Math.abs(v - bg)).sort((a, b) => a - b);
  const sky = 1.4826 * dev[dev.length >> 1];
  return { flux: (sum - bg * cnt) * PIX_SR * 1e12, err: sky * Math.sqrt(cnt + (cnt * cnt) / ann.length) * PIX_SR * 1e12 };
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b), k = s.length >> 1;
  return s.length & 1 ? s[k] : (s[k - 1] + s[k]) / 2;
}

// ── what to look for at the challenge targets ────────────────────────────────

export const LOOK_FOR: Record<string, { what: 'Motion' | 'Brightness change'; hint: string }> = {
  barnard: { what: 'Motion', hint: 'The fastest-moving star in the sky shifts about 1.7 SPHEREx pixels a year. Blink the first and last visit, or try Difference.' },
  'eps-indi-b': { what: 'Motion', hint: 'A pair of brown dwarfs moving about 4.7″ a year, close to the bright star Epsilon Indi A.' },
  'wise-0855': { what: 'Motion', hint: 'The coldest brown dwarf known. Very faint: if it shows at all, look in the longest-wavelength bands (5 and 6).' },
  'rw-aur': { what: 'Brightness change', hint: 'A young star that dims and brightens unpredictably. Compare its brightness between visits in Spectrum.' },
  'r-dra': { what: 'Brightness change', hint: 'A pulsating giant that brightens and fades over about 8 months. Watch Brightness over time in Spectrum.' },
};

export const isTyping = (e: Event) => {
  const t = e.target as HTMLElement | null;
  return !!t && (['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName) || t.isContentEditable);
};

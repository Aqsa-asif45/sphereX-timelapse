/**
 * Candidate handling for "Find moving things": runs the original app's verified mover finder,
 * cross-checks every find against Gaia DR3, and keeps human-review status and your own marks
 * in this browser.
 */
import * as api from '../../web/src/api';
import type { FindResult, Target } from '../../web/src/api';
import { gridToSky, PIXEL_ARCSEC, type Visit } from '../../web/src/astro';
import { findMovers, type VisitImage } from '../../web/src/movers';
import { visitStack } from '../../web/src/scene';
import type { Store } from './store';
import { load, save } from './util';

export type Review = 'new' | 'review' | 'interesting' | 'rejected' | 'insufficient';
export const REVIEWS: Array<[Review, string]> = [
  ['new', 'New candidate'], ['review', 'Under review'], ['interesting', 'Interesting'], ['rejected', 'Rejected'], ['insufficient', 'Insufficient evidence'],
];

export interface Cand {
  id: string;
  kind: 'moving' | 'once' | 'yours';
  ra: number; dec: number;
  /** grid pixels at the first and last visit used (moving), or where it is */
  x0: number; y0: number; x1: number; y1: number;
  rate: number; pa: number; sig: number; shift: number;
  visits: number[];
  /** undefined = Gaia not checked, null = nothing in Gaia within 15″ */
  gaia?: { pm: number; g: number; sep: number } | null;
  /** Gaia says this is a steady star (a "motion" is then a measurement artefact) */
  dismissed?: boolean;
  /** for your own marks: what was on screen, and the stored mark */
  seen?: string; created?: string; markId?: string;
}

export interface Mark { id: string; target: string; ra: number; dec: number; seen: string; mjd: number; created: string }

const MARKS = 'timelens.marks', REVIEW_KEY = 'timelens.reviews';
export const loadMarks = (): Mark[] => load<Mark[]>(MARKS, []);
export const saveMarks = (m: Mark[]) => save(MARKS, m);

export interface ReviewRec { status: Review; note: string }
export const reviewKey = (target: string, c: { ra: number; dec: number; kind: string }) => `${target}|${c.kind}|${c.ra.toFixed(4)}|${c.dec.toFixed(4)}`;
export const loadReviews = () => load<Record<string, ReviewRec>>(REVIEW_KEY, {});
export const saveReviews = (r: Record<string, ReviewRec>) => save(REVIEW_KEY, r);

export async function runFinder(opts: { result: FindResult; visits: Visit[]; store: Store; center: [number, number]; n: number; fov: number; gaia: api.CatResult | null }): Promise<{ cands: Cand[]; gaia: api.CatResult | null }> {
  const { result, visits, store, center, n, fov } = opts;
  const vis = visits.map((v) => ({ i: v.i, mjd: v.mjd, frames: v.frames.filter((f) => store.get(f.id)).length, s: visitStack(store, v.frames) }))
    .filter((v): v is VisitImage => !!v.s);
  const raw = findMovers(vis, n);
  let gaia = opts.gaia;
  if (!gaia) { try { gaia = await api.catalog('gaia', center[0], center[1], (fov / 60) * 0.75); } catch { gaia = null; } }
  const mid = (result.frames[0].mjd + result.frames[result.frames.length - 1].mjd) / 2, c0 = (n - 1) / 2, D = Math.PI / 180;
  const cands = raw.map((f, k): Cand => {
    const [ra, dec] = gridToSky(center[0], center[1], (f.x0 + f.x1) / 2 - c0, (f.y0 + f.y1) / 2 - c0, PIXEL_ARCSEC);
    let best: Cand['gaia'] = gaia ? null : undefined, bd = 15;
    for (const g of gaia?.rows ?? []) {
      const yrs = (mid - gaia!.epoch) / 365.25, gr = g.ra + ((g.pmra ?? 0) * yrs) / 3.6e6 / Math.cos(g.dec * D), gd = g.dec + ((g.pmdec ?? 0) * yrs) / 3.6e6;
      const d = Math.hypot((gr - ra) * Math.cos(dec * D), gd - dec) * 3600;
      if (d < bd) { bd = d; best = { pm: Math.hypot(g.pmra ?? 0, g.pmdec ?? 0), g: g.mag, sep: d }; }
    }
    // Gaia measured this star and it does not move: our "motion" is an artefact (glare, blends);
    // and a star Gaia sees all the time cannot have "appeared once"
    const dismissed = !!best && (f.kind === 'moving' ? best.pm < 50 : best.g < 18);
    return { id: `C${k + 1}`, kind: f.kind, ra, dec, x0: f.x0, y0: f.y0, x1: f.x1, y1: f.y1, rate: f.rate, pa: f.pa, sig: f.sig, shift: f.shift, visits: f.visits, gaia: best, dismissed };
  });
  return { cands, gaia };
}

/** Your marks for this target, as candidates (grid positions from their sky positions). */
export function marksAsCands(marks: Mark[], target: Target | null, center: [number, number] | null, n: number): Cand[] {
  if (!target || !center) return [];
  const c0 = (n - 1) / 2, D = Math.PI / 180;
  return marks.filter((m) => m.target === target.name).map((m, k): Cand => {
    const gx = c0 - ((((m.ra - center[0] + 540) % 360) - 180) * Math.cos(center[1] * D) * 3600) / PIXEL_ARCSEC;
    const gy = c0 - ((m.dec - center[1]) * 3600) / PIXEL_ARCSEC;
    return { id: `Y${k + 1}`, kind: 'yours', ra: m.ra, dec: m.dec, x0: gx, y0: gy, x1: gx, y1: gy, rate: 0, pa: 0, sig: 0, shift: 0, visits: [], seen: m.seen, created: m.created, markId: m.id };
  });
}

export const compass = (pa: number) => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(pa / 45) % 8];

export function describe(c: Cand): string {
  if (c.kind === 'moving') return `Moving ${c.rate.toFixed(1)}″ per year toward the ${compass(c.pa)}`;
  if (c.kind === 'once') return `Seen only in visit ${c.visits[0] + 1}`;
  return 'Marked by you';
}

/** Why it was selected, in plain words. */
export function why(c: Cand): string {
  if (c.kind === 'moving') return `Its position shifted by ${c.shift.toFixed(1)} SPHEREx pixels (${(c.shift * PIXEL_ARCSEC).toFixed(1)}″) along a straight line across ${c.visits.length} visits. That shift is ${Math.min(99, c.sig).toFixed(0)}× bigger than the expected measurement noise, and more than half a pixel.`;
  if (c.kind === 'once') return `A bright spot (${c.sig.toFixed(0)}× the noise) in visit ${c.visits[0] + 1}, which has enough exposures to trust, with nothing at that exact place in any other visit. It could be an asteroid or comet passing through, or a glitch.`;
  return `You marked this spot${c.seen ? ` while looking at ${c.seen}` : ''}.`;
}

export function gaiaVerdict(c: Cand): { tone: 'ok' | 'warn' | 'hot' | 'mute'; text: string } {
  if (c.kind === 'yours') return { tone: 'mute', text: 'Not checked' };
  if (c.gaia === undefined) return { tone: 'mute', text: 'Gaia not reachable' };
  if (c.gaia === null) return { tone: 'hot', text: 'Not in Gaia' };
  if (c.kind === 'moving' && c.gaia.pm < 50) return { tone: 'warn', text: 'Gaia: steady star' };
  return { tone: 'ok', text: c.gaia.pm > 50 ? `Known mover (${(c.gaia.pm / 1000).toFixed(2)}″/yr)` : 'Known star' };
}

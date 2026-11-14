/**
 * Turn what the user typed into a sky position.
 * - Coordinates: decimal degrees or sexagesimal (08h55m10.8s -07d14m42s, 08:55:10.8 -07:14:42, …).
 * - Names: MAST's name lookup (which asks SIMBAD/NED for us; SIMBAD itself is unreachable from
 *   some networks). Positions are ICRS at epoch J2000.
 * - Proper motion for the challenge targets, so the viewer can show where they should be at
 *   each frame's date. (Barnard's Star has moved ~4.4′ since J2000.)
 */
import { fetchText } from './net.js';

export interface Target {
  name: string; ra: number; dec: number;
  /** epoch of ra/dec as MJD (J2000 = 51544.5) */
  epoch: number;
  /** proper motion, mas/yr (pmra includes cos δ), when known */
  pmra?: number; pmdec?: number;
  kind?: string; source: string; note?: string;
}

const J2000 = 51544.5;

interface Featured {
  slug: string; name: string; kind: string; blurb: string; note?: string;
  /** what to ask MAST for the position */
  lookup?: string;
  /** a position we trust without a lookup (and its epoch) */
  fixed?: { ra: number; dec: number; epoch: number; source: string };
  /** proper motion, mas/yr, and where it comes from */
  pm?: { ra: number; dec: number; source: string };
}

/** Challenge targets. Positions come from MAST at run time unless fixed here. */
export const FEATURED: Featured[] = [
  { slug: 'barnard', name: "Barnard's Star", kind: 'Red dwarf, 6 light-years away', lookup: "Barnard's Star",
    fixed: { ra: 269.4520769586187, dec: 4.6933649665767, epoch: J2000, source: 'SIMBAD via MAST (J2000)' },
    pm: { ra: -801.551, dec: 10362.394, source: 'Gaia DR3' },
    blurb: 'The fastest-moving star in our sky: about 1.7 SPHEREx pixels a year.' },
  { slug: 'eps-indi-b', name: 'Epsilon Indi B', kind: 'Pair of brown dwarfs, 12 light-years away', lookup: '2MASS J22041052-5646577', // "eps Ind B" resolves to the planet "eps Ind b" (lookups ignore case)
    pm: { ra: 3966.7, dec: -2536.2, source: 'ε Indi A, Gaia DR3 (B shares its motion to within a few %)' },
    blurb: 'Two brown dwarfs orbiting a bright star; moves about 4.7″ a year.' },
  { slug: 'wise-0855', name: 'WISE 0855−0714', kind: 'Coldest known brown dwarf, 7 light-years away', lookup: 'WISE J085510.83-071442.5',
    fixed: { ra: 133.7951292, dec: -7.2451472, epoch: 55400, source: 'challenge coordinates (WISE epoch ≈ 2010.6)' },
    pm: { ra: -8118, dec: 680, source: 'Luhman & Esplin 2016 (approximate)' },
    note: 'Visible, if at all, only at the longest wavelengths (≈4–5 µm).', blurb: 'The coldest brown dwarf known. Look in the reddest bands.' },
  { slug: 'rw-aur', name: 'RW Aurigae', kind: 'Young variable star (T Tauri)', lookup: 'RW Aur',
    blurb: 'A young star that dims dramatically and unpredictably.' },
  { slug: 'r-dra', name: 'R Draconis', kind: 'Pulsating red giant (Mira variable)', lookup: 'R Dra',
    blurb: 'A giant star that brightens and fades over about 8 months.' },
];

const SEXA = /^\s*([+-]?\d{1,3})[h:\s]\s*(\d{1,2})[m:\s]\s*(\d{1,2}(?:\.\d*)?)s?\s*[,\s]\s*([+-]?)\s*(\d{1,2})[d°:\s]\s*(\d{1,2})[m′':\s]\s*(\d{1,2}(?:\.\d*)?)["″s]?\s*$/i;
const DECI = /^\s*([+-]?\d+(?:\.\d+)?)\s*(?:°|d|deg)?\s*[,\s]\s*([+-]?\d+(?:\.\d+)?)\s*(?:°|d|deg)?\s*$/i;

export function parseCoords(q: string): { ra: number; dec: number } | null {
  // typographic minus signs and dashes (the app itself shows "−07°14′42″") mean minus
  q = q.replace(/[−‐-―﹣－]/g, '-');
  let m = SEXA.exec(q);
  if (m) {
    const ra = (Math.abs(+m[1]) + +m[2] / 60 + +m[3] / 3600) * 15;
    const dec = (m[4] === '-' ? -1 : 1) * (+m[5] + +m[6] / 60 + +m[7] / 3600);
    if (ra < 360 && Math.abs(dec) <= 90) return { ra, dec };
  }
  m = DECI.exec(q);
  if (m) {
    const ra = +m[1], dec = +m[2];
    if (ra >= 0 && ra < 360 && Math.abs(dec) <= 90) return { ra, dec };
  }
  return null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const cache = new Map<string, Target>();

export async function resolve(q: string): Promise<Target> {
  const c = parseCoords(q);
  if (c) return { name: q.trim(), ...c, epoch: J2000, source: 'coordinates as typed (ICRS)' };
  const n = norm(q);
  if (cache.has(n)) return cache.get(n)!;
  const f = FEATURED.find((t) => norm(t.name) === n || norm(t.slug) === n || (t.lookup && norm(t.lookup) === n));
  let t: Target;
  if (f) {
    const pos = f.fixed ?? (await mast(f.lookup!));
    t = { name: f.name, ra: pos.ra, dec: pos.dec, epoch: pos.epoch, kind: f.kind, note: f.note, source: pos.source + (f.pm ? `; proper motion: ${f.pm.source}` : ''), pmra: f.pm?.ra, pmdec: f.pm?.dec };
  } else {
    const m = await mast(q);
    t = { name: m.name, ra: m.ra, dec: m.dec, epoch: m.epoch, kind: m.kind, source: m.source };
  }
  cache.set(n, t);
  return t;
}

async function mast(q: string): Promise<{ name: string; ra: number; dec: number; epoch: number; kind?: string; source: string }> {
  const req = { service: 'Mast.Name.Lookup', params: { input: q, format: 'json' }, format: 'json' };
  const t = await fetchText('https://mast.stsci.edu/api/v0/invoke', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'request=' + encodeURIComponent(JSON.stringify(req)), timeoutMs: 25_000,
  });
  const r = JSON.parse(t)?.resolvedCoordinate?.[0];
  if (!r || typeof r.ra !== 'number') throw new Error(`No object called “${q}” was found.`);
  return { name: String(r.canonicalName || q).replace(/^NAME /, ''), ra: r.ra, dec: r.decl, epoch: J2000, kind: r.objectType, source: `${r.resolver} via MAST` };
}

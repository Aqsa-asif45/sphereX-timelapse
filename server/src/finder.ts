/**
 * Frame finder: every SPHEREx exposure that contains a sky position, with the exact pixel
 * the position falls on, the observation time, and the wavelength at that pixel.
 *
 * Fast path when IRSA is reachable: its TAP service lists covering images directly.
 * Otherwise: the local sky index (skyindex.ts) proposes candidate observations, and one
 * small header read per exposure (≈6 KB: precise TAN-SIP + time) confirms each one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CACHE, DATA, IRSA_TAP, NPIX } from './config.js';
import { blocks, endOffset, num, parseCards } from './fits.js';
import { cachedLayout, layoutFor, readWcsCards, type Layout } from './layout.js';
import { fetchText, getTail, NotFound, PRIO } from './net.js';
import { folders, keyFor, loadIndex, versionsWith, weeksOf, type Folder } from './skyindex.js';
import { northAngle, skyToPix, skyToTan, wcsFromHeader, type Wcs } from './wcs.js';

export interface Frame {
  id: string;
  key: string;
  release: string; folder: string; version: string;
  obs: number; exp: number; det: number;
  mjd: number;
  /** target position in FITS pixels (1-based) */
  x: number; y: number;
  /** central wavelength and bandwidth at the target pixel, µm */
  lambda: number; dlambda: number;
  /** rotation (deg) that brings north up */
  north: number;
  /** byte where this file's IMAGE pixels start */
  data: number;
}
export interface FrameRec extends Frame { wcs: Wcs }

// ── precise headers (cached on disk per week) ──────────────────────────────

/** A file's header, and the processing version it was read from */
type Hdr = { v: string; wcs: Wcs; mjd: number; data: number };
/** `none`: versions already checked that do not have this file */
type HdrRec = Hdr | { none: string[] };
const hdrMem = new Map<string, Map<string, HdrRec>>();
const hdrDir = path.join(CACHE, 'hdr3'); // hdr3: one record per exposure+detector, naming its version
const dirty = new Set<string>();
let flushTimer: NodeJS.Timeout | null = null;

function hdrStore(folderId: string) {
  let m = hdrMem.get(folderId);
  if (!m) {
    m = new Map();
    try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(path.join(hdrDir, folderId.replace('/', '_') + '.json'), 'utf8')))) m.set(k, v as HdrRec); } catch { /* none */ }
    hdrMem.set(folderId, m);
  }
  return m;
}
function scheduleFlush(folderId: string) {
  dirty.add(folderId);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    fs.mkdirSync(hdrDir, { recursive: true });
    for (const id of dirty) fs.writeFileSync(path.join(hdrDir, id.replace('/', '_') + '.json'), JSON.stringify(Object.fromEntries(hdrMem.get(id)!)));
    dirty.clear();
  }, 2000);
}

/** The header of one exposure on one detector, from the newest processing version that has it. */
async function preciseHeader(f: Folder, obs: number, exp: number, det: number, prio: (typeof PRIO)[keyof typeof PRIO]): Promise<Hdr | null> {
  const fid = f.release + '/' + f.name;
  const store = hdrStore(fid);
  const k = `${obs}.${exp}.${det}`;
  const had = store.get(k);
  if (had && 'v' in had) return had;
  const none = had ? [...had.none] : [];
  const left = versionsWith(f, det).filter((v) => !none.includes(v));
  if (!left.length) return null;
  let rec: HdrRec = { none };
  for (const v of left) {
    try {
      const { h, data } = await readWcsCards(keyFor(f, v, obs, exp, det), v, 'precise', prio);
      rec = { v, wcs: wcsFromHeader(h), mjd: num(h, 'MJD-AVG'), data: data! };
      break;
    } catch (e) {
      if (!(e instanceof NotFound)) throw e;
      none.push(v);
    }
  }
  store.set(k, rec);
  scheduleFlush(fid);
  return 'v' in rec ? rec : null;
}

// ── focal plane: where detectors 2 and 3 sit relative to detector 1 ────────

const FOCAL = path.join(DATA, 'focal.json');
let focal: { d2: [number, number]; d3: [number, number] } | null = null;
try { focal = JSON.parse(fs.readFileSync(FOCAL, 'utf8')); } catch { /* learn on first use */ }

/** Learn from the first exposure for which detectors 1, 2 and 3 all exist (some weeks lack 2 and 3). */
async function focalPlane(indexed: Folder[]) {
  if (focal) return focal;
  const tries: Array<[Folder, number, number]> = [];
  for (const f of indexed) {
    if (![1, 2, 3].every((d) => versionsWith(f, d).length)) continue;
    for (const r of loadIndex(f)!.rows.slice(0, 3)) tries.push([f, r[0], r[1]]);
    if (tries.length >= 24) break;
  }
  for (const [f, obs, exp] of tries) {
    const [h1, h2, h3] = await Promise.all([1, 2, 3].map((d) => preciseHeader(f, obs, exp, d, PRIO.find)));
    if (!h1 || !h2 || !h3) continue;
    const off = (h: Hdr): [number, number] => {
      const p = skyToPix(h1.wcs, h.wcs.crval[0], h.wcs.crval[1])!;
      return [p[0] - h1.wcs.crpix[0], p[1] - h1.wcs.crpix[1]];
    };
    focal = { d2: off(h2), d3: off(h3) };
    fs.writeFileSync(FOCAL, JSON.stringify(focal));
    return focal;
  }
  throw new Error('cannot learn the focal-plane layout');
}

// ── wavelength: lookup table per detector (WCS-WAVE extension, the file's last HDU) ──
// The grid size differs by detector (9×9, 11×11, 13×13 seen), so the table is parsed from
// its own header: columns X (nJ), Y (mJ), VALUES (2·n·m E, TDIM (2,n,m)).

interface WaveTable { x: number[]; y: number[]; v: number[] }
const WAVE = path.join(DATA, 'wave.json');
let waves: Record<string, WaveTable> = {};
try { waves = JSON.parse(fs.readFileSync(WAVE, 'utf8')); } catch { /* fetch on demand */ }
const wavePending = new Map<string, Promise<WaveTable>>();

function waveTable(key: string, det: number, L: Layout): Promise<WaveTable> {
  const id = `${L.major}/D${det}/t2`;
  if (waves[id]) return Promise.resolve(waves[id]);
  if (!wavePending.has(id)) wavePending.set(id, (async () => {
    const b = await getTail(key, 2880 * 4, PRIO.find);
    const s = b.toString('latin1');
    let at = -1;
    for (let o = 0; o < s.length; o += 80) if (s.startsWith("XTENSION= 'BINTABLE'", o) && s.slice(o, o + 2880 * 2).includes("'WCS-WAVE'")) { at = o; break; }
    if (at < 0) throw new Error('WCS-WAVE table not found');
    const end = endOffset(s.slice(at));
    const h = parseCards(s.slice(at, at + end + 80));
    let p = at + blocks(end + 80);
    const cols: Record<string, number[]> = {};
    for (let c = 1; c <= num(h, 'TFIELDS', 0); c++) {
      const m = String(h.get(`TFORM${c}`) ?? '').match(/^(\d*)([JE])/);
      if (!m) throw new Error('unexpected WCS-WAVE column');
      const n = +(m[1] || 1), out: number[] = [];
      for (let k = 0; k < n; k++, p += 4) out.push(m[2] === 'J' ? b.readInt32BE(p) : b.readFloatBE(p));
      cols[String(h.get(`TTYPE${c}`) ?? c).trim()] = out;
    }
    const t = { x: cols.X, y: cols.Y, v: cols.VALUES };
    if (!t.x || !t.y || !t.v || t.v.length !== 2 * t.x.length * t.y.length) throw new Error('WCS-WAVE shape mismatch');
    waves[id] = t;
    fs.writeFileSync(WAVE, JSON.stringify(waves));
    return t;
  })().finally(() => wavePending.delete(id)));
  return wavePending.get(id)!;
}

/** Bilinear lookup. VALUES has TDIM (2,n,m): [quantity, ix, iy]; quantity 0 = λ, 1 = Δλ (µm). */
export function waveAt(t: WaveTable, px: number, py: number): [number, number] {
  const seg = (g: number[], p: number) => {
    let i = 0;
    while (i < g.length - 2 && p > g[i + 1]) i++;
    return [i, Math.min(1, Math.max(0, (p - g[i]) / (g[i + 1] - g[i])))] as const;
  };
  const nx = t.x.length;
  const [i, fx] = seg(t.x, px), [j, fy] = seg(t.y, py);
  const at = (q: number, a: number, b: number) => t.v[q + 2 * (a + nx * b)];
  const bil = (q: number) => (1 - fx) * (1 - fy) * at(q, i, j) + fx * (1 - fy) * at(q, i + 1, j) + (1 - fx) * fy * at(q, i, j + 1) + fx * fy * at(q, i + 1, j + 1);
  return [bil(0), bil(1)];
}

// ── IRSA fast path ─────────────────────────────────────────────────────────

let irsaOk: boolean | null = null;
let irsaCheckedAt = 0;
export async function irsaReachable(): Promise<boolean> {
  if (process.env.FORCE_INDEX) return false; // test the AWS-only path
  if (irsaOk !== null && Date.now() - irsaCheckedAt < 10 * 60_000) return irsaOk;
  irsaCheckedAt = Date.now();
  try { await fetchText(IRSA_TAP.replace('/sync', '/availability'), { timeoutMs: 4000 }); irsaOk = true; } catch { irsaOk = false; }
  return irsaOk;
}

/**
 * Ask IRSA which files cover the position. Returns S3 keys. (Only used when IRSA is reachable.)
 * IRSA's URIs look like `ibe/data/spherex/dr1/level2/<week>/<version>/<det>/<file>.fits`; the part
 * from the release on is the AWS key. An answer that is not the expected CSV is an error, never "no files".
 */
async function irsaKeys(ra: number, dec: number): Promise<string[]> {
  const q = `SELECT a.uri FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid WHERE 1 = CONTAINS(POINT('ICRS', ${ra}, ${dec}), p.poly)`;
  const t = await fetchText(`${IRSA_TAP}?${new URLSearchParams({ QUERY: q, LANG: 'ADQL', FORMAT: 'csv' })}`, { timeoutMs: 30_000 });
  const lines = t.split(/\r?\n/);
  if (lines[0].replace(/"/g, '').trim() !== 'uri') throw new Error('IRSA answered with something other than a file list');
  return lines.slice(1).map((l) => /((?:qr|dr)\d+\/level2\/[^"\s]+)/.exec(l)?.[1]).filter((k): k is string => !!k);
}

// ── the finder ─────────────────────────────────────────────────────────────

const EDGE = 3;        // px: ignore positions this close to a detector edge
/** px: twin detectors (1↔4, 2↔5, 3↔6) are registered to within 24 px (measured over 1135
 *  pairs: median 11, max 23.5), so a position this close outside one may be on the other */
const TWIN_SLACK = 40;
const MARGIN = 450;    // px: exposures 2–4 step up to ~0.6° (≈350 px) from exposure 1, plus distortion
/** Ordinary targets have 100–250 exposures: all are used. Busy fields near the ecliptic poles
 *  (SPHEREx passes them every orbit) can have over a thousand; those are thinned to this many,
 *  spread evenly in time. Each exposure also brings its long-wave twin (up to 2× frames). */
export const MAX_EXPOSURES = 400;

export interface FindProgress { stage: string; done: number; total: number; frames: number }
export interface FindResult {
  /** where the candidate files came from; `indexed` / `folders` count distinct weeks */
  frames: FrameRec[]; source: 'irsa' | 'index' | 'both'; indexed: number; folders: number;
  /** changes whenever a week, a processing version or an index is added: invalidates cached searches */
  stamp: string;
  observations: { available: number; checked: number }; failed: number;
}

const frameCacheDir = path.join(CACHE, 'frames');

export async function findFrames(ra: number, dec: number, onProgress?: (p: FindProgress) => void): Promise<FindResult> {
  const all = await folders();
  const indexed = all.filter((f) => loadIndex(f));
  const weeks = weeksOf(all);
  const indexedWeeks = [...weeks.values()].filter((l) => l.some((f) => loadIndex(f))).length;
  // w2: searches made before one-release-per-week (and DR1) are not reused
  const stamp = `w2/${all.length}/${all.reduce((n, f) => n + f.versions.length, 0)}/${indexed.length}`;
  const cacheKey = `${ra.toFixed(5)}_${dec.toFixed(5)}`;
  const cacheFile = path.join(frameCacheDir, cacheKey + '.json');
  try {
    if (process.env.NO_FRAME_CACHE) throw 0; // testing: always search
    const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (c.stamp === stamp && !c.failed) return c;
  } catch { /* not cached */ }

  // 1. candidate observations: (folder, obs, patch); patch 1–3 = detector pair (1,4) (2,5) (3,6)
  /** dets: the detectors IRSA lists for this exposure (index candidates: unknown) */
  type Cand = { f: Folder; obs: number; exp: number; patch: 1 | 2 | 3; dets?: number[] };
  // Each week is read from ONE release (its best: see weeksOf), so no exposure appears twice.
  // - best release indexed: the sky index (complete: built from the AWS file listing);
  // - otherwise IRSA, whose catalogue lists the current releases (DR1, QR3) but no longer QR2;
  // - IRSA unreachable or failing: the best release of that week that does have an index.
  const cands: Cand[] = [];
  const best = [...weeks.values()].map((l) => l[0]);
  let usedIrsa = false;
  if (best.some((f) => !loadIndex(f)) && (await irsaReachable())) {
    try {
      const want = new Map(best.filter((f) => !loadIndex(f)).map((f) => [`${f.release}/${f.name}`, f]));
      const byExp = new Map<string, Cand>();
      for (const k of await irsaKeys(ra, dec)) {
        const m = k.match(/^((?:qr|dr)\d+)\/level2\/([^/]+)\/[^/]+\/\d\/level2_.*?_(\d{4})_(\d)D(\d)_/);
        const f = m && want.get(`${m[1]}/${m[2]}`);
        if (!f) continue; // a week read from the index, or not from this release
        const det = +m![5], patch = (((det - 1) % 3) + 1) as 1 | 2 | 3, id = `${f.release}/${f.name}/${+m![3]}.${+m![4]}.${patch}`;
        const c = byExp.get(id) ?? byExp.set(id, { f, obs: +m![3], exp: +m![4], patch, dets: [] }).get(id)!;
        if (!c.dets!.includes(det)) c.dets!.push(det);
      }
      cands.push(...byExp.values());
      usedIrsa = true;
    } catch { /* those weeks fall back to an indexed release */ }
  }
  const viaIndex = [...weeks.values()].map((l) => (loadIndex(l[0]) ? l[0] : usedIrsa ? undefined : l.find((f) => loadIndex(f)))).filter((f): f is Folder => !!f);
  const source: FindResult['source'] = usedIrsa ? (viaIndex.length ? 'both' : 'irsa') : 'index';
  if (viaIndex.length) {
    const fp = await focalPlane(indexed);
    // each patch's centre, in detector-1 pixels relative to detector 1's reference pixel
    const offs: Array<[number, number]> = [[0, 0], fp?.d2 ?? [NaN, NaN], fp?.d3 ?? [NaN, NaN]];
    for (const f of viaIndex) {
      const has = [1, 2, 3].map((p) => versionsWith(f, p).length + versionsWith(f, p + 3).length > 0);
      for (const r of loadIndex(f)!.rows) {
        const [obs, exp, ra0, dec0, p11, p12, p21, p22, ref] = r;
        const r0 = offs[(ref - 1) % 3];
        if (Math.abs(dec0 - dec) > 12) continue; // cheap reject: the three patches span about ±6°
        const t = skyToTan(ra0, dec0, ra, dec);
        if (!t) continue;
        const det = p11 * p22 - p12 * p21, U = (p22 * t[0] - p12 * t[1]) / det, V = (-p21 * t[0] + p11 * t[1]) / det;
        for (let p = 1; p <= 3; p++) {
          if (!has[p - 1] || !Number.isFinite(offs[p - 1][0])) continue;
          const dx = U - (offs[p - 1][0] - r0[0]), dy = V - (offs[p - 1][1] - r0[1]);
          if (Math.abs(dx) < NPIX / 2 + MARGIN && Math.abs(dy) < NPIX / 2 + MARGIN) cands.push({ f, obs, exp, patch: p as 1 | 2 | 3 });
        }
      }
    }
  }
  // 2. one job per exposure (and detector pair): IRSA names exact exposures; the index names
  //    observations, whose four stepped exposures may or may not all contain the position
  let jobs: Array<{ f: Folder; obs: number; exp: number; det: number; dets?: number[] }> = [];
  const seen = new Set<string>();
  cands.sort((a, b) => (a.f.name < b.f.name ? -1 : a.f.name > b.f.name ? 1 : a.obs - b.obs || a.exp - b.exp));
  for (const c of cands) for (let exp = 1; exp <= 4; exp++) {
    const id = `${c.f.release}/${c.f.name}/${c.obs}.${exp}.${c.patch}`;
    if (c.dets && exp !== c.exp) continue; // IRSA named this exact exposure
    if (!seen.has(id)) { seen.add(id); jobs.push({ f: c.f, obs: c.obs, exp, det: c.patch, dets: c.dets }); }
  }
  // IRSA names exactly the exposures that contain the position; the index proposes candidates,
  // roughly half of which turn out not to. So the index gets a larger budget before checking.
  const thin = <T,>(a: T[], k: number) => Array.from({ length: k }, (_, i) => a[Math.round((i * (a.length - 1)) / (k - 1))]);
  const candidates = jobs.length, preCap = source === 'irsa' ? MAX_EXPOSURES : 3 * MAX_EXPOSURES;
  const preThinned = jobs.length > preCap;
  if (preThinned) jobs = thin(jobs, preCap);
  let frames: FrameRec[] = [];
  let done = 0, failed = 0;
  const tick = () => onProgress?.({ stage: 'confirming', done, total: jobs.length, frames: frames.length });
  tick();
  /** 'in' = the position is on this detector; 'near' = just off it (the twin may still have it);
   *  'out' = well off it; 'missing' = no such file in any version of the week */
  const confirm = async (f: Folder, obs: number, exp: number, det: number): Promise<'in' | 'near' | 'out' | 'missing'> => {
    const h = await preciseHeader(f, obs, exp, det, PRIO.find);
    if (!h) return 'missing';
    const p = skyToPix(h.wcs, ra, dec);
    if (!p) return 'out';
    const lo = 1 + EDGE, hi = NPIX - EDGE;
    if (p[0] < lo || p[1] < lo || p[0] > hi || p[1] > hi) return Math.max(lo - p[0], lo - p[1], p[0] - hi, p[1] - hi) < TWIN_SLACK ? 'near' : 'out';
    const key = keyFor(f, h.v, obs, exp, det);
    const [lambda, dlambda] = waveAt(await waveTable(key, det, cachedLayout(h.v)!), p[0], p[1]);
    frames.push({
      id: `${f.release}/${f.name}/${obs}.${exp}.D${det}`, key, release: f.release, folder: f.name, version: h.v,
      obs, exp, det, mjd: h.mjd, x: p[0], y: p[1], lambda, dlambda, north: northAngle(h.wcs, p[0], p[1]), data: h.data, wcs: h.wcs,
    });
    return 'in';
  };
  await Promise.all(jobs.map(async (j) => {
    try {
      if (j.dets) await Promise.all(j.dets.map((d) => confirm(j.f, j.obs, j.exp, d))); // IRSA: exactly the files it lists
      // index: the short-wave detector (1–3) and its long-wave twin (4–6) see the same sky
      else if ((await confirm(j.f, j.obs, j.exp, j.det)) !== 'out') await confirm(j.f, j.obs, j.exp, j.det + 3);
    } catch { failed++; } // one stalled request must not sink the whole search
    done++;
    tick();
  }));
  frames.sort((a, b) => a.mjd - b.mjd || a.det - b.det);
  // busy fields: keep at most MAX_EXPOSURES exposures, evenly spread in time (twins stay together)
  const byExp = new Map<string, FrameRec[]>();
  for (const fr of frames) { const k = `${fr.release}/${fr.folder}/${fr.obs}.${fr.exp}.${((fr.det - 1) % 3) + 1}`; (byExp.get(k) ?? byExp.set(k, []).get(k)!).push(fr); }
  let exposures = [...byExp.values()];
  const found = exposures.length;
  if (exposures.length > MAX_EXPOSURES) { exposures = thin(exposures, MAX_EXPOSURES); frames = exposures.flat(); }
  // how many exposures contain the position: counted, or estimated when candidates had to be thinned
  const available = preThinned ? Math.round((found * candidates) / preCap) : found;
  const out: FindResult = { frames, source, indexed: indexedWeeks, folders: weeks.size, stamp, observations: { available, checked: exposures.length }, failed };
  // an empty answer is kept only for this request: it may be an archive hiccup, and caching it would hide the data for good
  if (!process.env.NO_FRAME_CACHE && frames.length) {
    fs.mkdirSync(frameCacheDir, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(out));
  }
  return out;
}

export const publicFrame = ({ wcs: _w, ...f }: FrameRec): Frame => f;

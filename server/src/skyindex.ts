/**
 * The sky index: where every SPHEREx observation pointed.
 *
 * IRSA's TAP service answers "which images cover this position?" instantly, but it is not
 * reachable from every network. NASA's AWS bucket always is, but has no spatial index.
 * So we build one: for every observation (4 exposures stepped 0.2° apart) we read ~1 KB of
 * one exposure's header (pointing + orientation). Detectors 2 and 3 sit at fixed offsets in
 * the focal plane; detectors 4–6 see the same sky as 1–3 through a dichroic.
 *
 * A week is not always one folder: 42 of the first 151 weeks hold two or three processing
 * versions, often split by detector (e.g. 2025W17: detectors 2–6 in "-240", detector 1 in
 * "-241") or by batches of observations ("l2b" and "l2b_retry"). A week is therefore the
 * union of its versions, and every file is read from the newest version that has it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA, RELEASES } from './config.js';
import { num } from './fits.js';
import { cachedLayout, layoutFor, readWcsCards } from './layout.js';
import { list, NotFound, PRIO } from './net.js';

type Prio = (typeof PRIO)[keyof typeof PRIO];

export interface Folder {
  release: string; name: string;
  /** `${release}/level2/${name}/` */
  base: string;
  /** processing versions, newest first */
  versions: string[];
  /** detectors present in each version */
  dets: Record<string, number[]>;
}
/** [obs, exp, ra, dec, pc11, pc12, pc21, pc22, refDet]: the pointing of one exposure, read from detector refDet */
export type CoarseRow = [number, number, number, number, number, number, number, number, number];
/** format 3 = built from the bucket listing (complete); 2 and older = probed, kept as a starting point */
export interface FolderIndex { format: 2 | 3; release: string; name: string; versions: string[]; built: string; rows: CoarseRow[] }

const IDX = path.join(DATA, 'index');
const FOLDERS = path.join(DATA, 'folders.json');
const pad4 = (n: number) => String(n).padStart(4, '0');

export const keyFor = (f: Folder, version: string, obs: number, exp: number, det: number) =>
  `${f.base}${version}/${det}/level2_${f.name}_${pad4(obs)}_${exp}D${det}_spx_${version}.fits`;

/** Versions of a week that contain a detector, newest first. */
export const versionsWith = (f: Folder, det: number) => f.versions.filter((v) => f.dets[v]?.includes(det));

/** Newest first: by pipeline version, then processing date, then "retry" over the original run. */
function versionOrder(a: string, b: string) {
  const k = (v: string) => { const m = v.match(/v(\d+)-(\d{4})-(\d{3})/); return m ? [+m[1], +m[2] * 1000 + +m[3], v.includes('retry') ? 1 : 0] : [0, 0, 0]; };
  const x = k(a), y = k(b);
  return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
}

// ── folders ────────────────────────────────────────────────────────────────

let folderCache: { format?: number; at: number; folders: Folder[] } | null = null;
try { folderCache = JSON.parse(fs.readFileSync(FOLDERS, 'utf8')); if (folderCache?.format !== 2) folderCache = null; } catch { /* none yet */ }

/** All weeks across releases with their versions and detectors; refreshed at most daily (data arrive weekly). */
export async function folders(refresh = false): Promise<Folder[]> {
  if (folderCache && !refresh && Date.now() - folderCache.at < 86_400_000) return folderCache.folders;
  const releases = new Set(RELEASES);
  try { for (const p of (await list('', { delimiter: true })).prefixes) if (/^qr\d+\/$/.test(p)) releases.add(p.slice(0, -1)); } catch { /* keep configured list */ }
  const out: Folder[] = [];
  for (const release of [...releases].sort()) {
    const names = (await list(`${release}/level2/`, { delimiter: true })).prefixes.map((p) => p.split('/')[2]).filter(Boolean);
    await Promise.all(names.map(async (name) => {
      const base = `${release}/level2/${name}/`;
      const versions = (await list(base, { delimiter: true })).prefixes.map((p) => p.split('/')[3]).filter(Boolean).sort(versionOrder);
      const dets: Record<string, number[]> = {};
      await Promise.all(versions.map(async (v) => {
        dets[v] = (await list(`${base}${v}/`, { delimiter: true })).prefixes.map((p) => +p.split('/')[4]).filter((d) => d >= 1 && d <= 6).sort();
      }));
      if (versions.length) out.push({ release, name, base, versions, dets });
    }));
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.release.localeCompare(b.release)));
  folderCache = { format: 2, at: Date.now(), folders: out };
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(FOLDERS, JSON.stringify(folderCache));
  return out;
}

/** Approximate mid-date of a folder from its name (ISO week), as MJD. Good to a few days. */
export function folderMjd(name: string): number {
  const m = name.match(/^(\d{4})W(\d{2})_(\d)/);
  if (!m) return NaN;
  const [y, w, part] = [+m[1], +m[2], +m[3]];
  const jan4 = Date.UTC(y, 0, 4), dow = (new Date(jan4).getUTCDay() + 6) % 7;
  const monday = jan4 - dow * 86_400_000 + (w - 1) * 7 * 86_400_000;
  return monday / 86_400_000 + 40587 + Math.min(6, (part - 1) * 1.75 + 0.9);
}

// ── coarse index ───────────────────────────────────────────────────────────

const loaded = new Map<string, FolderIndex>();
const fileOf = (f: Folder) => path.join(IDX, `${f.release}_${f.name}.json`);

/** Read an index file; older single-version files are converted in place (no download needed). */
function readIndexFile(f: Folder): FolderIndex | undefined {
  let x: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { x = JSON.parse(fs.readFileSync(fileOf(f), 'utf8')); } catch { return undefined; }
  if (x.format === 3 || x.format === 2) return x;
  if (typeof x.version === 'string' && Array.isArray(x.obs) && (x.obs.length || x.dets)) {
    return { format: 2, release: x.release, name: x.name, versions: [x.version], built: x.built, rows: x.obs.map((r: number[]) => [...r.slice(0, 8), x.ref ?? 1] as CoarseRow) };
  }
  return undefined;
}

/** The index of a week, only if it was built from the listing of every version the week has now. */
export function loadIndex(f: Folder): FolderIndex | undefined {
  const id = f.release + '/' + f.name;
  let x = loaded.get(id);
  const complete = (i?: FolderIndex) => !!i && i.format === 3 && f.versions.every((v) => i.versions.includes(v));
  if (!complete(x)) { x = readIndexFile(f); if (x) loaded.set(id, x); }
  return complete(x) ? x : undefined;
}

async function coarseRead(f: Folder, version: string, obs: number, exp: number, det: number, prio: Prio): Promise<CoarseRow> {
  const { h } = await readWcsCards(keyFor(f, version, obs, exp, det), version, 'coarse', prio);
  return [obs, exp, num(h, 'CRVAL1'), num(h, 'CRVAL2'), num(h, 'PC1_1'), num(h, 'PC1_2'), num(h, 'PC2_1'), num(h, 'PC2_2'), det];
}

/**
 * The observation numbers one detector of one version holds, straight from the bucket listing.
 * Grouping keys by "_" right after the observation number gives one entry per observation
 * (~40 KB per detector folder instead of ~600 KB for the full key list). Numbering does not
 * always start at 1 (a reprocessing may hold only observations 105–741), so never guess it.
 */
async function listedObs(f: Folder, version: string, det: number, prio: Prio): Promise<number[]> {
  const pre = `${f.base}${version}/${det}/level2_${f.name}_`;
  const { prefixes } = await list(pre, { delimiter: '_', prio });
  return prefixes.map((p) => +p.slice(pre.length, -1)).filter((n) => Number.isInteger(n) && n > 0);
}

/**
 * Index one week from the exact list of files on AWS: every version (newest first) and every
 * detector, so an observation is found even if it exists in only one version or detector.
 * Pointings already in an older index file are kept; only the missing ones are read.
 */
export async function indexFolder(f: Folder, prio: Prio = PRIO.background, onProgress?: (n: number) => void): Promise<FolderIndex> {
  const have = loadIndex(f);
  if (have) return have;
  const prev = readIndexFile(f);
  const rows: CoarseRow[] = prev ? [...prev.rows] : [];
  const claimed = new Set(rows.map((r) => r[0]));
  const pairs = f.versions.flatMap((version) => [1, 2, 3, 4, 5, 6].filter((d) => f.dets[version]?.includes(d)).map((det) => ({ version, det })));
  const listed = await Promise.all(pairs.map(async (p) => ({ ...p, obs: await listedObs(f, p.version, p.det, prio) })));
  // newest version first, short-wave detector first: the first place an observation appears is where its pointing is read
  const todo: Array<{ version: string; det: number; obs: number }> = [];
  for (const p of listed) for (const obs of p.obs) if (!claimed.has(obs)) { claimed.add(obs); todo.push({ version: p.version, det: p.det, obs }); }
  for (const version of new Set(todo.map((t) => t.version))) {
    const t = todo.find((x) => x.version === version)!;
    for (let e = 1; e <= 4 && !cachedLayout(version); e++) {
      try { await layoutFor(version, keyFor(f, version, t.obs, e, t.det)); } catch (err) { if (!(err instanceof NotFound)) throw err; }
    }
  }
  let next = 0, unreadable = 0;
  await Promise.all(Array.from({ length: 32 }, async () => {
    while (next < todo.length) {
      const t = todo[next++];
      let got = false;
      for (let e = 1; e <= 4 && !got; e++) {
        try { rows.push(await coarseRead(f, t.version, t.obs, e, t.det, prio)); got = true; } catch (err) { if (!(err instanceof NotFound)) throw err; }
      }
      if (!got) unreadable++;
      else if (rows.length % 50 === 0) onProgress?.(rows.length);
    }
  }));
  if (unreadable) console.warn(`${f.release}/${f.name}: ${unreadable} listed observations had no readable exposure`);
  rows.sort((a, b) => a[0] - b[0]);
  const x: FolderIndex = { format: 3, release: f.release, name: f.name, versions: [...f.versions], built: new Date().toISOString(), rows };
  fs.mkdirSync(IDX, { recursive: true });
  fs.writeFileSync(fileOf(f), JSON.stringify(x));
  loaded.set(f.release + '/' + f.name, x);
  return x;
}

/** How much of the sky history is indexed. */
export async function coverage() {
  const all = await folders();
  const done = all.filter((f) => loadIndex(f));
  return { folders: all.length, indexed: done.length, observations: done.reduce((n, f) => n + loadIndex(f)!.rows.length, 0) };
}

export { pad4 };

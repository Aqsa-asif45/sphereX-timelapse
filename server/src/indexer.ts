/**
 * Build the sky index (see skyindex.ts). Resumable: indexed folders are skipped.
 *   npm run index                 all folders, challenge-target weeks first
 *   npm run index -- --only-targets   just the weeks that can contain the challenge targets
 */
import { coverage, folderMjd, folders, indexFolder, loadIndex, type Folder } from './skyindex.js';
import { netStats, PRIO } from './net.js';
import { toEcliptic } from './wcs.js';

// approximate positions, only used to order the work
const TARGETS: Array<[string, number, number]> = [
  ["Barnard's Star", 269.45, 4.69], ['Epsilon Indi B', 331.0, -56.8], ['WISE 0855', 133.8, -7.2], ['RW Aur', 76.96, 30.4], ['R Dra', 248.17, 66.75],
];

/** Apparent solar longitude (deg) at MJD, to ~0.01°. */
function sunLon(mjd: number) {
  const n = mjd - 51544.5, D = Math.PI / 180;
  const L = 280.46 + 0.9856474 * n, g = (357.528 + 0.9856003 * n) * D;
  return (((L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) % 360) + 360) % 360;
}
const dLon = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/** Can this folder's survey strips (near solar elongation ~70–130°) contain any target? */
function relevant(f: Folder) {
  const s = sunLon(folderMjd(f.name));
  return TARGETS.some(([, ra, dec]) => {
    const [lam, beta] = toEcliptic(ra, dec);
    if (Math.abs(beta) > 55) return true; // near the ecliptic poles SPHEREx looks almost every orbit
    return Math.min(dLon(lam, s + 105), dLon(lam, s - 100)) < 40;
  });
}

const onlyTargets = process.argv.includes('--only-targets');
const all = await folders(true);
const todo = all.filter((f) => !loadIndex(f));
const first = todo.filter(relevant), rest = todo.filter((f) => !relevant(f));
const queue = onlyTargets ? first : [...first, ...rest];
console.log(`${all.length} weekly folders, ${all.length - todo.length} already indexed; indexing ${queue.length} (${first.length} relevant to the challenge targets first)`);

const t0 = Date.now();
let i = 0, next = 0;
const FOLDERS_AT_ONCE = 3;
await Promise.all(Array.from({ length: FOLDERS_AT_ONCE }, async () => {
  while (next < queue.length) {
    const f = queue[next++];
    const s = Date.now();
    try {
      const x = await indexFolder(f, PRIO.background);
      i++;
      const mb = (netStats.bytes / 1e6).toFixed(1), el = ((Date.now() - t0) / 60000).toFixed(1);
      console.log(`[${i}/${queue.length}] ${f.release}/${f.name}: ${x.rows.length} observations in ${((Date.now() - s) / 1000).toFixed(0)} s  (total ${mb} MB, ${el} min, ${netStats.retries} retries)`);
    } catch (e) {
      i++;
      console.log(`[${i}/${queue.length}] ${f.release}/${f.name}: FAILED ${(e as Error).message}`);
    }
  }
}));
console.log('coverage', JSON.stringify(await coverage()));

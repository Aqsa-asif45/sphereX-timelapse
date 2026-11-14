/**
 * Catalogue overlays: stars from other telescopes around a position.
 *  - gaia: ESA Gaia DR3 (positions at epoch 2016.0, proper motions) via IRSA TAP, falling back
 *          to ESA's own Gaia archive.
 *  - wise: CatWISE2020 (WISE + NEOWISE, positions near epoch 2015.4) via IRSA TAP.
 * Results are cached on disk, so a target that worked once keeps working offline.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CACHE, IRSA_TAP } from './config.js';
import { fetchText } from './net.js';

export interface CatRow { ra: number; dec: number; mag: number; pmra?: number; pmdec?: number }
export interface CatResult { cat: 'gaia' | 'wise'; epoch: number; band: string; rows: CatRow[]; source: string }

const dir = path.join(CACHE, 'cat');
const circle = (ra: number, dec: number, r: number) => `1=CONTAINS(POINT('ICRS',ra,dec), CIRCLE('ICRS', ${ra.toFixed(6)}, ${dec.toFixed(6)}, ${r.toFixed(5)}))`;

function csv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  const head = lines.shift()!.split(',').map((s) => s.trim().replace(/"/g, ''));
  return lines.filter(Boolean).map((l) => Object.fromEntries(l.split(',').map((v, i) => [head[i], v.trim().replace(/"/g, '')])));
}

async function irsa(q: string) {
  return csv(await fetchText(`${IRSA_TAP}?${new URLSearchParams({ QUERY: q, FORMAT: 'csv' })}`, { timeoutMs: 40_000 }));
}

async function esaGaia(q: string) {
  const t = await fetchText('https://gea.esac.esa.int/tap-server/tap/sync', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'csv', QUERY: q }).toString(), timeoutMs: 40_000,
  });
  if (t.trimStart().startsWith('<')) throw new Error('Gaia archive busy');
  return csv(t);
}

export async function catalog(cat: 'gaia' | 'wise', ra: number, dec: number, r: number): Promise<CatResult> {
  const id = crypto.createHash('sha1').update(`${cat}|${ra.toFixed(5)}|${dec.toFixed(5)}|${r.toFixed(4)}`).digest('hex');
  const file = path.join(dir, id + '.json');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* fetch */ }
  let out: CatResult;
  if (cat === 'gaia') {
    const cols = 'ra, dec, pmra, pmdec, phot_g_mean_mag';
    const where = `${circle(ra, dec, r)} AND phot_g_mean_mag < 20`;
    let rows: Record<string, string>[], source = 'Gaia DR3 via IRSA';
    try { rows = await irsa(`SELECT TOP 3000 ${cols} FROM gaia_dr3_source WHERE ${where} ORDER BY phot_g_mean_mag`); } catch {
      rows = await esaGaia(`SELECT TOP 3000 ${cols} FROM gaiadr3.gaia_source WHERE ${where} ORDER BY phot_g_mean_mag`);
      source = 'Gaia DR3 via ESA';
    }
    out = { cat, epoch: 57388.5 /* J2016.0 */, band: 'G', source, rows: rows.map((x) => ({ ra: +x.ra, dec: +x.dec, mag: +x.phot_g_mean_mag, pmra: x.pmra ? +x.pmra : undefined, pmdec: x.pmdec ? +x.pmdec : undefined })) };
  } else {
    // CatWISE proper motions are in arcsec/yr and noisy for faint sources: keep only significant ones (> 5σ)
    const rows = await irsa(`SELECT TOP 3000 ra, dec, w1mpro, w2mpro, pmra, pmdec, sigpmra, sigpmdec FROM catwise_2020 WHERE ${circle(ra, dec, r)} AND w2mpro < 17 ORDER BY w2mpro`);
    out = {
      cat, epoch: 57170 /* ≈2015.4, CatWISE2020 reference epoch */, band: 'W2 (4.6 µm)', source: 'CatWISE2020 via IRSA',
      rows: rows.map((x) => {
        const pm = Math.hypot(+x.pmra, +x.pmdec), sig = Math.hypot(+x.sigpmra, +x.sigpmdec) || Infinity, keep = pm / sig > 5;
        return { ra: +x.ra, dec: +x.dec, mag: +x.w2mpro, pmra: keep ? +x.pmra * 1000 : undefined, pmdec: keep ? +x.pmdec * 1000 : undefined };
      }),
    };
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out));
  return out;
}

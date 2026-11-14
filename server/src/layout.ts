/**
 * Byte layout of SPHEREx Level-2 spectral image files, learned per pipeline version
 * (e.g. "v20" for QR2, "v27" for QR3) by walking one file's headers with range reads.
 *
 * Header card positions are NOT fixed within a version: some files carry 13 extra cards
 * before the WCS (seen: CRPIX1 at byte 10400 in some files, 9360 in others). So we read a
 * window that covers every variant seen so far and find cards by name. If a needed card is
 * missing from the window, we read that file's whole header once and widen the window.
 * The pixel data start (byte 23040 for v20) has been the same in every variant checked.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from './config.js';
import { blocks, cardOffset, endOffset, parseCards, num, type Header } from './fits.js';
import { getRange, NotFound, PastEnd, PRIO } from './net.js';

type Prio = (typeof PRIO)[keyof typeof PRIO];

export interface Layout {
  major: string;
  /** absolute byte windows inside the IMAGE header, unions over all variants seen */
  coarse: [number, number];   // orientation + pointing
  precise: [number, number];  // reference pixel, pointing, inverse SIP, time
  /** number of inverse-SIP coefficient cards (AP_i_j + BP_i_j) in a full header */
  nsip: number;
  /** where the IMAGE header starts (after the primary header) */
  imgAt?: number;
  image: number; flags: number; variance: number; zodi: number; wave: number;
  /** flag bit number by name, read from the FLAGS header (MP_* cards) */
  flagBits: Record<string, number>;
}

const FILE = path.join(DATA, 'layouts.json');
let layouts: Record<string, Layout> = {};
try { layouts = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* first run */ }
for (const k of Object.keys(layouts)) if (layouts[k].nsip === undefined) delete layouts[k]; // older format
const pending = new Map<string, Promise<Layout>>();
/** The server and the indexer may run at once: merge with what is on disk instead of overwriting. */
const save = () => {
  fs.mkdirSync(DATA, { recursive: true });
  let disk: Record<string, Layout> = {};
  try { disk = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* none */ }
  for (const [k, d] of Object.entries(disk)) {
    const m = layouts[k];
    if (!m) { if (d.nsip !== undefined) layouts[k] = d; continue; }
    if (d.nsip === undefined) continue;
    m.coarse = [Math.min(m.coarse[0], d.coarse[0]), Math.max(m.coarse[1], d.coarse[1])];
    m.precise = [Math.min(m.precise[0], d.precise[0]), Math.max(m.precise[1], d.precise[1])];
  }
  fs.writeFileSync(FILE, JSON.stringify(layouts, null, 1));
};

export const majorOf = (version: string) => version.match(/-(v\d+)-/)?.[1] ?? version;
export function cachedLayout(version: string): Layout | undefined { return layouts[majorOf(version)]; }

/** Layout for a version, learning it from `sampleKey` if needed (retried: the link drops out). */
export function layoutFor(version: string, sampleKey: string): Promise<Layout> {
  const major = majorOf(version);
  if (layouts[major]) return Promise.resolve(layouts[major]);
  if (!pending.has(major)) {
    pending.set(major, (async () => {
      for (let attempt = 0; ; attempt++) {
        try { const l = await learn(major, sampleKey); layouts[major] = l; save(); return l; } catch (e) {
          if (e instanceof NotFound || attempt >= 2) throw e;
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    })().finally(() => pending.delete(major)));
  }
  return pending.get(major)!;
}

async function readHeader(key: string, at: number, prio: Prio): Promise<{ text: string; size: number }> {
  let text = '';
  for (let p = at; ; p += 2880 * 4) {
    const chunk = (await getRange(key, p, p + 2880 * 4 - 1, prio)).toString('latin1');
    text += chunk;
    const e = endOffset(text);
    if (e >= 0) return { text: text.slice(0, e + 80), size: blocks(e + 80) };
    if (chunk.length < 2880 * 4) throw new Error('header without END');
  }
}

const COARSE_KEYS = ['PC1_1', 'PC1_2', 'PC2_1', 'PC2_2', 'CRVAL1', 'CRVAL2'];
const PRECISE_KEYS = ['CRPIX1', 'CRPIX2', ...COARSE_KEYS, 'MJD-AVG', 'AP_ORDER', 'BP_ORDER'];
const isSip = (k: string) => /^(AP|BP)_\d+_\d+$/.test(k);

/** Windows (absolute offsets) that hold the needed cards in one IMAGE header. */
function windowsOf(imgAt: number, text: string) {
  const off = (k: string) => { const o = cardOffset(text, k); if (o < 0) throw new Error(`card ${k} not found`); return imgAt + o; };
  let last = off('MJD-AVG');
  for (let i = 0; i + 80 <= text.length; i += 80) if (/^(AP|BP)_(\d+_\d+|ORDER) *=/.test(text.slice(i, i + 10))) last = Math.max(last, imgAt + i);
  let nsip = 0;
  for (let i = 0; i + 80 <= text.length; i += 80) if (/^(AP|BP)_\d+_\d+ *=/.test(text.slice(i, i + 10))) nsip++;
  // the precise window runs to the END card: header length varies from file to file, and
  // END tells us where that file's pixels start
  const end = imgAt + endOffset(text);
  return {
    coarse: [Math.min(...COARSE_KEYS.map(off)), Math.max(...COARSE_KEYS.map(off)) + 79] as [number, number],
    precise: [Math.min(...PRECISE_KEYS.map(off)), Math.max(last, end, ...PRECISE_KEYS.map(off)) + 79] as [number, number],
    nsip,
  };
}

async function learn(major: string, key: string): Promise<Layout> {
  const hdus: Array<{ name: string; at: number; data: number; text: string }> = [];
  let at = 0;
  for (let i = 0; i < 8; i++) {
    let h;
    try { h = await readHeader(key, at, PRIO.find); } catch (e) {
      if (e instanceof PastEnd) break; // walked off the end of the file
      throw e;                          // a network failure: do not learn a partial layout
    }
    const cards = parseCards(h.text);
    const naxis = num(cards, 'NAXIS', 0);
    let n = naxis ? 1 : 0;
    for (let k = 1; k <= naxis; k++) n *= num(cards, `NAXIS${k}`, 0);
    const bytes = (n * Math.abs(num(cards, 'BITPIX', 8))) / 8 + num(cards, 'PCOUNT', 0);
    hdus.push({ name: String(cards.get('EXTNAME') ?? (i ? '' : 'PRIMARY')), at, data: at + h.size, text: h.text });
    at += h.size + blocks(bytes);
    if (hdus[hdus.length - 1].name === 'WCS-WAVE') break; // the last extension
  }
  const find = (n: string) => { const h = hdus.find((x) => x.name === n); if (!h) throw new Error(`${n} HDU not found in ${key}`); return h; };
  const img = find('IMAGE');
  const flagBits: Record<string, number> = {};
  for (const [k, v] of parseCards(find('FLAGS').text)) if (k.startsWith('MP_') && typeof v === 'number') flagBits[k.slice(3)] = v;
  return {
    major, ...windowsOf(img.at, img.text), imgAt: img.at,
    image: img.data, flags: find('FLAGS').data, variance: find('VARIANCE').data, zodi: find('ZODI').data, wave: find('WCS-WAVE').data,
    flagBits,
  };
}

/**
 * Read the IMAGE-header cards needed for `kind` from one file. Uses the learned window;
 * falls back to the full header (and widens the window) if anything is missing.
 * For 'precise' also returns `data`: the byte where this file's pixels start.
 */
export async function readWcsCards(key: string, version: string, kind: 'coarse' | 'precise', prio: Prio): Promise<{ h: Header; data?: number }> {
  const L = cachedLayout(version) ?? (await layoutFor(version, key));
  const w = L[kind];
  const text = (await getRange(key, w[0], w[1], prio)).toString('latin1');
  const h = parseCards(text);
  const need = kind === 'coarse' ? COARSE_KEYS : PRECISE_KEYS;
  if (kind === 'coarse' && need.every((k) => h.has(k))) return { h };
  if (kind === 'precise') {
    const e = endOffset(text), imgAt = L.imgAt ?? 2880;
    if (e >= 0 && need.every((k) => h.has(k)) && [...h.keys()].filter(isSip).length >= L.nsip) return { h, data: imgAt + blocks(w[0] + e + 80 - imgAt) };
  }
  // a header variant we have not seen: read it whole, then widen the windows to cover it
  const prim = await readHeader(key, 0, prio);
  const img = await readHeader(key, prim.size, prio);
  const v = windowsOf(prim.size, img.text);
  L.coarse = [Math.min(L.coarse[0], v.coarse[0]), Math.max(L.coarse[1], v.coarse[1])];
  L.precise = [Math.min(L.precise[0], v.precise[0]), Math.max(L.precise[1], v.precise[1])];
  L.imgAt = prim.size;
  save();
  return { h: parseCards(img.text), data: prim.size + img.size };
}

/** Where a file's FLAGS pixels start, given where its IMAGE pixels start (headers vary in length). */
const flagsAt = new Map<string, number>();
export async function flagsDataStart(key: string, imageData: number, prio: Prio): Promise<number> {
  if (flagsAt.has(key)) return flagsAt.get(key)!;
  const hdrAt = imageData + blocks(2040 * 2040 * 4);
  const h = await readHeader(key, hdrAt, prio);
  if (!h.text.includes("'FLAGS")) throw new Error('FLAGS extension not where expected');
  flagsAt.set(key, hdrAt + h.size);
  return hdrAt + h.size;
}

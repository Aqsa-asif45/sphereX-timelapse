/**
 * Planet X & SPHEREx time-lapse server.
 * API:
 *   GET /api/status                       archive reachability, index coverage, network counters
 *   GET /api/featured                     challenge targets
 *   GET /api/resolve?q=                   name or coordinates → position (+ proper motion)
 *   GET /api/frames?ra=&dec=              NDJSON stream: progress lines, then the frame list
 *   GET /api/cutout?id=&ra=&dec=&n=&s=&flags=1   binary Float32 cutout (+ Int32 flags), little-endian
 *   POST /api/cutouts {ids, ra, dec, n, s, flags}  many cutouts in one streamed response (see below)
 * /timelens/… serves the TimeLens frontend from dist/timelens; everything else the original app from dist/web.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { PIXEL_ARCSEC, PORT, TIMELENS, WEB } from './config.js';
import { catalog } from './catalog.js';
import { cutout, rawPixels } from './cutout.js';
import { findFrames, irsaReachable, MAX_EXPOSURES, publicFrame, type FrameRec } from './finder.js';
import { netStats } from './net.js';
import { preview } from './preview.js';
import { FEATURED, resolve } from './resolve.js';
import { coverage } from './skyindex.js';

/** Frames found by searches, by id (cutouts need their headers). Bounded: oldest searches drop out first. */
const frames = new Map<string, FrameRec>();
const MAX_FRAMES = 20_000;
function remember(f: FrameRec) {
  frames.delete(f.id); // re-inserting moves it to the newest end
  frames.set(f.id, f);
  if (frames.size > MAX_FRAMES) for (const k of frames.keys()) { frames.delete(k); if (frames.size <= MAX_FRAMES) break; }
}

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.map': 'application/json' };

function json(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const numParam = (u: URL, k: string, lo: number, hi: number) => {
  const v = Number(u.searchParams.get(k));
  if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`bad ${k}`);
  return v;
};

class TooLarge extends Error {}
function readBody(req: http.IncomingMessage, limit: number): Promise<string> {
  return new Promise((ok, fail) => {
    let s = '', over = false;
    req.setEncoding('utf8');
    req.on('data', (c: string) => { if (over) return; s += c; if (s.length > limit) { over = true; fail(new TooLarge('request too large')); } });
    req.on('end', () => { if (!over) ok(s); });
    req.on('error', fail);
  });
}

/** Cutouts made at once for one batch request. Each is a few dozen tiny S3 range reads, so the
 *  server can run many more in parallel than a browser's six connections per host allow. */
const BATCH_CONCURRENCY = 32;

/**
 * POST /api/cutouts: every image a view needs, in one response, sent as each one is ready.
 * Records, little-endian: u16 id length · u8 status (0 ok, 1 failed) · u32 payload length · id (UTF-8) · payload
 * (Float32 n×n image, then Int32 n×n flags when asked for). Stops when the browser disconnects.
 */
async function cutouts(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST {ids, ra, dec, n, s, flags}.' });
  let b: { ids?: unknown; ra?: unknown; dec?: unknown; n?: unknown; s?: unknown; flags?: unknown };
  try { b = JSON.parse((await readBody(req, 100_000)) || '{}'); } catch (e) {
    if (e instanceof TooLarge) { res.setHeader('Connection', 'close'); return json(res, 413, { error: 'Too many images in one request.' }); }
    return json(res, 400, { error: 'Send JSON: {ids, ra, dec, n, s, flags}.' });
  }
  const ids: string[] = Array.isArray(b.ids) ? b.ids.slice(0, MAX_EXPOSURES).map(String) : [];
  const ra = Number(b.ra), dec = Number(b.dec), n = Math.round(Number(b.n)), s = Number(b.s);
  if (!(ra >= 0 && ra <= 360 && dec >= -90 && dec <= 90 && n >= 8 && n <= 400 && s >= 0.5 && s <= 60)) return json(res, 400, { error: 'bad view' });
  const withFlags = b.flags === true;
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
  let closed = false;
  res.on('close', () => { closed = true; });
  let next = 0;
  const worker = async () => {
    while (!closed && next < ids.length) {
      const id = ids[next++], fr = frames.get(id);
      let payload: Buffer | null = null;
      if (fr && fr.data) {
        try {
          const c = await cutout(fr, ra, dec, n, s / 3600, withFlags);
          payload = Buffer.alloc(n * n * (withFlags ? 8 : 4));
          Buffer.from(c.img.buffer, c.img.byteOffset, c.img.byteLength).copy(payload, 0);
          if (c.flags) Buffer.from(c.flags.buffer, c.flags.byteOffset, c.flags.byteLength).copy(payload, n * n * 4);
        } catch { payload = null; }
      }
      if (closed) return;
      const idb = Buffer.from(id, 'utf8'), head = Buffer.alloc(7);
      head.writeUInt16LE(idb.length, 0);
      head.writeUInt8(payload ? 0 : 1, 2);
      head.writeUInt32LE(payload ? payload.length : 0, 3);
      // a slow connection: wait for it to drain instead of piling images up in memory
      if (!res.write(payload ? Buffer.concat([head, idb, payload]) : Buffer.concat([head, idb])) && !closed) {
        await new Promise<void>((go) => { const on = () => { res.off('drain', on); res.off('close', on); go(); }; res.on('drain', on); res.on('close', on); });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, ids.length) }, worker));
  res.end();
}

async function api(u: URL, req: http.IncomingMessage, res: http.ServerResponse) {
  switch (u.pathname) {
    case '/api/status':
      return json(res, 200, { irsa: await irsaReachable(), coverage: await coverage(), net: { ...netStats, queued: netStats.queued, inflight: netStats.inflight } });
    case '/api/featured':
      return json(res, 200, FEATURED.map(({ slug, name, kind, blurb, note }) => ({ slug, name, kind, blurb, note })));
    case '/api/resolve': {
      const q = (u.searchParams.get('q') || '').slice(0, 200);
      if (!q.trim()) return json(res, 400, { error: 'Type a name or coordinates.' });
      try { return json(res, 200, await resolve(q)); } catch (e) { return json(res, 404, { error: (e as Error).message }); }
    }
    case '/api/frames': {
      const ra = numParam(u, 'ra', 0, 360), dec = numParam(u, 'dec', -90, 90);
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      let last = 0;
      try {
        const r = await findFrames(ra, dec, (p) => {
          const now = Date.now();
          if (now - last > 250 || p.done === p.total) { last = now; res.write(JSON.stringify({ type: 'progress', ...p }) + '\n'); }
        });
        for (const f of r.frames) remember(f);
        res.end(JSON.stringify({ type: 'result', source: r.source, indexed: r.indexed, folders: r.folders, observations: r.observations, failed: r.failed, frames: r.frames.map(publicFrame) }) + '\n');
      } catch (e) {
        res.end(JSON.stringify({ type: 'error', error: (e as Error).message }) + '\n');
      }
      return;
    }
    case '/api/pixels': { // raw detector pixels, no resampling (for data checks)
      const fr = frames.get(u.searchParams.get('id') || '');
      if (!fr || !fr.data) return json(res, 404, { error: 'Unknown frame: search again.' });
      return json(res, 200, await rawPixels(fr, Math.round(numParam(u, 'x', 1, 2040)), Math.round(numParam(u, 'y', 1, 2040)), Math.round(numParam(u, 'r', 0, 10))));
    }
    case '/api/preview': {
      try {
        const gif = await preview(u.searchParams.get('slug') || '');
        res.writeHead(200, { 'Content-Type': 'image/gif', 'Cache-Control': 'public, max-age=3600' });
        return res.end(gif);
      } catch (e) { return json(res, 404, { error: (e as Error).message }); }
    }
    case '/api/catalog': {
      const cat = u.searchParams.get('cat') === 'wise' ? 'wise' : 'gaia';
      const ra = numParam(u, 'ra', 0, 360), dec = numParam(u, 'dec', -90, 90), r = numParam(u, 'r', 0.001, 0.5);
      try { return json(res, 200, await catalog(cat, ra, dec, r)); } catch (e) {
        return json(res, 503, { error: `${cat === 'gaia' ? 'Gaia' : 'WISE'} catalogue unavailable right now (${(e as Error).message}).` });
      }
    }
    case '/api/cutouts':
      return cutouts(req, res);
    case '/api/cutout': {
      const fr = frames.get(u.searchParams.get('id') || '');
      if (!fr || !fr.data) return json(res, 404, { error: 'Unknown frame: search again.' });
      const ra = numParam(u, 'ra', 0, 360), dec = numParam(u, 'dec', -90, 90), n = Math.round(numParam(u, 'n', 8, 400));
      const scale = numParam(u, 's', 0.5, 60) / 3600;
      const withFlags = u.searchParams.get('flags') === '1';
      const c = await cutout(fr, ra, dec, n, scale, withFlags);
      const body = Buffer.alloc(n * n * (withFlags ? 8 : 4));
      Buffer.from(c.img.buffer, c.img.byteOffset, c.img.byteLength).copy(body, 0);
      if (c.flags) Buffer.from(c.flags.buffer, c.flags.byteOffset, c.flags.byteLength).copy(body, n * n * 4);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Size': String(n), 'X-Flags': withFlags ? '1' : '0' });
      return res.end(body);
    }
  }
  json(res, 404, { error: 'not found' });
}

function serveStatic(u: URL, res: http.ServerResponse) {
  let p = path.normalize(decodeURIComponent(u.pathname)).replace(/^([\\/])+/, '');
  if (p.includes('..')) { res.writeHead(400); return res.end(); }
  // /timelens/… is the TimeLens app (with its own index.html for client-side routes)
  const lens = /^timelens([\\/]|$)/.test(p);
  const root = lens ? TIMELENS : WEB;
  if (lens) p = p.replace(/^timelens[\\/]?/, '');
  let file = path.join(root, p || 'index.html');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(503, { 'Content-Type': 'text/plain' }); return res.end('Web app not built yet: run npm run build'); }
  const ext = path.extname(file);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || '/', 'http://localhost');
  try {
    if (u.pathname.startsWith('/api/')) await api(u, req, res);
    else serveStatic(u, res);
  } catch (e) {
    if (!res.headersSent) json(res, 400, { error: (e as Error).message });
    else res.end();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`SPHEREx time-lapse running at http://localhost:${PORT}  (pixel scale ${PIXEL_ARCSEC}″)`);
});

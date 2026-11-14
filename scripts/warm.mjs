// Pre-load the challenge targets (or any you list) into the server's cache, so a demo is instant.
//   node scripts/warm.mjs                      all featured targets, 4′ field
//   node scripts/warm.mjs "R Dra" "M 101"      specific targets
//   FOV=6 node scripts/warm.mjs                another field size (arcmin)
// The server must be running (npm start).
const BASE = process.env.BASE || 'http://localhost:5173';
const FOV = Number(process.env.FOV || 4);
const n = Math.round((FOV * 60) / 6.15) | 1;
const REF_MJD = 61040;

const get = async (p) => { const r = await fetch(BASE + p); if (!r.ok) throw new Error(`${r.status} ${p}`); return r; };
const names = process.argv.slice(2).length ? process.argv.slice(2) : (await (await get('/api/featured')).json()).map((f) => f.name);

for (const name of names) {
  const t0 = Date.now();
  const t = await (await get(`/api/resolve?q=${encodeURIComponent(name)}`)).json();
  const yr = (REF_MJD - t.epoch) / 365.25;
  const dec = t.dec + ((t.pmdec ?? 0) * yr) / 3.6e6, ra = t.ra + ((t.pmra ?? 0) * yr) / 3.6e6 / Math.cos((t.dec * Math.PI) / 180);
  const text = await (await get(`/api/frames?ra=${ra.toFixed(6)}&dec=${dec.toFixed(6)}`)).text();
  const res = JSON.parse(text.trim().split('\n').pop());
  if (res.type !== 'result') { console.log(`${name}: ${res.error}`); continue; }
  let ok = 0, bad = 0, i = 0;
  const q = res.frames;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (i < q.length) {
      const f = q[i++];
      try { await (await get(`/api/cutout?id=${encodeURIComponent(f.id)}&ra=${ra.toFixed(6)}&dec=${dec.toFixed(6)}&n=${n}&s=6.15&flags=0`)).arrayBuffer(); ok++; } catch { bad++; }
    }
  }));
  console.log(`${name}: ${res.frames.length} frames via ${res.source}, ${ok} cutouts cached${bad ? `, ${bad} failed` : ''} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

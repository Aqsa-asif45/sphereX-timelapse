/** Minimal animated-GIF encoder (GIF89a, global palette, LZW, looping). No dependencies. */

/** Build a palette for frames: either the heat colour map (+ UI colours) or a generic colour cube. */
export function makePalette(heatLut: Uint8Array | null): Uint8Array {
  const pal = new Uint8Array(256 * 3);
  let k = 0;
  const push = (r: number, g: number, b: number) => { pal[k * 3] = r; pal[k * 3 + 1] = g; pal[k * 3 + 2] = b; k++; };
  const ui: Array<[number, number, number]> = [[255, 184, 77], [110, 195, 255], [127, 220, 164], [255, 255, 255], [232, 236, 243], [18, 22, 32], [0, 230, 255], [255, 122, 107]];
  if (heatLut) {
    for (let i = 0; i < 248; i++) { const s = Math.round((i / 247) * 255) * 3; push(heatLut[s], heatLut[s + 1], heatLut[s + 2]); }
  } else {
    for (let r = 0; r < 6; r++) for (let g = 0; g < 7; g++) for (let b = 0; b < 6; b++) push(Math.round((r * 255) / 5), Math.round((g * 255) / 6), Math.round((b * 255) / 5));
    while (k < 248) push(0, 0, 0);
  }
  for (const c of ui) push(...c);
  return pal;
}

/** Map RGBA pixels to palette indices (nearest colour, cached per colour). */
export function quantize(rgba: Uint8ClampedArray, pal: Uint8Array, cache: Map<number, number>): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    let idx = cache.get(key);
    if (idx === undefined) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < 256; c++) {
        const dr = rgba[i] - pal[c * 3], dg = rgba[i + 1] - pal[c * 3 + 1], db = rgba[i + 2] - pal[c * 3 + 2];
        const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
        if (d < bd) { bd = d; best = c; }
      }
      idx = best;
      cache.set(key, idx);
    }
    out[p] = idx;
  }
  return out;
}

class Bytes {
  a: number[] = [];
  byte(b: number) { this.a.push(b & 255); }
  word(w: number) { this.byte(w); this.byte(w >> 8); }
  str(s: string) { for (const c of s) this.byte(c.charCodeAt(0)); }
}

function lzw(px: Uint8Array, out: Bytes) {
  const MIN = 8, CLEAR = 256, EOI = 257;
  out.byte(MIN);
  let size = 9, next = 258, buf = 0, nbits = 0;
  const block: number[] = [];
  const emit = (code: number) => {
    buf |= code << nbits; nbits += size;
    while (nbits >= 8) {
      block.push(buf & 255); buf >>= 8; nbits -= 8;
      if (block.length === 255) { out.byte(255); for (const b of block) out.byte(b); block.length = 0; }
    }
  };
  let dict = new Map<number, number>();
  emit(CLEAR);
  let cur = px[0];
  for (let i = 1; i < px.length; i++) {
    const k = px[i], key = (cur << 8) | k, hit = dict.get(key);
    if (hit !== undefined) { cur = hit; continue; }
    emit(cur);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > 1 << size && size < 12) size++;
    } else { emit(CLEAR); dict = new Map(); size = 9; next = 258; }
    cur = k;
  }
  emit(cur); emit(EOI);
  if (nbits > 0) block.push(buf & 255);
  for (let i = 0; i < block.length; i += 255) { const part = block.slice(i, i + 255); out.byte(part.length); for (const b of part) out.byte(b); }
  out.byte(0);
}

/** frames: palette indices (w*h each); delay in hundredths of a second. */
export function encodeGif(frames: Uint8Array[], w: number, h: number, pal: Uint8Array, delayCs: number): Blob {
  const o = new Bytes();
  o.str('GIF89a'); o.word(w); o.word(h);
  o.byte(0xf7); o.byte(0); o.byte(0); // global colour table, 256 entries
  for (let i = 0; i < 768; i++) o.byte(pal[i]);
  o.byte(0x21); o.byte(0xff); o.byte(11); o.str('NETSCAPE2.0'); o.byte(3); o.byte(1); o.word(0); o.byte(0); // loop forever
  for (const f of frames) {
    o.byte(0x21); o.byte(0xf9); o.byte(4); o.byte(0); o.word(delayCs); o.byte(0); o.byte(0); // graphic control
    o.byte(0x2c); o.word(0); o.word(0); o.word(w); o.word(h); o.byte(0); // image descriptor
    lzw(f, o);
  }
  o.byte(0x3b);
  return new Blob([new Uint8Array(o.a)], { type: 'image/gif' });
}

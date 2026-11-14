/** Minimal FITS header handling: 80-character cards, HIERARCH keys, numbers and strings. */

export type Header = Map<string, string | number | boolean>;

/** Parse header cards from a latin1 string or buffer (which may start mid-header, on a card boundary). */
export function parseCards(src: Buffer | string): Header {
  const s = typeof src === 'string' ? src : src.toString('latin1');
  const h: Header = new Map();
  for (let i = 0; i + 80 <= s.length; i += 80) {
    const card = s.slice(i, i + 80);
    if (card.startsWith('END') && card.trim() === 'END') break;
    let key: string, rest: string;
    if (card.startsWith('HIERARCH ')) {
      const eq = card.indexOf('=');
      if (eq < 0) continue;
      key = card.slice(9, eq).trim().replace(/\s+/g, ' ');
      rest = card.slice(eq + 1);
    } else {
      if (card[8] !== '=') continue;
      key = card.slice(0, 8).trim();
      rest = card.slice(10);
    }
    h.set(key, parseValue(rest));
  }
  return h;
}

function parseValue(rest: string): string | number | boolean {
  const t = rest.trim();
  if (t.startsWith("'")) {
    // string: '' is an escaped quote
    let out = '';
    for (let i = 1; i < t.length; i++) {
      if (t[i] === "'") { if (t[i + 1] === "'") { out += "'"; i++; continue; } break; }
      out += t[i];
    }
    return out.trimEnd();
  }
  const v = t.split('/')[0].trim();
  if (v === 'T') return true;
  if (v === 'F') return false;
  const n = Number(v);
  return Number.isFinite(n) ? n : v;
}

export const num = (h: Header, k: string, dflt = NaN): number => {
  const v = h.get(k);
  return typeof v === 'number' ? v : dflt;
};
export const str = (h: Header, k: string, dflt = ''): string => {
  const v = h.get(k);
  return typeof v === 'string' ? v : dflt;
};

/** Byte offset (within a header string) of the card for `key`, or -1. Keys are matched at card starts only. */
export function cardOffset(s: string, key: string): number {
  const want = key.padEnd(8) + '=';
  for (let i = 0; i + 80 <= s.length; i += 80) if (s.startsWith(want, i)) return i;
  return -1;
}

/** Offset of the END card in a header string, or -1. */
export function endOffset(s: string): number {
  for (let i = 0; i + 80 <= s.length; i += 80) if (s.slice(i, i + 80).trim() === 'END') return i;
  return -1;
}

export const blocks = (n: number) => Math.ceil(n / 2880) * 2880;

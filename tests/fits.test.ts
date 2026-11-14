import { describe, expect, it } from 'vitest';
import { blocks, cardOffset, endOffset, num, parseCards, str } from '../server/src/fits';

const card = (s: string) => s.padEnd(80);
const hdr = (...cards: string[]) => cards.map(card).join('');

describe('parseCards', () => {
  it('parses numbers, strings, booleans and ignores comments', () => {
    const h = parseCards(hdr("NAXIS1  =                 2040 / width", "OBJECT  = 'M31 core'          / name", 'FLAG    =                    T', 'OFF     =                    F', 'END'));
    expect(h.get('NAXIS1')).toBe(2040);
    expect(h.get('OBJECT')).toBe('M31 core');
    expect(h.get('FLAG')).toBe(true);
    expect(h.get('OFF')).toBe(false);
  });
  it('unescapes doubled quotes in strings', () => {
    expect(parseCards(hdr("NAME    = 'O''Brien'")).get('NAME')).toBe("O'Brien");
  });
  it('parses HIERARCH keys and collapses whitespace', () => {
    const h = parseCards(hdr('HIERARCH ESO  DET   GAIN = 2.5'));
    expect(h.get('ESO DET GAIN')).toBe(2.5);
  });
  it('stops at END and skips cards without "= "', () => {
    const h = parseCards(hdr('COMMENT just a note', 'A       = 1', 'END', 'B       = 2'));
    expect([...h.keys()]).toEqual(['A']);
  });
  it('accepts a Buffer (latin1)', () => {
    expect(parseCards(Buffer.from(hdr('A       = 7'), 'latin1')).get('A')).toBe(7);
  });
  it('keeps non-numeric bare values as strings', () => {
    expect(parseCards(hdr('V       = abc')).get('V')).toBe('abc');
  });
});

describe('num / str', () => {
  const h = parseCards(hdr("A       = 3", "S       = 'x'"));
  it('returns defaults for missing or wrong-typed values', () => {
    expect(num(h, 'A')).toBe(3);
    expect(num(h, 'S', 9)).toBe(9);
    expect(num(h, 'ZZ')).toBeNaN();
    expect(str(h, 'S')).toBe('x');
    expect(str(h, 'A', 'd')).toBe('d');
  });
});

describe('cardOffset / endOffset / blocks', () => {
  const s = hdr('SIMPLE  = T', 'BITPIX  = -32', 'END');
  it('finds card starts only', () => {
    expect(cardOffset(s, 'SIMPLE')).toBe(0);
    expect(cardOffset(s, 'BITPIX')).toBe(80);
    expect(cardOffset(s, 'NOPE')).toBe(-1);
  });
  it('finds END', () => {
    expect(endOffset(s)).toBe(160);
    expect(endOffset(hdr('A       = 1'))).toBe(-1);
  });
  it('rounds up to 2880-byte blocks', () => {
    expect(blocks(0)).toBe(0);
    expect(blocks(1)).toBe(2880);
    expect(blocks(2880)).toBe(2880);
    expect(blocks(2881)).toBe(5760);
  });
});

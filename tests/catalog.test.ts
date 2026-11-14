import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmp = vi.hoisted(() => require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'spx-cat-')) as string);
vi.mock('../server/src/config', () => ({ CACHE: tmp, IRSA_TAP: 'https://irsa.test/TAP' }));
vi.mock('../server/src/net', () => ({ fetchText: vi.fn() }));

import { catalog } from '../server/src/catalog';
import { fetchText } from '../server/src/net';

const fetchMock = vi.mocked(fetchText);
beforeEach(() => { fetchMock.mockReset(); fs.rmSync(path.join(tmp, 'cat'), { recursive: true, force: true }); });
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const GAIA = 'ra,dec,pmra,pmdec,phot_g_mean_mag\n"10.5","-5.25","100.5","-20","12.3"\n10.6,-5.3,,,18.0\n';

describe('catalog (gaia)', () => {
  it('parses IRSA CSV, makes proper motion optional, and sends an ADQL cone', async () => {
    fetchMock.mockResolvedValue(GAIA);
    const r = await catalog('gaia', 10.5, -5.25, 0.05);
    expect(r).toMatchObject({ cat: 'gaia', band: 'G', epoch: 57388.5, source: 'Gaia DR3 via IRSA' });
    expect(r.rows).toEqual([
      { ra: 10.5, dec: -5.25, mag: 12.3, pmra: 100.5, pmdec: -20 },
      { ra: 10.6, dec: -5.3, mag: 18, pmra: undefined, pmdec: undefined },
    ]);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe('https://irsa.test/TAP');
    expect(url.searchParams.get('QUERY')).toContain('CIRCLE(\'ICRS\', 10.500000, -5.250000, 0.05000)');
  });
  it('falls back to the ESA archive when IRSA fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(GAIA);
    const r = await catalog('gaia', 1, 2, 0.1);
    expect(r.source).toBe('Gaia DR3 via ESA');
    expect(fetchMock.mock.calls[1][0]).toMatch(/esac\.esa\.int/);
  });
  it('treats an HTML reply from ESA as "busy"', async () => {
    fetchMock.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce('<html>busy</html>');
    await expect(catalog('gaia', 3, 4, 0.1)).rejects.toThrow('Gaia archive busy');
  });
  it('caches results on disk', async () => {
    fetchMock.mockResolvedValue(GAIA);
    const a = await catalog('gaia', 7, 8, 0.2);
    fetchMock.mockRejectedValue(new Error('offline'));
    const b = await catalog('gaia', 7, 8, 0.2);
    expect(b).toEqual(JSON.parse(JSON.stringify(a)));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('catalog (wise)', () => {
  it('keeps proper motion only above 5σ and converts arcsec/yr to mas/yr', async () => {
    fetchMock.mockResolvedValue('ra,dec,w1mpro,w2mpro,pmra,pmdec,sigpmra,sigpmdec\n1,2,15,14,1.0,0,0.1,0.1\n1,2,15,15,0.1,0.1,0.5,0.5\n');
    const r = await catalog('wise', 1, 2, 0.1);
    expect(r.band).toBe('W2 (4.6 µm)');
    expect(r.rows[0]).toMatchObject({ mag: 14, pmra: 1000, pmdec: 0 });
    expect(r.rows[1].pmra).toBeUndefined();
  });
});

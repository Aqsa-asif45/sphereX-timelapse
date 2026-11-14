import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchText, getRange, getTail, list, netStats, NotFound, PastEnd } from '../server/src/net';

const res = (status: number, body: BodyInit = '') => new Response(body, { status });
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

/** Run a promise while advancing fake timers (retry back-off) until it settles. */
async function settle<T>(p: Promise<T>): Promise<T> {
  p.catch(() => {});
  await vi.runAllTimersAsync();
  return p;
}

describe('getRange', () => {
  it('sends an inclusive Range header and returns the bytes', async () => {
    fetchMock.mockResolvedValue(res(206, new Uint8Array([1, 2, 3])));
    const b = await getRange('a/b.fits', 10, 12);
    expect([...b]).toEqual([1, 2, 3]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/a\/b\.fits$/);
    expect(init.headers.Range).toBe('bytes=10-12');
  });
  it('maps 404 and 403 to NotFound without retrying', async () => {
    for (const s of [404, 403]) {
      fetchMock.mockReset().mockResolvedValue(res(s));
      await expect(getRange('k', 0, 1)).rejects.toBeInstanceOf(NotFound);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });
  it('maps 416 to PastEnd without retrying', async () => {
    fetchMock.mockResolvedValue(res(416));
    await expect(getRange('k', 0, 1)).rejects.toBeInstanceOf(PastEnd);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('retries 5xx and then succeeds', async () => {
    const before = netStats.retries;
    fetchMock.mockResolvedValueOnce(res(503)).mockResolvedValueOnce(res(500)).mockResolvedValue(res(206, 'ok'));
    const b = await settle(getRange('k', 0, 1));
    expect(b.toString()).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(netStats.retries - before).toBe(2);
  });
  it('gives up after 6 attempts', async () => {
    fetchMock.mockImplementation(async () => res(500));
    await expect(settle(getRange('k', 0, 1))).rejects.toThrow(/S3 500/);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
  it('retries network errors', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValue(res(200, 'x'));
    expect((await settle(getRange('k', 0, 0))).toString()).toBe('x');
  });
  it('rejects unexpected statuses', async () => {
    fetchMock.mockImplementation(async () => res(302));
    await expect(settle(getRange('k', 0, 1))).rejects.toThrow(/unexpected 302/);
  });
  it('counts bytes', async () => {
    const before = netStats.bytes;
    fetchMock.mockResolvedValue(res(206, 'abcd'));
    await getRange('k', 0, 3);
    expect(netStats.bytes - before).toBe(4);
  });
});

describe('getTail', () => {
  it('uses a suffix range', async () => {
    fetchMock.mockResolvedValue(res(206, 'zz'));
    await getTail('k', 2880);
    expect(fetchMock.mock.calls[0][1].headers.Range).toBe('bytes=-2880');
  });
  it('maps 404 to NotFound', async () => {
    fetchMock.mockResolvedValue(res(404));
    await expect(getTail('k', 5)).rejects.toBeInstanceOf(NotFound);
  });
});

describe('list', () => {
  const xml = (inner: string, token?: string) => `<ListBucketResult>${inner}${token ? `<NextContinuationToken>${token}</NextContinuationToken>` : ''}</ListBucketResult>`;
  it('collects keys and sub-prefixes, skipping the prefix itself, and follows continuation tokens', async () => {
    fetchMock
      .mockResolvedValueOnce(res(200, xml('<Prefix>qr2/</Prefix><CommonPrefixes><Prefix>qr2/a/</Prefix></CommonPrefixes><Contents><Key>qr2/k1</Key></Contents>', 'T1')))
      .mockResolvedValueOnce(res(200, xml('<Prefix>qr2/</Prefix><CommonPrefixes><Prefix>qr2/b/</Prefix></CommonPrefixes><Contents><Key>qr2/k2</Key></Contents>')));
    const out = await list('qr2/', { delimiter: true });
    expect(out.prefixes).toEqual(['qr2/a/', 'qr2/b/']);
    expect(out.keys).toEqual(['qr2/k1', 'qr2/k2']);
    const q1 = new URL(String(fetchMock.mock.calls[0][0])).searchParams, q2 = new URL(String(fetchMock.mock.calls[1][0])).searchParams;
    expect(q1.get('delimiter')).toBe('/');
    expect(q1.get('list-type')).toBe('2');
    expect(q1.has('continuation-token')).toBe(false);
    expect(q2.get('continuation-token')).toBe('T1');
  });
  it('accepts a custom delimiter, start-after and stops at maxKeys', async () => {
    fetchMock.mockResolvedValue(res(200, xml('<Contents><Key>a</Key></Contents><Contents><Key>b</Key></Contents>', 'MORE')));
    const out = await list('p/', { delimiter: '_', startAfter: 'p/0', maxKeys: 2 });
    expect(out.keys).toEqual(['a', 'b']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const q = new URL(String(fetchMock.mock.calls[0][0])).searchParams;
    expect([q.get('delimiter'), q.get('start-after'), q.get('max-keys')]).toEqual(['_', 'p/0', '2']);
  });
  it('fails after repeated non-200 responses', async () => {
    fetchMock.mockImplementation(async () => res(500, 'err'));
    await expect(settle(list('p/'))).rejects.toThrow(/S3 list 500/);
  });
});

describe('fetchText', () => {
  it('returns the body', async () => {
    fetchMock.mockResolvedValue(res(200, 'hello'));
    expect(await fetchText('https://example.org/x')).toBe('hello');
  });
  it('retries once, then throws with the host', async () => {
    fetchMock.mockImplementation(async () => res(500, 'no'));
    await expect(settle(fetchText('https://example.org/x'))).rejects.toThrow('500 from example.org');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('passes init through', async () => {
    fetchMock.mockResolvedValue(res(200, 'ok'));
    await fetchText('https://example.org/x', { method: 'POST', body: 'a=b' });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', body: 'a=b' });
  });
});

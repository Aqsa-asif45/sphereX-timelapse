import { S3, S3_CONCURRENCY } from './config.js';

/** Request priorities: what the user is looking at goes first; index building waits. */
export const PRIO = { view: 0, find: 1, background: 2 } as const;
type Prio = (typeof PRIO)[keyof typeof PRIO];

/** A small priority semaphore. Lower number = served first. */
class Limiter {
  private active = 0;
  private queues: Array<Array<() => void>> = [[], [], []];
  constructor(private max: number) {}
  async run<T>(prio: Prio, fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((res) => this.queues[prio].push(res));
    this.active++;
    try { return await fn(); } finally {
      this.active--;
      const next = this.queues.find((q) => q.length)?.shift();
      if (next) next();
    }
  }
  get waiting() { return this.queues.reduce((n, q) => n + q.length, 0); }
  get running() { return this.active; }
}

const limiter = new Limiter(S3_CONCURRENCY);

export const netStats = { requests: 0, bytes: 0, retries: 0, notFound: 0, get queued() { return limiter.waiting; }, get inflight() { return limiter.running; } };

export class NotFound extends Error {}
export class PastEnd extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET a byte range [start, end] (inclusive) of an S3 key, with retries on network errors and 5xx. */
export async function getRange(key: string, start: number, end: number, prio: Prio = PRIO.find): Promise<Buffer> {
  return limiter.run(prio, async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(S3 + key, { headers: { Range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(45_000) });
        netStats.requests++;
        if (r.status === 404 || r.status === 403) { await r.arrayBuffer().catch(() => {}); netStats.notFound++; throw new NotFound(key); }
        // 416: the range starts past the end of the file; retrying will not help
        if (r.status === 416) { await r.arrayBuffer().catch(() => {}); throw new PastEnd(key); }
        if (r.status >= 500) throw new Error(`S3 ${r.status}`);
        if (r.status !== 206 && r.status !== 200) throw new Error(`S3 unexpected ${r.status} for ${key}`);
        const buf = Buffer.from(await r.arrayBuffer());
        netStats.bytes += buf.length;
        return buf;
      } catch (e) {
        if (e instanceof NotFound || e instanceof PastEnd || attempt >= 5) throw e;
        netStats.retries++;
        await sleep(800 * 2 ** attempt + Math.random() * 400);
      }
    }
  });
}

/** GET the last `n` bytes of an S3 key (a suffix range). */
export async function getTail(key: string, n: number, prio: Prio = PRIO.find): Promise<Buffer> {
  return limiter.run(prio, async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(S3 + key, { headers: { Range: `bytes=-${n}` }, signal: AbortSignal.timeout(45_000) });
        netStats.requests++;
        if (r.status === 404 || r.status === 403) { await r.arrayBuffer().catch(() => {}); netStats.notFound++; throw new NotFound(key); }
        if (r.status !== 206 && r.status !== 200) throw new Error(`S3 ${r.status}`);
        const buf = Buffer.from(await r.arrayBuffer());
        netStats.bytes += buf.length;
        return buf;
      } catch (e) {
        if (e instanceof NotFound || attempt >= 5) throw e;
        netStats.retries++;
        await sleep(800 * 2 ** attempt + Math.random() * 400);
      }
    }
  });
}

/** List keys under a prefix. delimiter true = '/' (folders); a string groups keys by it (e.g. '_' after an observation number). */
export async function list(prefix: string, opts: { delimiter?: boolean | string; startAfter?: string; maxKeys?: number; prio?: Prio } = {}) {
  const prefixes: string[] = [];
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const q = new URLSearchParams({ 'list-type': '2', prefix });
    if (opts.delimiter) q.set('delimiter', opts.delimiter === true ? '/' : opts.delimiter);
    if (opts.startAfter) q.set('start-after', opts.startAfter);
    if (opts.maxKeys) q.set('max-keys', String(opts.maxKeys));
    if (token) q.set('continuation-token', token);
    const text = await limiter.run(opts.prio ?? PRIO.find, async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          const r = await fetch(`${S3}?${q}`, { signal: AbortSignal.timeout(60_000) });
          netStats.requests++;
          const t = await r.text();
          netStats.bytes += t.length;
          if (r.status !== 200) throw new Error(`S3 list ${r.status}`);
          return t;
        } catch (e) {
          if (attempt >= 5) throw e;
          netStats.retries++;
          await sleep(800 * 2 ** attempt);
        }
      }
    });
    for (const m of text.matchAll(/<Prefix>([^<]+)<\/Prefix>/g)) if (m[1] !== prefix) prefixes.push(m[1]);
    for (const m of text.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1]);
    token = text.match(/<NextContinuationToken>([^<]+)</)?.[1];
    if (opts.maxKeys && keys.length >= opts.maxKeys) break;
  } while (token);
  return { prefixes, keys };
}

/** Plain JSON/text fetch with timeout and a couple of retries (for MAST, Gaia, IRSA). */
export async function fetchText(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 20_000) });
      const t = await r.text();
      if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
      return t;
    } catch (e) {
      if (attempt >= 1) throw e;
      await sleep(1000);
    }
  }
}

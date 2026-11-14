import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Project root: the bundle lives in <root>/dist, sources in <root>/server/src. */
const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.basename(here) === 'dist' ? path.resolve(here, '..') : path.resolve(here, '..', '..');
export const DATA = path.join(ROOT, 'data');
export const CACHE = path.join(DATA, 'cache');
export const WEB = path.join(ROOT, 'dist', 'web');
/** The TimeLens frontend (its own build), served under /timelens/. */
export const TIMELENS = path.join(ROOT, 'dist', 'timelens');

/** NASA's public AWS copy of the SPHEREx archive (us-east-1, anonymous). */
export const S3 = 'https://nasa-irsa-spherex.s3.amazonaws.com/';
/** IRSA's TAP service: the fast path when it is reachable (it is not, from some networks). */
export const IRSA_TAP = 'https://irsa.ipac.caltech.edu/TAP/sync';

/** Data releases, oldest first. New releases are discovered from the bucket automatically. */
export const RELEASES = ['qr2', 'qr3'];

export const PORT = Number(process.env.PORT || 5173);

/** Concurrent S3 requests. Row and header reads are tiny and latency-bound (~230 ms each), so
 *  throughput grows with concurrency: measured 123 req/s at 48, 818 at 256, ~1,900 at 512, no errors. */
export const S3_CONCURRENCY = Number(process.env.S3_CONCURRENCY || 512);

/** SPHEREx detector geometry. */
export const NPIX = 2040;
export const PIXEL_ARCSEC = 6.15;

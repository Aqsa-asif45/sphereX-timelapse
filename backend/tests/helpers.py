"""Independent reference: read NASA's original full file on AWS with Astropy, fetching only the bytes it asks for.
Shares no code with the backend's cutout path (which goes through IRSA's cutout service)."""
import io
import time

import requests

S3 = "https://nasa-irsa-spherex.s3.amazonaws.com/"
IBE = "https://irsa.ipac.caltech.edu/ibe/data/spherex/"


class HttpRaw(io.RawIOBase):
    def __init__(self, url: str, block: int = 64 * 1024):
        self.url, self.block, self.pos, self.cache = url, block, 0, {}
        self.s = requests.Session()
        r = self.s.head(url, timeout=60)
        r.raise_for_status()
        self.size = int(r.headers["Content-Length"])

    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def _blk(self, i):
        if i not in self.cache:
            a = i * self.block
            for attempt in range(5):  # AWS occasionally drops a connection; retry like any client would
                try:
                    r = self.s.get(self.url, headers={"Range": f"bytes={a}-{min(self.size, a + self.block) - 1}"}, timeout=60)
                    assert r.status_code == 206, r.status_code
                    break
                except requests.ConnectionError:
                    if attempt == 4:
                        raise
                    time.sleep(1 + attempt)
            self.cache[i] = r.content
        return self.cache[i]

    def readinto(self, buf):
        n = min(len(buf), self.size - self.pos)
        if n <= 0:
            return 0
        out, p = bytearray(), self.pos
        while len(out) < n:
            i = p // self.block
            d = self._blk(i)
            take = d[p - i * self.block:p - i * self.block + n - len(out)]
            out += take
            p += len(take)
        buf[:n] = out
        self.pos += n
        return n


def open_original(access_url: str):
    """A file object for the original file on AWS (same path as on IRSA)."""
    assert access_url.startswith(IBE)
    return io.BufferedReader(HttpRaw(S3 + access_url[len(IBE):]), buffer_size=64 * 1024)

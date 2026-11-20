"""The small piece of HEALPix the home backdrop needs: sky position -> NESTED pixel (Górski et al. 2005).

Written out here (numpy only) instead of adding healpy or astropy-healpix for one script. It returns the
face number and the (ix, iy) position on that face as well, because HiPS tiles are laid out by them.
"""

import numpy as np


def _spread_bits(v: np.ndarray) -> np.ndarray:
    """Move bit k of v to bit 2k (enough for nside up to 2**16)."""
    v = v.astype(np.int64) & 0xFFFF
    v = (v | (v << 8)) & 0x00FF00FF
    v = (v | (v << 4)) & 0x0F0F0F0F
    v = (v | (v << 2)) & 0x33333333
    return (v | (v << 1)) & 0x55555555


def xyf2nest(nside: int, ix: np.ndarray, iy: np.ndarray, face: np.ndarray) -> np.ndarray:
    return face.astype(np.int64) * nside * nside + _spread_bits(ix) + (_spread_bits(iy) << 1)


def ang2xyf(nside: int, lon_deg: np.ndarray, lat_deg: np.ndarray):
    """Longitude/latitude in degrees -> (ix, iy, face) of the NESTED pixel that contains them."""
    z = np.sin(np.radians(lat_deg))
    za = np.abs(z)
    tt = np.mod(np.radians(lon_deg), 2 * np.pi) / (np.pi / 2)  # in [0, 4)

    ix = np.empty(z.shape, np.int64)
    iy = np.empty(z.shape, np.int64)
    face = np.empty(z.shape, np.int64)

    # equatorial belt
    eq = za <= 2 / 3
    t1 = nside * (0.5 + tt[eq])
    t2 = nside * z[eq] * 0.75
    jp = (t1 - t2).astype(np.int64)  # ascending edge line
    jm = (t1 + t2).astype(np.int64)  # descending edge line
    ifp = jp // nside
    ifm = jm // nside
    face[eq] = np.where(ifp == ifm, ifp | 4, np.where(ifp < ifm, ifp, ifm + 8))
    ix[eq] = jm & (nside - 1)
    iy[eq] = nside - (jp & (nside - 1)) - 1

    # polar caps
    po = ~eq
    ntt = np.minimum(3, tt[po].astype(np.int64))
    tp = tt[po] - ntt
    tmp = nside * np.sqrt(3 * (1 - za[po]))
    jp = np.minimum((tp * tmp).astype(np.int64), nside - 1)
    jm = np.minimum(((1 - tp) * tmp).astype(np.int64), nside - 1)
    north = z[po] >= 0
    face[po] = np.where(north, ntt, ntt + 8)
    ix[po] = np.where(north, nside - jm - 1, jp)
    iy[po] = np.where(north, nside - jp - 1, jm)
    return ix, iy, face


def ang2nest(nside: int, lon_deg: np.ndarray, lat_deg: np.ndarray) -> np.ndarray:
    return xyf2nest(nside, *ang2xyf(nside, lon_deg, lat_deg))

"""Live tests against IRSA and AWS. Every number from the backend is compared with NASA's original file read independently."""
import math

import astropy.units as u
import httpx
import numpy as np
import pytest
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.wcs import WCS

from app import archive, fitsio
from tests.helpers import open_original

pytestmark = pytest.mark.network
BARNARD = (269.44627, 4.76820)  # where TimeLens centres Barnard's Star (proper motion applied to 2026.0)


@pytest.fixture(scope="module")
def search():
    async def go():
        async with httpx.AsyncClient() as c:
            return await archive.search(c, *BARNARD)
    import asyncio
    return asyncio.run(go())


def test_sia_search_has_dr1_and_qr3_with_provenance(search):
    obs = search["observations"]
    # SIA2 normally; TAP fills in when SIA2 drops connections, and the result must say so
    assert search["complete"] is True
    assert search["adapter"] == "IRSA SIA2" or ("TAP" in search["adapter"] and search["notes"])
    assert search["by_release"].get("dr1", 0) > 100 and search["by_release"].get("qr3", 0) > 50
    assert "qr2" not in search["by_release"]
    for o in obs:
        assert o["access_url"].startswith("https://irsa.ipac.caltech.edu/ibe/data/spherex/")
        assert o["version"].startswith("v") and len(o["processing_date"]) == 10 and o["retrieved_utc"].endswith("Z")
        assert 1 <= o["detector"] <= 6 and o["lambda_min_um"] is not None and o["lambda_min_um"] < o["lambda_max_um"]
    assert [o["mjd"] for o in obs] == sorted(o["mjd"] for o in obs)
    keys = [(o["week"], o["large_slew"], o["small_slew"], o["detector"]) for o in obs]
    assert len(keys) == len(set(keys)), "an exposure appears twice"


def test_tap_fallback_finds_the_same_exposures(search):
    async def go():
        async with httpx.AsyncClient() as c:
            return await archive.tap_search(c, *BARNARD)
    import asyncio
    tap = archive.one_release_per_week(asyncio.run(go()))
    key = lambda o: (o["week"], o["large_slew"], o["small_slew"], o["detector"])  # noqa: E731
    sia = {key(o) for o in search["observations"]}
    tapk = {key(o.public()) for o in tap}
    assert tapk == sia, f"TAP-only {len(tapk - sia)}, SIA-only {len(sia - tapk)}"
    assert all(o.lambda_min_um is not None and o.lambda_min_um < o.lambda_max_um for o in tap)


@pytest.mark.parametrize("release", ["dr1", "qr3"])
def test_cutout_matches_original_file(search, release):
    o = next(x for x in search["observations"] if x["release"] == release and x["detector"] == 2)
    ra, dec = BARNARD

    async def go():
        async with httpx.AsyncClient() as c:
            content, _, _ = await fitsio.fetch_cutout(c, o["access_url"], ra, dec, 0.05)
            return content
    import asyncio
    content = asyncio.run(go())
    got = fitsio.parse_cutout(content, ra, dec)
    with fits.open(__import__("io").BytesIO(content), memmap=False) as cut:
        cx, cy = cut["IMAGE"].header["CRPIX1A"], cut["IMAGE"].header["CRPIX2A"]
    ny, nx = got["shape"]
    img = np.frombuffer(__import__("base64").b64decode(got["image_b64"]), "<f4").reshape(ny, nx)
    flg = np.frombuffer(__import__("base64").b64decode(got["flags_b64"]), "<i4").reshape(ny, nx)
    x0o, y0o = int(round(1 - cx)), int(round(1 - cy))  # 0-based original index of cutout pixel [0, 0]: WCS "A" is 0-based

    with fits.open(open_original(o["access_url"]), lazy_load_hdus=True, memmap=False) as hd:
        oimg = np.asarray(hd["IMAGE"].section[y0o:y0o + ny, x0o:x0o + nx], dtype="<f4")
        oflg = np.asarray(hd["FLAGS"].section[y0o:y0o + ny, x0o:x0o + nx]).astype("<i4")
        assert isinstance(hd["FLAGS"], fits.CompImageHDU), "DR1/QR3 FLAGS are expected to be tile-compressed"
        h = hd["IMAGE"].header
        sky = WCS(h)
        xo, yo = (float(v) for v in sky.world_to_pixel(SkyCoord(ra, dec, unit="deg")))
        spec = WCS(h, fobj=hd, key="W")
        spec.sip = None
        lam, dlam = (float(v) for v in spec.pixel_to_world_values(xo, yo))
        mjd = h["MJD-AVG"]

    same = (img == oimg) | (np.isnan(img) & np.isnan(oimg))
    assert same.all(), f"{(~same).sum()} image pixels differ from the original file"
    assert (flg == oflg).all(), "decoded flags differ from the original file"
    assert flg.max() > 0, "expected some flag bits set (at least the SOURCE bit near a bright star)"
    tx, ty = got["target_pixel_original_1based"]
    assert math.hypot(tx - (xo + 1), ty - (yo + 1)) < 0.01, "target pixel disagrees with the original file's WCS"
    assert got["wavelength_um"] == pytest.approx(lam, abs=2e-4) and got["bandwidth_um"] == pytest.approx(dlam, abs=2e-4)
    assert got["mjd_avg"] == pytest.approx(mjd, abs=1e-9) and got["timesys"] == "UTC"
    assert u.Unit(got["bunit"]) == u.MJy / u.sr  # the file writes "MJy / sr"
    assert any(d["name"] == "SOURCE" for d in got["flags"]["definitions"].values()), "flag names should come from the file"

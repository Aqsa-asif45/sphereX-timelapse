import pytest

from app.config import release_rank
from app.services.archive import describe_key, key_from_url, one_release_per_week
from app.services.frames import position_at, thin_evenly

URL = (
    "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/2025W33_2C/l2b-v27-2026-228/6/"
    "level2_2025W33_2C_0321_1D6_spx_l2b-v27-2026-228.fits"
)


def test_key_from_url_and_description():
    key = key_from_url(URL)
    assert key == "dr1/level2/2025W33_2C/l2b-v27-2026-228/6/level2_2025W33_2C_0321_1D6_spx_l2b-v27-2026-228.fits"
    d = describe_key(key)
    assert (d["release"], d["week"], d["obs"], d["exp"], d["det"]) == ("dr1", "2025W33_2C", 321, 1, 6)
    assert d["processing_date"] == "2026-08-16"  # day 228 of 2026
    assert key_from_url("ibe/data/spherex/" + key) == key  # TAP style


@pytest.mark.parametrize(
    "bad", ["", "https://example.com/x.fits", URL.replace(".fits", ".txt"), URL.replace("/6/", "/7/")]
)
def test_bad_urls_are_refused(bad):
    assert key_from_url(bad) is None


def test_release_rank():
    assert release_rank("dr1") > release_rank("qr3") > release_rank("qr2") > release_rank("xx")


def _cand(release, week, obs, det=1, mjd=60900.0):
    return {
        "id": f"{release}/{week}/{obs}/{det}",
        "release": release,
        "week": week,
        "obs": obs,
        "det": det,
        "mjd_start": mjd,
    }


def test_one_release_per_week():
    cands = [
        _cand("qr3", "2026W20_2A", 1),
        _cand("dr1", "2026W20_2A", 2),  # same week: DR1 wins
        _cand("qr3", "2026W30_1A", 3),  # only QR3 has this week: kept
        _cand("dr1", "2026W20_2A", 2),  # duplicate file: kept once
    ]
    got = one_release_per_week(cands)
    assert [(c["release"], c["week"]) for c in got] == [("dr1", "2026W20_2A"), ("qr3", "2026W30_1A")]


def test_thin_evenly_keeps_ends_and_count():
    items = list(range(1000))
    got = thin_evenly(items, 400)
    assert len(got) == 400 and got[0] == 0 and got[-1] == 999
    assert thin_evenly(items[:10], 400) == items[:10]


def test_position_at_moves_barnards_star_north():
    ra, dec = position_at(269.452077, 4.693365, 51544.5, -801.551, 10362.394, 51544.5 + 365.25 * 26)
    assert (dec - 4.693365) * 3600 == pytest.approx(10.362394 * 26, rel=1e-6)  # about 4.5 arcmin in 26 years
    assert ra < 269.452077

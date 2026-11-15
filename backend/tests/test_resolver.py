import asyncio

import pytest

from app.services.resolver import parse_coords, resolve
from app.services.targets import TARGETS, find_target


@pytest.mark.parametrize(
    "text, ra, dec",
    [
        ("133.795 -7.245", 133.795, -7.245),
        ("133.795, -7.245", 133.795, -7.245),
        ("08h55m10.8s -07d14m42s", 133.795, -7.245),
        ("08:55:10.8 -07:14:42", 133.795, -7.245),
        ("08 55 10.8 -07 14 42", 133.795, -7.245),
        ("08h55m10.8s −07°14′42″", 133.795, -7.245),  # typographic minus and symbols
    ],
)
def test_parse_coords(text, ra, dec):
    got = parse_coords(text)
    assert got is not None
    assert got[0] == pytest.approx(ra, abs=1e-3)
    assert got[1] == pytest.approx(dec, abs=1e-3)


@pytest.mark.parametrize("text", ["Barnard's Star", "R Dra", "M 101", "eps Ind B", "400 10", "10 95", ""])
def test_not_coordinates(text):
    assert parse_coords(text) is None


def test_five_targets_and_lookup():
    assert len(TARGETS) == 5
    assert find_target("barnard").name == "Barnard's Star"
    assert find_target("WISE 0855-0714").slug == "wise-0855"
    assert find_target("wise 0855−0714").slug == "wise-0855"
    assert find_target("Vega") is None
    assert {t.slug for t in TARGETS if not t.in_gaia} == {"eps-indi-b", "wise-0855"}  # brown dwarfs


def test_resolve_fixed_target_needs_no_network():
    r = asyncio.run(resolve(None, "Barnard's Star"))
    assert r["slug"] == "barnard"
    assert r["pmdec"] == pytest.approx(10362.394)


def test_resolve_empty_is_an_error():
    with pytest.raises(ValueError):
        asyncio.run(resolve(None, "   "))

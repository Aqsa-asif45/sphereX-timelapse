"""The five challenge targets.

Positions and motions were checked against Gaia DR3 (ESA) and CatWISE2020 (IRSA) for the old site.
Two of them are brown dwarfs: they are not stars and are not in Gaia, and we say so.
"""

import re
from dataclasses import asdict, dataclass

from ..config import J2000_MJD


@dataclass(frozen=True)
class Target:
    slug: str
    name: str
    kind: str  # "star" | "brown dwarf" | "variable star"
    classification: str
    blurb: str
    look_for: str  # "Motion" | "Brightness"
    lookup: str | None = None  # name sent to MAST when no fixed position is given
    ra: float | None = None  # degrees, ICRS
    dec: float | None = None
    epoch_mjd: float | None = None
    position_source: str | None = None
    pmra: float | None = None  # proper motion, mas/yr (RA includes cos dec)
    pmdec: float | None = None
    pm_source: str | None = None
    in_gaia: bool = True
    note: str | None = None

    def public(self) -> dict:
        return asdict(self)


TARGETS: list[Target] = [
    Target(
        slug="barnard",
        name="Barnard's Star",
        kind="star",
        classification="Red dwarf (M4 V), 6 light-years away; the fastest-moving star in our sky",
        blurb="The fastest-moving star in our sky: about 1.7 SPHEREx pixels a year.",
        look_for="Motion",
        ra=269.4520769586187,
        dec=4.6933649665767,
        epoch_mjd=J2000_MJD,
        position_source="SIMBAD via MAST (J2000); within 0.16″ of Gaia DR3",
        pmra=-801.551,
        pmdec=10362.394,
        pm_source="Gaia DR3",
    ),
    Target(
        slug="eps-indi-b",
        name="Epsilon Indi B",
        kind="brown dwarf",
        classification="Pair of brown dwarfs (T1 + T6) orbiting the star Epsilon Indi A, 12 light-years away",
        blurb="Two brown dwarfs orbiting a bright star; moves about 4.7″ a year.",
        look_for="Motion",
        # "eps Ind B" would match the planet "eps Ind b" (lookups ignore case), so use the 2MASS name
        lookup="2MASS J22041052-5646577",
        pmra=3966.7,
        pmdec=-2536.2,
        pm_source="Epsilon Indi A, Gaia DR3 (B shares its motion within a few %)",
        in_gaia=False,
    ),
    Target(
        slug="wise-0855",
        name="WISE 0855−0714",
        kind="brown dwarf",
        classification="The coldest known brown dwarf (Y dwarf), 7 light-years away",
        blurb="The coldest brown dwarf known. Look in the reddest bands.",
        look_for="Motion",
        ra=133.7951292,
        dec=-7.2451472,
        epoch_mjd=55400.0,
        position_source="Challenge coordinates 08h55m10.831s −07°14′42.53″ (WISE epoch ≈ 2010.6)",
        pmra=-8118.0,
        pmdec=680.0,
        pm_source="Luhman & Esplin 2016 (approximate)",
        in_gaia=False,
        note="Visible, if at all, only at the longest wavelengths (≈ 4–5 µm).",
    ),
    Target(
        slug="rw-aur",
        name="RW Aurigae",
        kind="variable star",
        classification="Young variable star (T Tauri binary) that dims dramatically and unpredictably",
        blurb="A young star that dims dramatically and unpredictably.",
        look_for="Brightness",
        lookup="RW Aur",
    ),
    Target(
        slug="r-dra",
        name="R Draconis",
        kind="variable star",
        classification="Pulsating red giant (Mira variable) with a period of about 8 months",
        blurb="A giant star that brightens and fades over about 8 months.",
        look_for="Brightness",
        lookup="R Dra",
    ),
]

BY_SLUG = {t.slug: t for t in TARGETS}


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower().replace("−", "-"))


def find_target(q: str) -> Target | None:
    """A challenge target by slug, name or lookup name, ignoring case, spaces and punctuation."""
    n = _norm(q)
    for t in TARGETS:
        if n and n in (_norm(t.slug), _norm(t.name), _norm(t.lookup or "")):
            return t
    return None

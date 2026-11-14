"""The five challenge targets. Positions and motions were checked against Gaia DR3 (ESA) and CatWISE2020
(IRSA) on 2026-11-14; see docs/RESEARCH.md. Classifications are given plainly: two are brown dwarfs, not stars."""
from dataclasses import asdict, dataclass

J2000_MJD = 51544.5


@dataclass(frozen=True)
class Target:
    slug: str
    name: str
    classification: str
    kind: str  # 'star' | 'brown dwarf' | 'variable star'
    look_for: str  # 'motion' | 'brightness'
    lookup: str | None  # name sent to the resolver; None when the position is fixed here
    ra: float | None = None  # degrees, ICRS
    dec: float | None = None
    epoch_mjd: float | None = None
    position_source: str | None = None
    pmra: float | None = None  # mas/yr, includes cos(dec)
    pmdec: float | None = None
    pm_source: str | None = None
    in_gaia: bool = True

    def public(self) -> dict:
        return asdict(self)


TARGETS: list[Target] = [
    Target("barnard", "Barnard's Star", "Red dwarf (M4 V), 6 light-years away; the fastest-moving star in our sky", "star", "motion",
           None, 269.4520769586187, 4.6933649665767, J2000_MJD, "SIMBAD via MAST (J2000); within 0.16″ of Gaia DR3 propagated to J2000",
           -801.551, 10362.394, "Gaia DR3 (identical to the ESA archive value)"),
    Target("eps-indi-b", "Epsilon Indi B", "Pair of brown dwarfs (T1 + T6) orbiting the star Epsilon Indi A, 12 light-years away", "brown dwarf", "motion",
           "2MASS J22041052-5646577", pmra=3966.7, pmdec=-2536.2, pm_source="Epsilon Indi A, Gaia DR3 (B shares its motion within a few %)", in_gaia=False),
    Target("wise-0855", "WISE 0855−0714", "The coldest known brown dwarf (Y dwarf), 7 light-years away", "brown dwarf", "motion",
           None, 133.7951292, -7.2451472, 55400.0, "Challenge coordinates 08h55m10.831s −07°14′42.53″ (WISE epoch ≈ 2010.6); verified with Astropy",
           -8118.0, 680.0, "Luhman & Esplin 2016 (approximate); agrees with CatWISE2020 to 0.55 px", in_gaia=False),
    Target("rw-aur", "RW Aurigae", "Young variable star (T Tauri binary) that dims dramatically and unpredictably", "variable star", "brightness", "RW Aur"),
    Target("r-dra", "R Draconis", "Pulsating red giant (Mira variable) with a period of about 8 months", "variable star", "brightness", "R Dra"),
]

BY_SLUG = {t.slug: t for t in TARGETS}

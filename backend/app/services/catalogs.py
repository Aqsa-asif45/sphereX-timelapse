"""Catalogue overlays: stars from other telescopes around a position.

  gaia: ESA Gaia DR3 (positions at epoch 2016.0, with proper motions) from ESA's own Gaia archive
        (fast and reliable when tested); if ESA fails, the same table via IRSA TAP. IRSA's catalogue
        service has taken minutes or hung entirely on some days, so it is the fallback, not the first try.
  wise: CatWISE2020 (WISE + NEOWISE, positions near epoch 2015.4) via IRSA TAP. Its proper motions are
        in arcsec/yr and noisy for faint sources, so only significant ones (> 5 sigma) are kept.
Results are cached on disk, so a field that worked once keeps working offline.
"""

import csv
import hashlib
import io
import json

import httpx

from ..config import TAP_URL, settings

ESA_TAP = "https://gea.esac.esa.int/tap-server/tap/sync"
GAIA_EPOCH_MJD = 57388.5  # J2016.0
CATWISE_EPOCH_MJD = 57170.0  # about 2015.4, CatWISE2020's reference epoch
MAX_ROWS = 3000
CACHE_VERSION = "k1"


class CatalogError(RuntimeError):
    """The catalogue service could not be reached or answered with an error."""


def _circle(ra: float, dec: float, r: float) -> str:
    return f"1=CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', {ra:.6f}, {dec:.6f}, {r:.5f}))"


def _csv(text: str) -> list[dict]:
    if text.lstrip().startswith("<"):  # an XML or HTML error page instead of a table
        raise CatalogError("the service answered with an error page")
    return list(csv.DictReader(io.StringIO(text.strip())))


async def _irsa(client: httpx.AsyncClient, query: str) -> list[dict]:
    try:
        r = await client.get(TAP_URL, params={"QUERY": query, "FORMAT": "csv"}, timeout=60)
        r.raise_for_status()
    except httpx.HTTPError as e:
        raise CatalogError(f"IRSA: {type(e).__name__}") from e
    return _csv(r.text)


async def _esa(client: httpx.AsyncClient, query: str) -> list[dict]:
    data = {"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "csv", "QUERY": query}
    try:
        r = await client.post(ESA_TAP, data=data, timeout=60)
        r.raise_for_status()
    except httpx.HTTPError as e:
        raise CatalogError(f"ESA: {type(e).__name__}") from e
    return _csv(r.text)


def _num(x: str | None) -> float | None:
    try:
        v = float(x)  # type: ignore[arg-type]
        return v if v == v else None  # NaN -> None
    except (TypeError, ValueError):
        return None


async def gaia(client: httpx.AsyncClient, ra: float, dec: float, r: float) -> dict:
    cols = "ra, dec, pmra, pmdec, phot_g_mean_mag"
    where = f"{_circle(ra, dec, r)} AND phot_g_mean_mag < 20"
    try:
        rows = await _esa(
            client, f"SELECT TOP {MAX_ROWS} {cols} FROM gaiadr3.gaia_source WHERE {where} ORDER BY phot_g_mean_mag"
        )
        source = "Gaia DR3 via ESA"
    except CatalogError:
        rows = await _irsa(
            client, f"SELECT TOP {MAX_ROWS} {cols} FROM gaia_dr3_source WHERE {where} ORDER BY phot_g_mean_mag"
        )
        source = "Gaia DR3 via IRSA"
    out = [
        {
            "ra": _num(x["ra"]),
            "dec": _num(x["dec"]),
            "mag": _num(x["phot_g_mean_mag"]),
            "pmra": _num(x.get("pmra")),
            "pmdec": _num(x.get("pmdec")),
        }
        for x in rows
    ]
    return {"cat": "gaia", "epoch_mjd": GAIA_EPOCH_MJD, "band": "G", "pm_unit": "mas/yr", "source": source, "rows": out}


async def catwise(client: httpx.AsyncClient, ra: float, dec: float, r: float) -> dict:
    q = (
        f"SELECT TOP {MAX_ROWS} ra, dec, w1mpro, w2mpro, pmra, pmdec, sigpmra, sigpmdec FROM catwise_2020 "
        f"WHERE {_circle(ra, dec, r)} AND w2mpro < 17 ORDER BY w2mpro"
    )
    out = []
    for x in await _irsa(client, q):
        pmra, pmdec = _num(x.get("pmra")), _num(x.get("pmdec"))
        sra, sdec = _num(x.get("sigpmra")), _num(x.get("sigpmdec"))
        keep = None not in (pmra, pmdec, sra, sdec) and (pmra**2 + pmdec**2) ** 0.5 > 5 * ((sra**2 + sdec**2) ** 0.5)
        out.append(
            {
                "ra": _num(x["ra"]),
                "dec": _num(x["dec"]),
                "mag": _num(x["w2mpro"]),
                "pmra": pmra * 1000 if keep else None,
                "pmdec": pmdec * 1000 if keep else None,
            }
        )  # -> mas/yr
    return {
        "cat": "wise",
        "epoch_mjd": CATWISE_EPOCH_MJD,
        "band": "W2 (4.6 µm)",
        "pm_unit": "mas/yr",
        "source": "CatWISE2020 via IRSA",
        "rows": out,
    }


async def catalog(client: httpx.AsyncClient, cat: str, ra: float, dec: float, r: float) -> dict:
    """Stars within r degrees of (ra, dec). Raises CatalogError when no service answers."""
    raw = f"{CACHE_VERSION}|{cat}|{ra:.5f}|{dec:.5f}|{r:.4f}"
    path = settings.cache_dir / "catalogs" / (hashlib.sha1(raw.encode()).hexdigest() + ".json")
    if path.exists():
        return {**json.loads(path.read_text()), "from_cache": True}
    out = await (gaia if cat == "gaia" else catwise)(client, ra, dec, r)
    out["count"] = len(out["rows"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out))
    return {**out, "from_cache": False}

"""Home-page backdrop (docs/HOME_REDESIGN_PLAN.md, phase H1): NASA's SPHEREx DR1 all-sky map as a few
small WebP layers for the hero. Decoration only: never used for measurements (science rule 6).

Where the pixels come from: IRSA's SPHEREx all-sky HiPS cube, three wavelength frames made into a
false-colour picture (infrared has no true colour): 4.6 µm as red, 2.1 µm as green, 1.1 µm as blue (the
usual convention: longest wavelength reddest). Each frame is read from its order-3 "Allsky" PNG: all 768
order-3 tiles at 64 × 64 px in one file, so HEALPix nside 512 (about 6.9′ per pixel), which is enough
for a 2400 px wide map (9′ per pixel). The grey levels
are IRSA's own display stretch (asinh, cut 0–40 in the HiPS properties); the only change is one constant gain
per colour, so the three channels reach the same brightness at their 99.5th percentile (recorded in the JSON).

What the script does to them, and nothing else:
1. Resamples the HEALPix pixels onto a plate carrée map in galactic coordinates (Milky Way across the
   middle, l = 0 in the centre, l growing to the left as on the sky), averaging 3 × 3 sub-samples per
   output pixel so small stars are not dropped.
2. Splits that map into two layers that add back to it exactly: where a pixel is brighter than its local
   median (in any colour) by more than the cut, "stars" holds how far above it sits; "faint" is the map
   minus that. In the browser, stacking "stars" over "faint"
   with `mix-blend-mode: plus-lighter` gives the map again.
3. Saves WebP files for desktop (2400 px), phones (1200 px, a 2 × 2 average of the desktop map) and a
   tiny blurred poster for the first paint, and checks the stacked files against the map.
4. Holes where NASA masked a saturated star are made transparent in the faint layer (soft-edged, about
   2 px), so they show as "no data" over the page's dark background instead of hard black bars. Nothing
   is filled in: the edge only hides a thin rim of real pixels, it never adds values.
"""

import json
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path

import httpx
import numpy as np
from astropy import units as u
from astropy.coordinates import SkyCoord
from PIL import Image, ImageFilter
from scipy.ndimage import binary_dilation, binary_opening, gaussian_filter, median_filter

from .healpix import ang2nest, ang2xyf

HIPS_URL = "https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube"
ALLSKY_ORDER = 3  # order of the tiles in the Allsky file
ALLSKY_TILE = 64  # px per tile in the Allsky file
NSIDE = 2**ALLSKY_ORDER * ALLSKY_TILE  # HEALPix resolution of the Allsky pixels (512)
OUT_DIR = Path(__file__).resolve().parents[3] / "frontend" / "public" / "backdrop"

DESKTOP_W = 2400
PHONE_W = 1200
POSTER_W = 320
SUPERSAMPLE = 3
STAR_BOX = 9  # px, median window for the local sky level (desktop scale)
CHANNELS = {"red": 90, "green": 44, "blue": 16}  # HiPS cube frames (0-based): 4.6, 2.1 and 1.1 µm
GAIN_PERCENTILE = 99.5
GAP_SOFTEN_PX = 1.5  # Gaussian sigma of the soft edge around masked holes (desktop pixels)
HOLE_REACH = 31  # px: a masked hole is a 0 where the median of this box (same colour) is above HOLE_LEVEL
HOLE_LEVEL = 60  # (30 also catches dark specks in the 4.6 and 2.1 µm sky; 60 keeps only real holes)
STAR_CUT = 24  # grey levels above the local sky level that count as a bright star (10 lets noise in)
# bytes per size, both layers + poster (plan: phones "near 300 KB"; desktop kept well under 1 MB for NF-1)
BUDGET = {"phone": 300_000, "desktop": 600_000}
POSTER_BUDGET = 20_000


def parse_properties(text: str) -> dict[str, str]:
    out = {}
    for line in text.splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def sample_allsky(allsky: np.ndarray, lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    """Value(s) of the Allsky pixel that contains each ICRS position (degrees); allsky is (H, W) or (H, W, C).

    Tile n sits at column n % k, row n // k with k = floor(sqrt(768)) = 27 tiles per row. Inside a tile the
    image row is the HEALPix face x and the column is face y (low bits of ix, iy): checked by sampling
    bright 2 µm stars (Betelgeuse, Antares, Aldebaran land on bright pixels; the other 7 layouts miss) and by
    the tile seams being smoothest that way.
    """
    per_row = int(np.sqrt(12 * 4**ALLSKY_ORDER))
    ix, iy, _ = ang2xyf(NSIDE, lon, lat)
    tile = ang2nest(2**ALLSKY_ORDER, lon, lat)
    row = (tile // per_row) * ALLSKY_TILE + (ix & (ALLSKY_TILE - 1))
    col = (tile % per_row) * ALLSKY_TILE + (iy & (ALLSKY_TILE - 1))
    return allsky[row, col]


def render_galactic(allsky: np.ndarray, width: int, ss: int = SUPERSAMPLE) -> np.ndarray:
    """Plate carrée map (width × width/2, plus any colour axis) in galactic coordinates, float levels 0–255."""
    height = width // 2
    out = np.empty((height, width, *allsky.shape[2:]), np.float64)
    sub = (np.arange(width * ss) + 0.5) / (width * ss)
    lon = (180 - sub * 360) % 360  # l = 180 at the left edge, 0 in the middle, growing to the left
    strip = 50  # output rows per step, to keep memory small
    for r0 in range(0, height, strip):
        r1 = min(height, r0 + strip)
        b = 90 - (np.arange(r0 * ss, r1 * ss) + 0.5) / (height * ss) * 180
        L, B = np.meshgrid(lon, b)
        icrs = SkyCoord(l=L * u.deg, b=B * u.deg, frame="galactic").icrs
        v = sample_allsky(allsky, icrs.ra.deg, icrs.dec.deg).astype(np.float64)
        out[r0:r1] = v.reshape(r1 - r0, ss, width, ss, *allsky.shape[2:]).mean(axis=(1, 3))
    return out


def split_layers(img: np.ndarray, box: int, cut: int) -> tuple[np.ndarray, np.ndarray]:
    """(faint, stars), both uint8 (H, W, 3), with faint + stars == img exactly."""
    sky = median_filter(img, size=(box, box, 1), mode="wrap")
    excess = img.astype(np.int16) - sky.astype(np.int16)
    star = (excess > cut).any(axis=2, keepdims=True)  # one mask for all colours, so stars keep their colour
    stars = np.where(star, np.maximum(excess, 0), 0).astype(np.uint8)
    faint = (img - stars).astype(np.uint8)
    assert np.array_equal(faint.astype(np.int16) + stars, img), "layers must add back to the map"
    return faint, stars


def downsample2(img: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    small = img.astype(np.float64).reshape(h // 2, 2, w // 2, 2, *img.shape[2:]).mean(axis=(1, 3))
    return np.rint(small).astype(np.uint8)


def webp(img: np.ndarray, quality: int) -> bytes:
    buf = BytesIO()
    Image.fromarray(img, "RGBA" if img.shape[2] == 4 else "RGB").save(buf, "WEBP", quality=quality, method=6)
    return buf.getvalue()


def gap_alpha(hole_fraction: np.ndarray, soften: float) -> np.ndarray:
    """Opacity (uint8) that is 0 over masked holes and fades to 255 over about `soften` px around them."""
    soft = gaussian_filter(hole_fraction, soften) if soften else hole_fraction
    return np.rint(np.clip(1 - 1.6 * np.maximum(soft, hole_fraction), 0, 1) * 255).astype(np.uint8)


def decode(data: bytes) -> np.ndarray:
    return np.asarray(Image.open(BytesIO(data)).convert("RGB"), np.int16)


def stack_error(faint: bytes, stars: bytes, ref: np.ndarray) -> dict:
    """How far the stacked WebP files are from the map (lossy WebP, so not exactly zero)."""
    d = np.abs(np.clip(decode(faint) + decode(stars), 0, 255) - ref.astype(np.int16))
    return {"mean_abs": round(float(d.mean()), 3), "p99_abs": int(np.percentile(d, 99)), "max_abs": int(d.max())}


async def build(client: httpx.AsyncClient, out_dir: Path = OUT_DIR, log=print) -> dict:
    props = parse_properties((await client.get(f"{HIPS_URL}/properties")).raise_for_status().text)
    waves = [float(w) for w in props["data_cube_crval3_arr"].split()]
    urls, planes = {}, []
    for colour, frame in CHANNELS.items():
        urls[colour] = f"{HIPS_URL}/Norder{ALLSKY_ORDER}/Allsky" + (f"_{frame}" if frame else "") + ".png"
        log(f"Downloading {urls[colour]} ({colour}: frame {frame}, {waves[frame]} µm) ...")
        png = (await client.get(urls[colour])).raise_for_status().content
        planes.append(np.asarray(Image.open(BytesIO(png)).convert("L")))
    allsky = np.stack(planes, axis=2)
    # NASA masks saturated stars as 0 in some wavelengths but not others, which would show as coloured bars;
    # a solid patch of 0s (3 × 3 px or more; lone 0s are noise) inside a region that is bright in that colour
    # is such a hole, so blank it in every colour (a dark gap, as in the data); dark sky has a median near 0
    solid = binary_opening(allsky == 0, structure=np.ones((3, 3, 1), bool))
    holes = (solid & (median_filter(allsky, size=(HOLE_REACH, HOLE_REACH, 1)) > HOLE_LEVEL)).any(axis=2)
    holes = binary_dilation(holes, iterations=2)  # and the thin edges the 3 × 3 test leaves
    allsky[holes] = 0
    log(f"Blanked {int(holes.sum())} masked pixels ({holes.mean():.3%}) in all colours")

    log(f"Resampling to a {DESKTOP_W} × {DESKTOP_W // 2} galactic map ...")
    # the hole mask rides along as a fourth channel, so it lands exactly where the holes do
    rendered4 = render_galactic(np.concatenate([allsky, (holes * 255).astype(np.uint8)[..., None]], axis=2), DESKTOP_W)
    rendered, hole_fraction = rendered4[..., :3], rendered4[..., 3] / 255
    alpha_desk = gap_alpha(hole_fraction, GAP_SOFTEN_PX)
    alpha_phone = downsample2(alpha_desk)
    level = np.percentile(rendered, GAIN_PERCENTILE, axis=(0, 1))
    gains = level.max() / np.maximum(level, 1)  # one constant per colour: balance only, no re-stretch
    desk = np.rint(np.clip(rendered * gains, 0, 255)).astype(np.uint8)
    phone = downsample2(desk)
    layers = {
        "desktop": (desk, split_layers(desk, STAR_BOX, STAR_CUT)),
        "phone": (phone, split_layers(phone, (STAR_BOX // 2) | 1, STAR_CUT)),
    }
    poster_img = Image.fromarray(phone, "RGB").resize((POSTER_W, POSTER_W // 2), Image.LANCZOS)
    poster_img = poster_img.filter(ImageFilter.GaussianBlur(1.5))
    buf = BytesIO()
    poster_img.save(buf, "WEBP", quality=50, method=6)
    poster = buf.getvalue()

    # per size, the highest quality that keeps its two layers (+ the poster) within budget
    files, quality, totals = {"sky-poster.webp": poster}, {}, {}
    alphas = {"desktop": alpha_desk, "phone": alpha_phone}
    for name, (_, (faint, stars)) in layers.items():
        faint_a = np.dstack([faint, alphas[name]])  # masked holes see through to the page: no data, not black
        for q in range(80, 29, -5):
            pair = {f"sky-{name}-faint.webp": webp(faint_a, q), f"sky-{name}-stars.webp": webp(stars, q)}
            total = sum(map(len, pair.values())) + len(poster)
            if total <= BUDGET[name]:
                break
        files.update(pair)
        quality[name], totals[name] = q, total

    out_dir.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        (out_dir / name).write_bytes(data)

    meta = {
        "label": "SPHEREx all-sky map, false colour: "
        + " / ".join(f"{waves[f]:.1f}" for f in CHANNELS.values())
        + " µm as red / green / blue (DR1)",
        "use": "decoration only (home hero); never for measurements",
        "gaps": f"NASA's masked holes are transparent in the faint layer (soft edge, sigma {GAP_SOFTEN_PX} px): "
        "no data is shown there and nothing is filled in",
        "source": {
            "title": props.get("obs_title"),
            "ivoid": props.get("creator_did"),
            "hips_url": HIPS_URL,
            "allsky_files": urls,
            "hips_release_date": props.get("hips_release_date"),
            "copyright": props.get("obs_copyright"),
            "channels": {c: {"cube_frame": f, "wavelength_um": waves[f]} for c, f in CHANNELS.items()},
            "colour_gains": {c: round(float(g), 4) for c, g in zip(CHANNELS, gains, strict=True)},
            "gain_rule": f"each colour scaled so its {GAIN_PERCENTILE}th percentile matches the brightest one",
            "pixel_stretch": f"IRSA's PNG tiles as published ({props.get('hips_pixel_function')}, "
            f"cut {props.get('hips_pixel_cut')}); not re-stretched",
            "healpix_nside": NSIDE,
        },
        "projection": {
            "frame": "galactic",
            "type": "plate carrée (CAR), full sky, 2:1",
            "centre": "l = 0, b = 0",
            "left_edge_l_deg": 180,
            "longitude_grows": "to the left (as seen on the sky)",
            "supersample": SUPERSAMPLE,
        },
        "layers": {
            "how": "stars = levels above the local median where any colour exceeds it by more than star_cut; "
            "faint = map − stars",
            "blend": "draw stars over faint with mix-blend-mode: plus-lighter to get the map back",
            "star_box_px": {"desktop": STAR_BOX, "phone": (STAR_BOX // 2) | 1},
            "star_cut": STAR_CUT,
        },
        "webp_quality": quality,
        "files": {n: {"bytes": len(d), "size": list(Image.open(BytesIO(d)).size)} for n, d in sorted(files.items())},
        "total_bytes": totals,
        "stack_check": {
            name: stack_error(files[f"sky-{name}-faint.webp"], files[f"sky-{name}-stars.webp"], ref)
            for name, (ref, _) in layers.items()
        },
        "created": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    (out_dir / "backdrop.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", "utf-8")
    for name, total in totals.items():
        if total > BUDGET[name]:
            log(f"WARNING: {name} files are {total} B, over the {BUDGET[name]} B budget")
    if len(poster) > POSTER_BUDGET:
        log(f"WARNING: poster is {len(poster)} B, over the {POSTER_BUDGET} B budget")
    return meta

# SPHEREx research notes (Phase 0)

Checked on 2026-11-14 against the live archive. "Verified" means we queried it or read the file with Astropy ourselves; "docs" means it comes from IRSA's documentation or tutorials and has not been re-checked here yet.

## Data releases

| Release | Holds | Status |
|---|---|---|
| **DR1** (12 Nov 2026) | Surveys 1–2, reprocessed (pipeline v27). Adds the all-sky spectral cube and its HiPS. | Current. On AWS: 110 weeks, 2025W17_4B … 2026W20_1A (verified). |
| **QR3** (weekly since Sep 2026) | Surveys 3–4 (v27). Also re-did weeks 2026W20_2A … W29_2A. | Current. On AWS: 41 weeks, 2026W20_2A … 2026W40_2A (verified). |
| QR2 | First year, older calibration. | Superseded by DR1 + QR3. Not searchable at IRSA any more; downloadable until Feb 2027 (docs). Every QR2 week has a DR1 or QR3 copy (verified: 151 distinct weeks, no gaps). |

Rule used by the server since today: each week is read from one release only, the best one (DR1 > QR3 > QR2), so no exposure is counted twice.

## Spectral image files (Level 2 MEF)

One file per detector per exposure, 2040 × 2040 pixels, about 70 MB.

| HDU | Content | Notes |
|---|---|---|
| IMAGE | Surface brightness, **MJy/sr** | Zodiacal light **not** subtracted (docs). BUNIT verified. |
| FLAGS | Per-pixel bit mask | **Tile-compressed in v27 (DR1, QR3)**: RICE_1, one tile per image row (ZTILE 2040 × 1), BLOCKSIZE 32, BYTEPIX 4 (verified). Bit names in `MSKNnnnn`, descriptions in `MSKDnnnn` (docs; to verify). QR2 FLAGS are plain int32. |
| VARIANCE | (MJy/sr)² | Not used by the app yet. |
| ZODI | Zodiacal light model, MJy/sr | Not subtracted from IMAGE. |
| EPSF (v27) / PSF (QR2) | PSF models | ePSF: 21 × 21 zones (detector 3: 11 × 41), 33 × 33, oversampled 5×. Use ePSF for all releases (docs). |
| WCS-WAVE | Wavelength lookup table (X, Y, VALUES) | Visualisation accuracy (~1 nm). Science: CWAVE/CBAND calibration files (docs). |

- Sky WCS: TAN-SIP, FITS 1-based pixels; alternate WCS "A" is 0-based (docs).
- Spectral WCS: alternate key **W**, `WAVE-TAB`, CRPIX = CDELT = CRVAL = 1, so the lookup uses the 1-based pixel directly. **The celestial SIP terms must not be applied to it** (Astropy attaches them unless `sip = None`; the IRSA tutorial does the same). Our server's lookup matches Astropy exactly once SIP is removed (verified).
- Time: `MJD-AVG`, `TIMESYS = 'UTC'` (verified).
- Pixel scale 6.15″; one pixel = 8.889963 × 10⁻¹⁰ sr, so 1 MJy/sr over one pixel = 888.996 µJy (verified with astropy.units).
- Bands (docs): 1: 0.75–1.09 µm R 39 · 2: 1.10–1.62 R 41 · 3: 1.63–2.41 R 41 · 4: 2.42–3.82 R 35 · 5: 3.83–4.41 R 112 · 6: 4.42–5.00 R 128. Detector corners run slightly past these edges (seen: band 2 up to 1.6605 µm).

## Access methods

| Method | Endpoint | Verified from this machine |
|---|---|---|
| SIA2 | `https://irsa.ipac.caltech.edu/SIA?COLLECTION=…&POS=CIRCLE ra dec r` | **Fast (1–4 s).** At Barnard's Star: `spherex_dr1` 239, `spherex_qr3` 119, `spherex_dr1_cube` 1, `spherex_dr1_deep` 0, `spherex_qr3_deep` 0, `spherex_qr2` 0. Lags new data by about a day (docs). |
| TAP | `https://irsa.ipac.caltech.edu/TAP/sync`, tables `spherex.artifact`, `spherex.plane` | Works but slow: 77 s for one position today. No ingestion lag (docs). URIs now look like `ibe/data/spherex/dr1/level2/…`. |
| Cutouts | file URL + `?center=RA,DECd&size=DEG` | Docs; returns a MEF with all HDUs cropped. |
| Direct files | `https://irsa.ipac.caltech.edu/ibe/data/spherex/{dr1,qr3,qr2}/level2/<week>/<version>/<det>/` | Verified via SIA access URLs. |
| AWS | `https://nasa-irsa-spherex.s3.amazonaws.com/{dr1,qr2,qr3}/level2/…` (anonymous, byte ranges) | Verified; this is what the server reads pixels from. |
| Spectrophotometry tool | `https://irsa.ipac.caltech.edu/applications/spherex/tool-spectrophotometry` | Docs. Official forced-photometry spectra. |

## All-sky cube (DR1)

- 12,288 tiles, HEALPix order 5, NESTED; 512 × 512 pixels of 12.9″; 102 channels (17 per detector). HDUs: IMAGE, NHITS, FLAGS, SPECTRAL_CHANNELS, WCS-WAVE. Zodi **subtracted** (unlike the MEFs). About 300 MB per tile (docs), so never fetched whole in the browser.
- Tile URL: `https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/hips5_cube/hips_20261026/Norder5/Dir{(ipix//10000)*10000}/Npix{ipix}_cube.fits` (verified via SIA). The bare directory URL returns 404 (verified), so tiles are addressed only by computed path.
- It is a spatial and spectral overview, **not** a time series.

## HiPS (for the panorama)

Root: `https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube` (properties verified):

- `hips_order 5`, `hips_order_min 0`, `hips_tile_width 512`, `hips_frame equatorial`, `hips_tile_format png`, `dataproduct_type cube`, `hips_cube_depth 102`, `hips_cube_firstframe 1`.
- Display stretch baked into the PNGs: `hips_pixel_function asinh`, `hips_pixel_cut 0 40` (MJy/sr). Visualisation only.
- Frame index = 17·(band − 1) + (channel − 1). Wavelength per frame in `data_cube_crval3_arr` (0.753 … 4.988 µm). Frames 50 and 51 (0-based) are blank.
- Tile names: frame 0 has no suffix (`Npix0.png`), frames 1–101 use `_k` (`Npix0_62.png`); `_0` and `_102` do not exist (verified). `Norder3/Allsky[_k].png` holds all 768 order-3 tiles in one image (about 1 MB per frame, verified); there is no Norder1/2 Allsky.
- CORS: `Access-Control-Allow-Origin: *` on tiles (verified), so WebGL can use them directly. No `Cache-Control` header, only ETag.
- Allsky images are HEALPix diamonds stored as squares: they must be mapped onto the sphere with HEALPix geometry, never stretched as a flat map.
- Credits from properties: `obs_copyright NASA/SPHEREx`, `hips_copyright Caltech/IPAC`.

## Visualisation tools

- **Aladin Lite v3** (already used by the original app, `aladin-lite@3.9.2-beta`): renders HiPS correctly; projections TAN, STG, SIN, ZEA, MER, AIT, MOL; markers, catalogues and events (`objectClicked`, `positionChanged`, `zoomChanged`). LGPL-3.0; its logo must stay visible. Documented feature list includes "HiPS cube", but no frame-switching API is documented (to test). No documented animated fly-to.
- **Three.js**: needed for a genuine 3D look-around with custom markers and scroll choreography; HEALPix tile geometry must be built by us and validated against Gaia star positions.
- Firefly (IRSA's viewer) and WiseView: reference only.

## External services

| Service | Use | From this machine |
|---|---|---|
| Gaia DR3 (ESA TAP) | Astrometry, proper motion | Reachable, fast. Our overlay matches ESA row for row (55/55). |
| IRSA TAP (Gaia, CatWISE2020, 2MASS) | Catalogues | Reachable; queries can take over a minute. CatWISE pm units arcsec/yr (verified). |
| MAST name lookup | Name → position | Reachable (used by the server). |
| SIMBAD TAP (CDS) | Reverse lookup, object types | `sim-tap/sync` returned 404 today; Sesame mirror timed out; VizieR unreachable. Needs another endpoint or mirror. |
| MOST (IRSA) | Known Solar System objects | Docs only so far. |
| NEOSSat / CADC | Separate optional layer | Not checked yet. |

## Scientific limitations to respect

- HiPS PNGs and the all-sky cube are not for measurements; spectral images are.
- WCS-WAVE is ~1 nm; quote CWAVE/CBAND for science wavelengths.
- Combining QR2 with DR1/QR3 needs the Flux Corrections product; avoided by the one-release-per-week rule.
- The app's photometry is a 1.6-pixel aperture without aperture correction: it is not total flux (to label or correct).
- Brown dwarfs (WISE 0855, ε Indi B) are not in Gaia; Gaia cannot confirm them.

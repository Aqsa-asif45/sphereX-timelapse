# SPHEREx TimeLens: Planet X & SPHEREx (NASA Space Apps 2026)

Type a star's name or a sky position. TimeLens finds **every NASA SPHEREx image of that spot**, lines them up and plays them **like a flipbook**, so anyone can see what moves or changes in the infrared sky.

Real data only: every pixel comes from NASA's SPHEREx files. Nothing is simulated.

## What it does

| Challenge asks for | TimeLens |
|---|---|
| RA/Dec in, a little video out | Names or coordinates (decimal or sexagesimal). **Blink** two visits, **Play** all visits, step through **Every exposure**. |
| Use the 102 bands | All colours combined, **six bands side by side**, **false colour** (short = blue, long = red), or one band. |
| Add up each detector for S/N | Each picture is a sigma-clipped stack of many exposures. |
| Spectra on the fly | **Spectrum**: brightness vs wavelength from every exposure, one line per visit; **Brightness over time** per band. CSV download. |
| Add / subtract images | **Difference** and **Combine** any two visits. |
| Choose the field of view | 2′ to 30′. |
| Overlay Gaia / WISE | Gaia DR3 (moved to each date) and CatWISE2020. |
| Coordinates in the URL, embeddable | `?q=barnard`, `?ra=…&dec=…`, plus `/embed`. |
| Contamination flags | **Bad pixels** overlay with the flag names from each file. |
| Astropy / Aladin | Astropy for FITS, WCS, time and units; Aladin Lite for the whole-sky globe. |
| Spot movers | **Movers** mode; anything not in Gaia is "worth a closer look", never "discovered". |

## How the data flows

```
browser (React, Web Worker, Canvas)
   └─► FastAPI backend ─► IRSA SIA2 "which images cover this spot?"  (backup: IRSA TAP, then the local sky index)
                       ─► NASA's AWS copy of SPHEREx: reads only the bytes it needs (headers, then pixel rows)
                       ─► disk cache backend/data/cache/ (second view of anything is instant)
```

Images are cut north-up on a grid shared by every exposure, resampled by exact pixel overlap (no ringing), with NASA's dead, cold and cosmic-ray pixels left blank.

## Run it

```
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements-dev.txt
.venv/Scripts/python -m uvicorn app.main:app --port 8000

cd frontend
npm install
npm run dev                       # http://localhost:5173

cd backend
.venv/Scripts/python -m app.cli warm   # optional: pre-build the 5 challenge targets for a fast demo
```

The five challenge targets come **pre-built** at the default 4′ field (`backend/data/prebuilt/`, ~17 MB): the backend copies them into its cache on start-up, so they open in seconds on a fresh clone. Other fields and places are fetched from NASA the first time, then cached.

No accounts, keys or secrets are needed. Settings (all optional) are listed in `.env.example`.

## Tests

```
backend/.venv/Scripts/python -m pytest backend/tests -m "not network"
cd frontend ; npm test ; npm run lint ; npm run build
```

## How we know it is right

Checked on 2026-11-15 against NASA's original files read independently with Astropy (20 exposures, all 5 targets, DR1 + QR3, all 6 detectors): target pixel within 0.0007 px, wavelength within 0.005 nm, times exact, raw pixels and flags identical. Exposure lists match IRSA's own search file by file.

## Credits

SPHEREx data: NASA/JPL-Caltech/IPAC (IRSA). Gaia DR3: ESA. CatWISE2020: IRSA. Aladin Lite: CDS Strasbourg. Name lookup: MAST (SIMBAD, NED).

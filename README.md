# SPHEREx Time-Lapse: Planet X & SPHEREx (NASA Space Apps 2026)

A public web tool that turns NASA SPHEREx near-infrared images of any patch of sky into a
time-lapse, so anyone can spot things that move or change: nearby stars, brown dwarfs,
asteroids, variable stars.

Type a star name or coordinates and it finds every SPHEREx exposure of that spot and
blinks them. You can also:
- split the 102 infrared colours into bands;
- add or subtract visits;
- measure a spectrum anywhere you click;
- overlay Gaia and WISE catalogues;
- flag bad pixels;
- export a GIF or video;
- keep a list of things you spotted.

## Run it on your computer

You need **Node.js 20 or newer** ([nodejs.org](https://nodejs.org), the LTS version) and **git**.
Check with `node --version`. Nothing else: no Python, no database, no API keys.

```bash
git clone https://github.com/Kietsuka/-spherex-timelapse.git spherex-timelapse
cd spherex-timelapse
npm install
npm run build
npm start
```

When it prints `SPHEREx time-lapse running at http://localhost:5173`, open:
- **http://localhost:5173/timelens/**: TimeLens, the new interface
- **http://localhost:5173/**: the original viewer

Keep the terminal open while you use it. **Ctrl + C** stops it.

Good to know:
- **Keep the folder name** (`spherex-timelapse`) at the end of the clone command. The repo name starts with a hyphen, and `cd -spherex-timelapse` fails in PowerShell, macOS and Linux.
- **Run `npm run build` again after every `git pull`.** The built files (`dist/`) are not in git.
- **Don't open the HTML files directly.** They show a blank page; the server must be running.
- **Everyone runs their own copy.** The server only accepts connections from the same computer.
- **The first visit to a target is slow.** It downloads that target's images from NASA, which can take a few minutes; later visits are instant. To pre-load the five featured targets, run `node scripts/warm.mjs` in a second terminal while the server is running.

### If it doesn't work

| You see | Fix |
|---|---|
| `cd: -s: invalid option`, or `A parameter cannot be found that matches parameter name 'spherex-timelapse'` | The folder name starts with a hyphen (also from **Download ZIP**: `-spherex-timelapse-main`). Rename the folder to `spherex-timelapse`, or use `cd ./-spherex-timelapse`. |
| `Cannot find module '...dist\server.js'` | You skipped the build. Run `npm run build`, then `npm start`. |
| `listen EADDRINUSE: address already in use 127.0.0.1:5173` | Something else already uses port 5173 (another copy, or a Vite app). Stop it, or pick another port and open that one instead, e.g. http://localhost:5180/timelens/:<br>PowerShell: `$env:PORT=5180; npm start`<br>Command Prompt: `set PORT=5180&& npm start`<br>macOS / Linux: `PORT=5180 npm start` |
| `npm.ps1 cannot be loaded because running scripts is disabled on this system` (Windows PowerShell) | Use Command Prompt instead, or type `npm.cmd` in place of `npm`, or allow scripts once with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. |
| `node` or `npm` "is not recognized" / "command not found" | Install Node.js LTS, then open a **new** terminal. |
| `npm run build && npm start` fails with "The token '&&' is not a valid statement separator" | Older Windows PowerShell has no `&&`. Run the two commands one after the other. |
| The page opens but images never arrive | The server needs internet access to NASA's AWS bucket (`nasa-irsa-spherex.s3.amazonaws.com`). Some school or office networks block it, so try another network. If NASA's IRSA search is down, that's fine: the app falls back to its built-in sky index. |

### Other commands

```bash
node scripts/warm.mjs          # pre-load the five challenge targets (server must be running)
npm run dev                    # rebuild on save and restart the server
npm run index                  # rebuild/refresh the local sky index (see "How the data flows")
npm run typecheck
```

Links reproduce a view exactly and can be embedded:

```
http://localhost:5173/?ra=133.7600&dec=-7.2422&fov=6&mode=combine&colours=six
http://localhost:5173/?q=Barnard's%20Star&embed=1      (no header or side panel, for iframes)
```

## TimeLens (second frontend)

Start the server as in [Run it on your computer](#run-it-on-your-computer), then open **http://localhost:5173/timelens/**. The original app stays at `/`.

TimeLens is a redesigned interface on the same server and the same verified image code.
- Four workspaces: Sky (deepest stack), Time (blink, play, every exposure, side by side, difference), Spectrum (spectrum with error bars and a light curve), and Movers (finder, Gaia check, review status, CSV/JSON).
- A time ruler that compresses the months between visits.
- Zoom and pan that keep SPHEREx pixels as exact squares.
- Shareable URLs that also carry the compared visits and the zoom.

Code is in `timelens/src`; the design record is in `timelens/DESIGN.md`.

It loads every image for a view through **`POST /api/cutouts`**, one streamed request, instead of one request per image.
A browser opens only six connections to one server, so per-image requests left the server mostly idle.
The batch lets it make 32 cutouts at once. Records are byte-identical to `/api/cutout`, checked on 12 of Barnard's Star's 359.
It waits for slow connections to drain rather than piling up images in memory, and refuses oversized requests with 413.

**QA, 2026-11-10** (headless Chrome, scripted; every check tests an effect, not just a click): 129 of 129 pass.
- **Features:** 62 checks.
- **Server under hostile input:** 16 checks. Path traversal, malformed JSON and encodings, oversized bodies and unknown ids all fail safely.
- **Races, failures and accessibility:** 25 checks.
  - Switching target mid-load; a late Gaia answer for the old target is ignored.
  - Some or all images failing, with a working "Try again".
  - The batch endpoint missing, so images load one by one.
  - Storage blocked, reduced motion, nonsense URL parameters.
  - Keyboard only: every control reachable, a visible focus ring everywhere; the drawer and tour manage focus.
- **Screen sizes:** 26 checks, from a 320 px phone to 2560 px at 200 %. Nothing too wide, no overlapping controls, and pixels stay exact squares.

## What it does

| Challenge ask | In the tool |
|---|---|
| Enter RA/Dec, see a time-lapse | Search box takes names or coordinates (decimal, `08h55m10.8s -07d14m42s`, `08:55:10.8 -07:14:42`). **Visits** blinks one stacked image per SPHEREx visit; **Every exposure** plays all frames. |
| Use the 102 bands creatively; add up each detector for S/N | **Colours**: all combined, **six bands side by side** (each detector stacked separately), **false colour** (short λ blue → long λ red, so cold brown dwarfs look red), or any single band. Stacks are sigma-clipped means in noise units. |
| Spectra on the fly | Click anywhere: aperture photometry on every exposure gives flux vs wavelength (one line per visit). **Brightness over time** gives a per-band light curve for variables. |
| Add / subtract images from different times | **Combine**: any visit minus or plus any other. Movers show as orange/blue pairs. |
| Choose the field of view | 2′ to 30′; larger fields cost more download. |
| Overlay Gaia / WISE | Gaia DR3 (moved to each image's date with its proper motion; arrows for fast movers) and CatWISE2020. |
| Coordinates in the URL, embeddable | `?ra=&dec=` or `?q=`, plus `fov`, `mode`, `colours`, `embed=1`; "Copy embed code" button. |
| Metadata such as contamination flags | **Bad pixels** overlay and a per-point flag list, decoded from SPHEREx's FLAGS extension (cosmic ray, saturated, hot pixel, persistent charge, …). Exposure time, detector, wavelength ± bandwidth, release, file link. |
| Astropy / Aladin | The FITS, TAN-SIP and spectral-WCS handling follows the FITS/Astropy conventions (re-implemented in TypeScript to stay dependency-free). The **sky map** uses Aladin Lite (CDS) with ESA's HiPS mirror. |
| Make it easy to spot movers | **Find moving things** measures every star's position in each visit and flags motion beyond the noise. It also flags objects seen in only one visit (possible asteroids). Each find is cross-checked against Gaia: "known mover", "Gaia says it doesn't move, probably glare", or "**not in Gaia: worth a closer look**". On Barnard's Star it reports 10.5″/yr north (Gaia: 10.39″/yr); on Epsilon Indi B, 4.8″/yr south-east (Gaia: 4.68″/yr). |
| Easy for the public | A one-line caption says what the image is. A first-visit "What am I looking at?" card explains it, and a 7-step guided tour covers the controls. Images are smooth by default (sharp pixels under **More**). The welcome page shows animated mini time-lapses of the five targets. |

## How the data flows

```
browser (Preact, canvas)  ──►  Node server  ──►  IRSA TAP (which files cover this spot?)   fast path
                                     │      └──►  local sky index (data/index)            fallback
                                     └──►  NASA's AWS bucket s3://nasa-irsa-spherex  (byte-range reads)
```

1. **Find:** ask IRSA's TAP service which spectral images contain the position. If IRSA is
   unreachable (it was, from our network, for hours), use the **local sky index**. That is
   one pointing per observation for all 101,080 observations (151 weeks, QR2 + QR3), built by
   `npm run index` from the bucket's own file listing plus a ~1 KB header read per observation
   (about 11 MB on disk).
2. **Confirm:** read each exposure's precise TAN-SIP header (~10 KB range read) to find
   the target's pixel and time. Detectors 4–6 see the same sky as 1–3 through a dichroic.
   Busy fields near the ecliptic poles (over 400 exposures) are sampled to 400, spread over time.
3. **Cut out:** read only the needed pixels, one HTTP range per detector row (~300 bytes
   each instead of a 72 MB file). Resample to a common north-up grid at the native 6.15″
   pixel size with Lanczos-3 (keeps the images sharp; blank detector edges stay blank).
   The viewer draws every SPHEREx pixel as an exact square of whole screen pixels, also
   on displays scaled to 125 % or 150 %. *Smooth display* (under More) is optional.
4. **Wavelength:** each file's `WCS-WAVE` table (9×9 to 13×20 grid, different per
   detector) gives λ and Δλ at the target pixel.

### Gotchas we hit (worth knowing)

- **Header layout is not fixed:** within a pipeline version, some files carry 13 extra
  cards before the WCS. In QR3 the header length varies, so the pixel data starts at
  byte 25,920 in some files and 28,800 in others. The reader finds cards by name and
  computes each file's data offset from its END card.
- **A week can be split over several processing folders.** 42 of 151 weeks are, either by
  detector (2025W17_4B: detector 1 in `l2b-v20-2025-241`, detectors 2–6 in `-240`) or by
  batches of observations (2025W50_1A: 108, 218 and 407 observations in three folders;
  QR3 has `l2b_retry-…` folders). Reading only the newest folder lost ~17,000 observations.
  A week is now the union of its folders, and each file is read from the newest one that has it.
- **Observation numbers do not always start at 1**, so the index comes from the bucket
  listing (keys grouped by `_` after the observation number: ~40 KB per detector folder),
  never from guessing numbers.
- **Twin detectors are registered to within 24 px** (1,135 pairs measured: median 11 px), so
  a target just off a short-wave detector can still be on its long-wave twin; both are checked.
- **Some weeks hold only some detectors.** The folder list records which detectors each
  processing folder has.
- **SPHEREx's filters change wavelength across each detector**, so consecutive
  exposures of one spot are different colours. That is why the default view stacks
  whole visits instead of blinking raw frames.
- **Pixels are 6.15″.** Barnard's Star moves ~1.7 px/yr, which is visible in *Combine*
  as an orange/blue pair.
- **Name lookups ignore case:** "eps Ind B" resolves to the planet "eps Ind b".
  Epsilon Indi B is looked up by its 2MASS name instead.
- **WISE 0855−0714** passes ~8″ from a G = 16 background star in 2026. Its spectrum shows
  the star at short wavelengths and the brown dwarf's rise at 4–5 µm.

## Project layout

```
server/src/   server.ts (HTTP API) · finder.ts (find frames) · skyindex.ts (sky index)
              cutout.ts (range-read cutouts) · layout.ts (FITS byte layout) · wcs.ts (TAN-SIP)
              catalog.ts (Gaia/WISE) · resolve.ts (names, proper motions) · net.ts (S3, retries)
web/src/      main.tsx (app, URL state) · Workspace.tsx (modes, player, viewer, export)
              scene.ts (panels + overlays) · render.ts (stacking, colour maps, photometry)
              Details.tsx (spectrum, flags, data, share) · SkyMap.tsx (Aladin) · gif.ts
data/         index/ (sky index) · cache/ (headers, cutouts, catalogues) · layouts.json, wave.json
scripts/      build.mjs · warm.mjs
```

## Verified so far

Checked on 2026-11-06 in headless Chrome on a Windows laptop with a slow (~0.1–2 MB/s) connection:

**Data**
- Sky index: 151 weeks, 101,080 observations. Four weeks counted independently from the AWS
  listing (2025W50_1A, 2025W41_2B, 2026W14_1A, 2026W36_2A) match the index exactly.
- IRSA's search and the AWS-only index find the same exposures: WISE 0855 256 = 256,
  RW Aurigae 331 = 331, Epsilon Indi B 445 + 2, M101 368 + 1. The extras are real exposures
  where the target sits 4.6–5.1 px inside a detector edge, which IRSA's footprints leave out.
- Raw pixels match IRSA's own cutout service bit for bit: 24 files from 24 different
  processing folders (QR2 v20, v24; QR3 v27), all six detectors, 1,176 pixels, 0 differences.

**Every control** (scripted, each with a check that it really did its job)
- Barnard's Star at 100 % and 125 % display scaling (64/64 checks); Epsilon Indi B at 150 %
  (59/59): play/pause, next/previous, wrap-around, arrow keys, space bar, every speed (frame rate
  measured), all 9 colour options in *Visits*, all 7 in *Every exposure* (exposure counts match the
  server's per detector; wavelengths inside each band), every visit pair × minus/plus in *Combine*
  (a visit minus itself is exactly zero), Target ring, Gaia, WISE, Find moving things, I spotted
  something → candidate → CSV and JSON, Save GIF (one frame per visit), Save video, every field
  size 2′–30′, Contrast, Bad pixels (flags for every exposure), Smooth display, shareable URL.
- Pixels are exact squares of whole screen pixels at every field size and scaling; Smooth display
  blends them and switching it off restores them.
- All five challenge targets, a fresh position (M101), an unknown name, Vega, the tour and the
  390 px phone layout: 84/84. Mover finder: Barnard's Star 10.3″/yr north (Gaia 10.39″/yr),
  Epsilon Indi B 4.7″/yr south-east (Gaia 4.68″/yr); nothing reported for the other three.

**Speed:** a 4′ field of an already-warmed target opens at once. A new 20′ or 30′ field means
re-cutting every exposure: about 6 and 9 minutes for Barnard's Star (359 exposures) on this
connection; the viewer shows images as they arrive, with a time-left estimate.

Not yet checked:
- Safari / Firefox
- real phones (only the 390 px layout in desktop Chrome)
- a deployed server
- screen readers

## Data credits

SPHEREx data: NASA/JPL-Caltech, served by NASA/IPAC IRSA and the AWS Open Data programme.
Name lookups: MAST (STScI) → SIMBAD/NED. Gaia DR3: ESA/Gaia/DPAC (via IRSA or ESA).
CatWISE2020: Marocco et al. 2021 (via IRSA). Sky map: Aladin Lite (CDS, Strasbourg) with ESA
HiPS (skies.esac.esa.int).

# Decisions

Append-only. Newest at the bottom.

## 2026-11-14: Read each week from one release (DR1 > QR3 > QR2)
- **Why:** NASA released DR1 (reprocessed first year) and QR3 re-did 2026 weeks 20–29, so many weeks exist two or three times. IRSA's search now lists only DR1 and QR3, which made v1 lose a year of data (WISE 0855 showed 0 images).
- **How:** weeks with an indexed best release come from the sky index; other weeks come from IRSA; if IRSA fails, from the best indexed release.
- **Rejected:** taking every release (duplicated exposures); trusting IRSA alone (it is slow and omits QR2-only history when unreachable).

## 2026-11-14: Never cache an empty search result
- **Why:** an archive hiccup was cached for good and hid WISE 0855's data.
- **Rejected:** a short expiry time (more moving parts for the same effect).

## 2026-11-14: v1 treats compressed DR1/QR3 FLAGS as "no flag information"
- **Why:** v1 read the RICE-compressed bytes as flags, which also made stacking drop good pixels. Real decoding comes with the v2 backend (Astropy decompresses it).
- **Rejected:** writing a RICE decoder in the v1 TypeScript server (v1 is being replaced).

## 2026-11-14: v2 stack is React + TypeScript + Vite + Tailwind + shadcn/ui, with a Python FastAPI backend
- **Why:** the maintainer's choice, matching the project brief; Python gives Astropy, Photutils and Reproject directly.
- **How:** built alongside v1 on its own ports; v1 stays live until v2 reaches parity.
- **Rejected:** keeping Node + Preact and adding Three.js only (recommended in Phase 0 for keeping verified code; declined by the maintainer).

## 2026-11-14: Landing is a scroll-guided tour, then free look
- **Why:** the brief asks for scroll-controlled discovery of the five targets; the maintainer's mockup shows drag-to-look and scroll-to-zoom. A "Skip to explorer" control is always visible.
- **Rejected:** free look only; tour only.

## 2026-11-14: For the deadline, the all-sky view goes into v1 with Aladin Lite
- **Why:** the maintainer asked for a result within 30 minutes; the full rewrite takes days. Aladin Lite (already in v1) maps HiPS tiles onto the sphere correctly, so no custom renderer is needed.
- **Notes:** Aladin opens a cube on its blank middle frame and its `setSliceNumber` round-trips through two different scales, so frames are chosen through an inverse mapping (verified per button).
- **Rejected for now:** the custom Three.js panorama (v2 Phase 2).

## 2026-11-14: Project memory files added
- `CLAUDE.md`, `PRODUCT.md`, `DESIGN.md`, `docs/DECISIONS.md`, `docs/PROGRESS.md`, plus `docs/RESEARCH.md` and `docs/PLAN.md`.

## 2026-11-15: Aqsa's build (FastAPI `backend/` + React JSX `frontend/`) is the project
- **Why:** it was far ahead (phases 2–10: search, cutouts, overlays, spectra, movers) and passed its tests. The maintainer chose it.
- **How:** merged from github.com/Aqsa-asif45/sphereX-timelapse; v1 (`server/`, `web/`, `timelens/`), the `app/` scaffold and the phase-1 backend modules removed (all in git history). Two uncommitted v1 edits were saved as a patch outside the repo.
- **Rejected:** keeping both generations side by side (two frontends, port clash on 5173, a `pytest.ini` that overrode the backend's test settings).

## 2026-11-15: Exact pixel-overlap resampling instead of Lanczos-3
- **Why:** SPHEREx stars are about one pixel wide, so Lanczos-3 rang: −300…−876σ next to bright stars where NASA's data under it was about −1σ. These showed as black specks.
- **How:** fields up to 10′: `reproject_exact` (~20 ms per image); larger: area mean of 4 × 4 sub-samples per pixel (~60 ms at 30′; 8–18× faster). Blank if the pixel centre is blank or under half of it is real data. Checked on real files: no value darker than the data; median difference from `reproject_exact` ~0σ.
- **Rejected:** Lanczos (rings); nearest pixel (shifts stars up to ½ pixel, ruins blinking); `reproject_exact` everywhere (0.6 s per image at 30′).

## 2026-11-15: Impossible pixels (more than 5σ below the local sky) are blank
- **Why:** the remaining black specks were NASA's own bad pixels (down to −1129σ). 80 of 86 checked carry NASA's flags NONFUNC, COLD, TRANSIENT or SUR_ERROR. Sky light can't be far below the sky (zodiacal light is not subtracted).
- **Rejected:** reading the FLAGS layer for every image (about 3× more AWS requests, so much slower loading). The FLAGS layer is still shown on request (Bad pixels).

## 2026-11-15: 24 parallel AWS connections instead of 64
- **Why:** measured on a cold search: 64 connections gave 789 retries and 207 failed reads (763 s); 24 gave 2 retries and none failed (76 s).
- **Also measured:** reading whole rows beats one small read per row (10 vs 2 blocks/s): AWS limits requests per second, not bytes.

## 2026-11-15: Smaller speed and correctness fixes
- IRSA reachability is checked on the SIA2 service itself (the home page took 9 s while SIA2 took 1 s). Answers from the offline index are reused for 1 hour only.
- Flags and noise layers load only when Bad pixels is on (default view about 4× faster); `app.cli warm` pre-builds exactly that view.
- A pass longer than 60 days is cut into ~30-day steps (R Draconis: 2 visits → 17), in the frontend and in the previews.
- Previews build one at a time and are served with `no-cache`, so a rebuilt one is never hidden by the browser cache.

## 2026-11-15: Gaia DR3 and CatWISE2020 from NOIRLab Astro Data Lab first
- **Why:** IRSA's catalogue services answered 502 and ESA's Gaia archive could not be reached from our network, so both overlays said "unavailable". Data Lab answered in 6–10 s and returned Gaia DR3's exact proper motion for Barnard's Star; its CatWISE columns and units (arcsec/yr) match IRSA's.
- **How:** Gaia: Data Lab → ESA → IRSA. CatWISE: Data Lab → IRSA. Shorter timeouts (connect 8 s) so a dead service fails fast. Answers are cached on disk per field.

## 2026-11-15: Saturated star cores drawn as saturated, not as holes
- **Why:** NASA blanks a bright star's core when it is too bright to measure (Barnard: up to 150 of 358 exposures). Drawn in the gap colour, the core looked like a black hole in the star, and "Smooth" made it a dark blob with a ring.
- **How:** display only (`saturatedCores` in `render.js`): a blank pixel whose real neighbours are all bright is drawn in the brightest colour. The data stay blank and are never measured. Blanks in ordinary sky keep the gap colour.

## 2026-11-15: Big fields fill the viewer
- **Why:** whole-number zoom kept pixels exactly square but drew a 30′ field (293 px) 1:1 in a 528 px frame.
- **How:** whole device pixels per SPHEREx pixel where there is room for at least 3; below that, a fractional fit that fills the frame.

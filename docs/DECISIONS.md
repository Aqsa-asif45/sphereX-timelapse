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

## 2026-11-15: Home redesign decisions (plan: [HOME_REDESIGN_PLAN.md](HOME_REDESIGN_PLAN.md))
- **Hero backdrop:** a real SPHEREx DR1 all-sky image (2.1 µm), split by brightness into depth layers made only of real pixels, drifting slowly and moving with the cursor, labelled as SPHEREx data. *Why:* real data, about 300 KB on phones, Home usable within 3 s (NF-1). *Rejected:* the live Aladin globe as backdrop (2.4 MB on the first screen); a Three.js sky (out of scope until parity, SRS 2.7).
- **New route `/start`:** "Start your experience" leads to a features page with the search, whole-sky globe, live Barnard's Star preview, the five target cards and deep links into Explore's modes. *Why:* the Back button works and the page can be shared. *Affects:* SRS 3.1 and 8.2 (7 pages instead of 6); SH-2 to SH-6 are checked on `/start`. *Rejected:* a panel hidden inside Home.
- **Search stays in the hero** (compact, under the Start button) and is the first card on `/start`, so typing a name works from the first screen (SH-2, SR-5).
- **The whole-sky globe is a slide on `/start`,** loaded only when it is reached (SH-3).
- **SRS 8.7 "Never animate the sky image itself" applies to the science viewer.** The home backdrop is decoration made from real data and may drift (transform and opacity only); it stands still with "reduce motion" (NF-11) and is never used for measurements (science rule 6).
- **Old viewer links `/?embed=1&q=...` redirect to `/embed?q=...`** (part of EX-6).

## 2026-11-20: Nova's intro (cutscenes after the splash)
- **What:** Nova, an original space-trooper mascot drawn and animated in code (`frontend/src/components/intro/`), visits the five challenge targets in 7 short scenes (launch, the five targets, "Your turn" → `/start`). Each target scene shows its real SPHEREx preview in Nova's scanner, labelled as real data; Nova and the ship are labelled as illustration.
- **When:** after the splash on a first visit to Home (`timelens.introSeen` in local storage), never for "reduce motion"; "Watch Nova's intro" on Home replays it. Skip, Esc, Back/Next, arrow keys, Pause; plays by itself at 6.5 s per scene.
- **Science:** the story says two targets are brown dwarfs, not stars; WISE 0855 is "roughly as cold as a winter day on Earth" (estimates span about −25 °C to +10 °C, so not "colder than ice"); the last line says finds are evidence, not discoveries.
- **Background (changed 2026-11-20):** a decorative canvas starfield (drifting, twinkling, a warp jump between targets) instead of the SPHEREx all-sky map, so drawn stars never sit on top of real data; the intro says the stars are illustrations. Scenes unfold in stages (fade in 1.2 s, Nova, words, scanner) and last 8 s. Still with "reduce motion".
- **Rejected:** illustrations from a designer (none available); playing it every session (35 s each time is too long).

## 2026-11-20: Galaxy zoom before /start
- **What:** "Start your experience" (Home) and "Start exploring" (end of Nova's intro) play a 2.3 s zoom into a spiral galaxy drawn in code (`GalaxyZoom.jsx`), then open `/start`. A click, Esc, Enter or Space goes straight on; "reduce motion" skips it; Ctrl/Shift/middle clicks still open the link normally.
- **Science:** the galaxy is an illustration, not SPHEREx data, and is labelled "Illustration" on screen.

## 2026-11-20: Home backdrop gaps and framing
- **Gaps:** NASA's masked holes (very bright stars) are now transparent with a soft ~2 px edge in the faint layer (`app.cli backdrop`, rebuilt from IRSA's DR1 HiPS), so they show as "no data" over the page background instead of hard black bars. Nothing is filled in. The on-page label says "dark gaps: no data"; the full description is on hover.
- **Framing:** chosen on the real hole mask. Phones show a window with no holes; portrait tablets the window with one small hole; screens from 1024 px zoom 1.25× with the galactic centre (where most holes are) behind the dark text side. One soft disc near the Large Magellanic Cloud stays visible on wide screens: it cannot be framed out without losing the Milky Way band.
- **Rejected:** painting over the holes (invents data); a CSS blur to calm the grain (made the sky look soft).

## 2026-11-20: A 3D nebula replaces the real map as the default backdrop (reverses the 2026-11-15 backdrop choice)
- **What:** a Three.js nebula (`lib/nebula.js`, `components/scene/`): soft gas clouds at many depths and ~3,200 stars, a slow drift forward, cursor depth on fine pointers, one scene kept across the splash, Home and `/start`. "Start your experience" flies the camera through it (`FlyThrough.jsx`); without WebGL or in real-sky mode the 2D galaxy zoom is used instead.
- **Real data kept:** a switch on Home ("Illustration · Real SPHEREx sky", remembered on this device) brings back the SPHEREx all-sky map with its "for looking only" label. The nebula is labelled "an illustration, not SPHEREx data". Real SPHEREx images remain on `/start` (globe, previews) and everywhere in Explore.
- **Cost:** Three.js 0.186.1 (pinned) loads in its own file after first paint: 133 KB compressed with the scene. A painted gradient in the same colours shows first and stays without WebGL. "Reduce motion": one still frame, no fly-through.
- **Note:** the SRS puts Three.js after parity (2.7, Q5); added now at the maintainer's request.
- **Rejected:** a spiral galaxy or Milky Way panorama (the team chose nebula clouds); a 2D canvas version (the team chose real 3D).

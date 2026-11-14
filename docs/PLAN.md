# SPHEREx TimeLens: phase plan

Built in phases on top of the running app. Each phase ends with checks, a real-browser run and your approval before the next starts. Research behind this plan: [RESEARCH.md](RESEARCH.md).

## 1. Audit of what exists (2026-11-14)

**Stack:** Node 20 + TypeScript server (no framework), Preact frontends bundled by esbuild, no database. Two frontends on one server: the original viewer at `/` and TimeLens at `/timelens/`.

**Works (verified today):**
- Finds every exposure of a position, from NASA's AWS bucket (own sky index of 101,080 observations) plus IRSA; aligned Lanczos-3 cutouts; one-request batch loading.
- TimeLens: landing page; Sky, Time, Spectrum and Movers workspaces; blink, play, every exposure, side by side, difference; time ruler; inspector; guided tour; shareable URLs; mover finder with Gaia check; CSV/JSON export.
- Data checks against Astropy and archives: target pixel ≤ 0.004 px, raw pixels bit-identical, times exact, wavelengths exact, Gaia overlay identical to ESA, target positions within 0.6 px of Gaia/CatWISE.
- Server API: 73/73 tests (hostile input, traversal, oversized bodies, load).

**Fixed today:** DR1 was ignored; IRSA searches lost all of QR2's year; empty search results were cached for good (WISE 0855 showed nothing); a search with no position started a search at RA 0, Dec 0; typographic minus signs in coordinates.

**Still broken:** DR1/QR3 data-quality flags (compressed, read as raw bytes); status check blocks during the daily folder refresh; upstream failures reported as 400.

**Missing compared with the brief:** 3D all-sky panorama and any SPHEREx HiPS; SIA2 access; DR1 cube use; reverse catalogue lookup and name suggestions; VARIANCE-based uncertainties; weighted co-addition; PSF-based detection; CWAVE/CBAND wavelengths; typed events and Web Workers; performance instrumentation; automated tests in the repo (Vitest, Playwright, pytest); deployment; WISE comparison, MOST, NEOSSat/CADC.

## 2. Architecture

**Decided 2026-11-14 (maintainer):** v2 is React + TypeScript + Vite + Tailwind + shadcn/ui with a Python FastAPI backend, built alongside v1. v1 (Node + Preact) stays live until v2 reaches parity, and v2 never edits v1 files.

```
Browser: React app (app/)
 ├─ Landing: 3D SPHEREx sky (Three.js, lazy-loaded) ── HiPS PNG tiles ── IRSA (CORS *)
 ├─ Workspace: viewer (WebGL), timeline, inspector, spectrum, movers
 │     └─ Web Workers: stacking, difference + σ, photometry
 ├─ Sky map tab: Aladin Lite + SPHEREx HiPS cube
 ├─ Zustand (app state) + TanStack Query (server state) + typed event bus (TARGET_SELECTED … EXPORT_COMPLETED)
 └─ AbortController on every request
        │  HTTP + Server-Sent Events (progress)
FastAPI backend (backend/), async
 ├─ release adapters: IRSA SIA2 (fast) · IRSA TAP (no lag) · AWS listing/index (complete) → one release per week
 ├─ FITS with Astropy: headers, TAN-SIP, spectral WCS without SIP, RICE_1 FLAGS + MSKN bit names, VARIANCE, ePSF
 ├─ cutouts: AWS byte ranges or IRSA cutout service; caches; request de-duplication
 ├─ science: Photutils (detection, photometry), Reproject (registration), uncertainty propagation
 └─ catalogue proxy: Gaia DR3, CatWISE, SIMBAD (or mirror), MAST, MOST
Tests: pytest (+ FastAPI TestClient) with Astropy cross-checks; Vitest + Testing Library; Playwright in a real browser
```

Defaults:
- **v1 → v2 parity list:** search, aligned cutouts, batch loading, blink/play/exposures/side-by-side/difference, spectrum, movers with Gaia check, exports, shareable URLs, tour. Each is ported and re-verified before v1 is retired.
- **Panorama:** our own HEALPix tile renderer in Three.js (inside of the sky sphere, real perspective look-around), starting from the order-3 Allsky image (~1 MB) and refining to order-5 tiles in view. Validated by checking that Gaia stars land on SPHEREx point sources. Aladin Lite stays for the workspace sky map.
- **Colour:** false colour from three real SPHEREx wavelengths, plus a slider over all 102 layers; labelled as visualisation.
- **Clearer imaging:** move the image viewer to WebGL. Stretch (linear, asinh, log), contrast and colour maps run on the GPU; pixels stay exact squares; optional smooth Lanczos display.

## 3. Phases

| Phase | Builds | Acceptance (shown in the browser) |
|---|---|---|
| **0** Audit + research | This plan, RESEARCH.md, baseline checks | You approve the plan |
| **1** Real data proof (v2 foundations) | Scaffold `backend/` (FastAPI, venv, pytest) and `app/` (Vite, React, TS, Tailwind, shadcn/ui, Zustand, TanStack Query, Vitest, ESLint); SIA2 adapter with TAP fallback and full provenance (release, collection, observation ID, version, processing date, URL, retrieval time); real cutout via IRSA's cutout service; FITS parsing with Astropy incl. decompressed FLAGS + `MSKN` names and VARIANCE; sky WCS and spectral WCS; WebGL display with stretch controls; typed events + SSE progress | One real DR1 and one QR3 exposure displayed in the React app, with flags, provenance and numbers matching an independent Astropy check |
| **2** 3D all-sky panorama | Three.js HEALPix renderer from the SPHEREx HiPS cube; progressive tiles; drag/zoom; compass; wavelength slider; five target markers with halo, label, classification, verified RA/Dec, coverage; fly-to; scroll-guided tour with "Skip to explorer"; reduced-motion and low-bandwidth modes; Gaia alignment test | Real SPHEREx sky, targets at correct positions, provenance visible |
| **3** Search + explorer | Name suggestions; coordinate validation; reverse cone search (SIMBAD or mirror, Gaia, CatWISE) with separations and "No known catalogue counterpart…"; field of view; release and date filters; timeline with loop and speed; inspector with release, detector, wavelength, flags, variance; shareable URLs | Coordinate → objects → observations flow works for all five targets and a random position |
| **4** Image comparison | Blink, side by side (synced zoom/pan, independent contrast), difference D = I₂ − I₁ with σ_D = √(σ₁² + σ₂²) from VARIANCE, quality masks, background matching; weighted co-addition listing contributing exposures; brightness measurements with errors | Difference and co-add maps with uncertainty, checked against Astropy |
| **5** Spectral explorer | Spectrum per click with errors; CWAVE/CBAND wavelengths; band/channel controls; 102-layer cube browsing in the sky map; link to IRSA's spectrophotometry tool; CSV/ECSV export | Spectrum of a known star matches the IRSA tool within stated errors |
| **6** Detection + candidates | PSF/ePSF-based detection, cross-epoch matching, motion rates with errors, light curves, candidate overlays with evidence; significance separate from any "AI" score; no discovery claims | Barnard's Star and ε Indi B motions vs Gaia; R Dra and RW Aur variability |
| **7** Integrations + performance | Gaia (parallax, epoch propagation), WISE comparison with instrument caveats, MOST check for Solar System objects, optional NEOSSat/CADC layer; caching, prefetch, low-bandwidth mode; accessibility; measured timings | Measured numbers, no invented benchmarks |
| **8** Final integration | All five targets end to end, deployment, public URL check, screenshots, citations, docs | Production URL reviewed in the browser |

## 4. Coverage of the brief

| Brief section | Where |
|---|---|
| 01 Roles | All phases (science checks, design, performance, QA in each) |
| 02 Phase protocol | Every phase: report → tests → run → browser → review → pause |
| 03 Research | Phase 0 (RESEARCH.md), updated as phases verify more |
| 04 DR1 cube vs time series | Phase 2 (HiPS panorama), Phase 5 (cube spectra, labelled visual), Phases 1/3/4 (MEFs for time) |
| 05 3D panorama, scroll, targets | Phase 2 |
| 06 Search, reverse lookup, WISE 0855 coordinates | Phase 3 (coordinates verified with Astropy in Phase 0) |
| 07 Retrieval engine, adapters, SIA2 lag | Phase 1 |
| 08 FITS structure and units | Phase 1, Phase 4 |
| 09 Workspace layout | Phase 3 |
| 10 Blink, side by side, difference, co-add | Phase 4 |
| 11 Motion and brightness | Phase 6 |
| 12 Spectral explorer | Phase 5 |
| 13 Gaia, WISE, Aladin, NEOSSat, MOST | Phases 2, 5, 7 |
| 14 Typed events, cancellation, streaming, workers | Phases 1 (server), 3–4 (client) |
| 15 Stack | Section 2 (React + Tailwind + shadcn/ui, FastAPI; Three.js for 3D) |
| 16 Performance | Phases 2, 7 |
| 17 Testing | Phase 1 sets up suites; every phase extends them |
| 18 Phases | Section 3 |
| 19 Design quality | Phase 2 direction approval; vibedevw checklist and impeccable audit each UI phase |
| 20 Non-negotiable rules | Enforced as review checks every phase |
| 21 First action | Phase 0 (this document) |

## 5. Risks

- **SIMBAD unreachable from this network today:** reverse lookup may need a mirror or a server-side proxy elsewhere.
- **Three.js HEALPix renderer:** new code. It needs the Gaia alignment test before markers can be trusted.
- **Aladin cube frame switching is undocumented:** test before relying on it.
- **IRSA TAP is slow:** use SIA2 for speed, TAP only as no-lag backup.
- **Rewrite scope:** v2 must re-earn everything v1 already verified; the hackathon deadline (15 Nov 2026) falls before v2 can reach parity, so v1 remains the submittable version until then.
- **Installs:** Python packages (FastAPI, Astropy, Photutils, Reproject, astropy-healpix, pytest) and npm packages go on drive D: (project venv and `app/node_modules`); the permission system may ask for approval.
- **Three.js adds download size:** roughly 170 KB compressed (to be measured), so it is loaded only for the landing panorama.

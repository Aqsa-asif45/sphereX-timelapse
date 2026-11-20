# Progress

Current state, rewritten each session. Last update: 2026-11-15.

## Done
- **One app:** Aqsa's build (FastAPI `backend/` + React `frontend/`) merged and kept, including her home redesign (sky hero, glass navbar, `/start`) and the new Details panel; v1 and the `app/` scaffold removed (in git history).
- **Overlays:** Gaia DR3 and CatWISE2020 from NOIRLab Data Lab first (IRSA down, ESA unreachable), then ESA/IRSA.
- **Display:** saturated star cores drawn as saturated; big fields (20′–30′) fill the viewer; home-page "for looking only" backdrop label restored.
- **Images:** exact pixel-overlap resampling (no more ringing); NASA's dead/cold/cosmic-ray pixels blanked; R Draconis split into 17 time steps instead of 2.
- **Speed:** 24 AWS connections (cold search 763 s → 76 s); flags/noise only with Bad pixels (default view ~4× faster); IRSA check uses SIA2; previews one at a time, `no-cache`; the 5 targets pre-built with `app.cli warm`.

## Verified (2026-11-15)
- Backend 68/68 offline tests, ruff clean; frontend 97/98 tests (see known issues), lint, build.
- Against NASA's original files with Astropy (20 exposures, 5 targets, DR1 + QR3, 6 detectors): target pixel ≤ 0.0007 px, wavelength ≤ 0.005 nm, time exact, raw pixels/flags/variance identical.
- Search lists identical to IRSA SIA2 for Barnard, ε Indi B, WISE 0855, RW Aur (R Dra capped at 400 exposures by design).
- Browser (Chromium): targets open in 3–6 s after `warm`; no sideways scroll at 390/768/1024/1440 px.

## Next
- Commit the merge (maintainer's call), then push.
- Spectra: ePSF photometry on detector pixels (aperture currently counts 7–12 whole pixels: 5–27% error for moving stars).
- Overlays: exact gnomonic `gridOffset` (up to 1.7 px off at 30′ near the poles).
- Wavelength-matched differences (same band can differ by up to 627 nm between visits).

## Known issues
- Frontend test "opens Home" fails under Node 20: a dependency calls `Map.groupBy` (Node 21+, Chrome 117+). The app works in current browsers; older Safari (< 17.4) not checked.
- New field sizes load slowly the first time (10′ ~1 min, 30′ ~4 min for 358 images); `app.cli warm --fov N` pre-builds them.
- IRSA SIA2 was returning 502 errors on 2026-11-15; searches then use the offline index (works, slower; reused 1 h).
- The server answers slowly during a cold search (CPU work starves the event loop).
- The hover hint box covers the bottom of the image and the scale bar.
- `DESIGN.md` and `docs/PLAN.md` still describe the old v2 plan (TypeScript, `app/`).
- Not tested: real phones, Safari/Firefox, screen readers, deployment, Gaia overlay (ESA unreachable from here).

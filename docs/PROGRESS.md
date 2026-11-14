# Progress

Current state, rewritten each session. Last update: 2026-11-14.

## Done
- **v1 (live, Node + Preact):** DR1 support and one-release-per-week search; empty results no longer cached; missing position rejected; typographic minus accepted; compressed DR1/QR3 flags treated as "no flag info" instead of garbage.
- **v1 landing: the whole SPHEREx sky.** NASA's DR1 all-sky HiPS on a draggable Aladin Lite globe, four wavelength buttons (1.1, 2.1, 3.3, 4.6 µm), the five targets marked and clickable (fly to, then open their images).
- **v2 Phase 1 preview (React + FastAPI, port 8010):** SIA2 search with TAP fill-in and full provenance; real IRSA cutouts read with Astropy (decompressed flags with the file's own names, variance, sky and spectral WCS); WebGL viewer with stretch, range, colour map and flag overlay; progressive results over SSE; typed events.
- Docs: RESEARCH.md, PLAN.md, DECISIONS.md, CLAUDE.md, PRODUCT.md, DESIGN.md.

## Verified
- Backend tests: 29/29 (incl. DR1 and QR3 cutouts identical to NASA's original files: pixels, flags, target pixel, wavelength, time, units).
- Frontend: typecheck, lint, 14/14 tests, build. Browser (Chromium): v2 at 390/768/1024/1440, no sideways scroll; v1 sky globe renders real SPHEREx tiles; each wavelength button fetches its intended cube frame; target buttons open the explorer.
- v1 server API suite 73/73; data cross-checks vs Astropy, Gaia (ESA) and CatWISE.

## Next
- v2 Phases 2–8 (PLAN.md), paused after the 15 Nov hackathon deadline; v1 is the submission.
- Commit and push today's work (not committed yet).

## Known issues
- Sky globe: on first load Aladin briefly requests its default (blank) cube frame, giving a few harmless 404s in the console.
- v2: the "Skip to the image" link has no visible focus ring; IRSA's SIA2 is intermittently slow (TAP fill-in covers it).
- Not tested: real phones, Safari/Firefox, screen readers, deployment.

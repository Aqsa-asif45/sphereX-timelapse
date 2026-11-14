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

# SPHEREx TimeLens

NASA Space Apps 2026, challenge "Planet X and SPHEREx": a public web tool that shows how the infrared sky changes over time, using real NASA SPHEREx data, so anyone can spot things that move or change.

Read `docs/PROGRESS.md` (current state) before working. Science rules: `docs/SCIENCE_RULES.md`. Archive facts: `docs/RESEARCH.md`. Decisions: `docs/DECISIONS.md`.

## Stack

| Part | Folder | Built with |
|---|---|---|
| Backend (API) | `backend/` | Python 3.11+, FastAPI, Uvicorn, httpx, Astropy, NumPy, reproject, Pillow |
| Frontend | `frontend/` | React 19 (JSX), Vite, Tailwind CSS 4, React Router, TanStack Query, Zustand, Motion; Canvas + Web Worker |

Data: IRSA SIA2 (search) → TAP (backup) → local sky index `backend/data/index/` (offline backup); pixels by byte-range reads from NASA's AWS copy; cache in `backend/data/cache/` (git-ignored).

## Run

```
backend:  python -m venv backend/.venv ; backend/.venv/Scripts/pip install -r backend/requirements-dev.txt
          cd backend ; .venv/Scripts/python -m uvicorn app.main:app --port 8000
frontend: cd frontend ; npm install ; npm run dev        # http://localhost:5173, forwards /api to 8000
warm:     cd backend ; .venv/Scripts/python -m app.cli warm   # pre-build the 5 targets before a demo
```

## Test

- Backend: `backend/.venv/Scripts/python -m pytest backend/tests -m "not network"` (live tests: `-m network`, slow ones `-m slow`).
- Lint: `backend/.venv/Scripts/python -m ruff check backend/app`.
- Frontend (in `frontend/`): `npm test`, `npm run lint`, `npm run build`.
- UI changes end with a real-browser check (Playwright Chromium) at 390, 768, 1024 and 1440 px.

## Science rules (non-negotiable)

- Real data only. No simulated, demo or stock imagery presented as SPHEREx. Blank pixels stay blank.
- Check every number independently (Astropy, or the archive's own service) before calling it correct. Show units.
- Use DR1 + QR3. Each week is read from one release only: DR1 > QR3 > QR2.
- Spectral WCS (alt key W): drop the celestial SIP terms before using it. WCS-WAVE is visual (~1 nm); CWAVE/CBAND for science.
- DR1/QR3 FLAGS are RICE_1 tile-compressed; bit names are in `MSKNnnnn` header cards.
- HiPS PNGs and the all-sky cube are for visualisation and overview, never for time-domain comparison or measurements.
- Brown dwarfs (WISE 0855, Epsilon Indi B) are not stars and are not in Gaia: say so.
- Candidates are evidence, never discoveries.
- Changing how cutouts are made: bump `CUTOUT_VERSION` (and `previews.VERSION`), then re-run `warm`.

## Working rules

- Phases: report → tests → run → browser → ask for approval → wait.
- No secrets are needed. Never commit `.env`; keep `.env.example` with placeholder names only.
- No personal details or absolute local paths in committed files.
- The maintainer pushes manually; do not commit unless asked.

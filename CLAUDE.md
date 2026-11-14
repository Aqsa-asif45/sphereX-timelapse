# SPHEREx TimeLens

NASA Space Apps 2026, challenge "Planet X and SPHEREx": a public web tool that shows how the infrared sky changes over time, using real NASA SPHEREx data, so anyone can spot things that move or change.

Read `docs/PROGRESS.md` (current state) and `docs/PLAN.md` (phases) before working. Research facts about the archive are in `docs/RESEARCH.md`; decisions in `docs/DECISIONS.md`.

## Two generations, side by side

| | v1 (live, verified) | v2 (being built, phase by phase) |
|---|---|---|
| Backend | Node 20 + TypeScript, no framework (`server/src`) | Python 3.13 + FastAPI (`backend/`) |
| Frontend | Preact + esbuild: original viewer (`web/`, at `/`) and TimeLens (`timelens/`, at `/timelens/`) | React + TypeScript + Vite + Tailwind + shadcn/ui (`app/`) |

v1 must keep working until v2 replaces it. v2 runs on its own ports and never edits v1 files.

## Run

v1:
```
npm install
npm run build
npm start            # http://localhost:5173 (PORT=… to change)
```

v2 (once scaffolded; see docs/PROGRESS.md for what exists):
```
backend:  python -m venv backend/.venv ; backend/.venv/Scripts/pip install -r backend/requirements.txt
          backend/.venv/Scripts/python -m uvicorn app.main:app --app-dir backend --port 8010
frontend: cd app ; npm install ; npm run dev     # http://localhost:5174, proxies /api to 8010
```

## Test

- v1: `npx tsc --noEmit -p .` and `npm run build`.
- v2 backend: `backend/.venv/Scripts/python -m pytest backend/tests` (network tests are marked `network`).
- v2 frontend: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` inside `app/`.
- Every phase ends with a real-browser check (Playwright Chromium) at 390, 768, 1024 and 1440 px.

## Science rules (non-negotiable)

- Real data only. No simulated, demo or stock imagery presented as SPHEREx. Blank pixels stay blank.
- Check every number independently (Astropy, or the archive's own service) before calling it correct. Show units.
- Use DR1 + QR3. Each week is read from one release only: DR1 > QR3 > QR2.
- Spectral WCS (alt key W): drop the celestial SIP terms before using it. WCS-WAVE is visual (~1 nm); CWAVE/CBAND for science.
- DR1/QR3 FLAGS are RICE_1 tile-compressed; bit names are in `MSKNnnnn` header cards.
- HiPS PNGs and the all-sky cube are for visualisation and overview, never for time-domain comparison or measurements.
- Brown dwarfs (WISE 0855, Epsilon Indi B) are not stars and are not in Gaia: say so.
- Candidates are evidence, never discoveries.

## Working rules

- Phases: report → tests → run → browser → ask for approval → wait.
- No secrets are needed. Never commit `.env`; keep `.env.example` with placeholder names only.
- No personal details or absolute local paths in committed files.
- The maintainer pushes manually; do not commit unless asked.

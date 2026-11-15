# SPHEREx TimeLens

Pick a spot in the sky and watch every NASA SPHEREx infrared image of it as a time-lapse, to see what moves
or changes. NASA Space Apps 2026, challenge "Planet X and SPHEREx".

- `frontend/`: React + Vite website (port 5173)
- `backend/`: Python FastAPI server (port 8000) that finds NASA's files and cuts out the images
- `docs/`: science rules, decisions, plans

**Both must be running.** The website gets every image, target card, search and preview from the backend.
With only the frontend running, the page opens but shows no images.

## Requirements

- Python 3.11 or newer
- Node.js 20 or newer
- An internet connection (images are read live from NASA's archive; no account or key is needed)

## First-time setup

From the project folder:

**Backend**

Windows:
```
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements-dev.txt
```

macOS / Linux:
```
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
```

**Frontend**
```
cd frontend
npm install
```

## Run (two terminals)

Terminal 1, backend (in `backend/`):
```
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000      # Windows
.venv/bin/python -m uvicorn app.main:app --reload --port 8000          # macOS / Linux
```

Terminal 2, frontend (in `frontend/`):
```
npm run dev
```

Open http://localhost:5173. Check the backend at http://localhost:8000/api/health (it should say `"ok": true`).
API docs: http://localhost:8000/api/docs.

## Make the five targets fast (recommended once, and before a demo)

A fresh clone has no cached images, so the first time a target opens it takes several minutes, and the
target cards on the home page show "Preview not built yet". This command fetches everything for the five
challenge targets and builds their preview animations (about half an hour the first time; run it with the
backend stopped or running, in `backend/`):
```
.venv\Scripts\python -m app.cli warm          # Windows
.venv/bin/python -m app.cli warm              # macOS / Linux
```
The cache lives in `backend/data/cache/` on each computer (it is not in git).

## Troubleshooting

| What you see | Cause and fix |
|---|---|
| No images, no target cards, red dot or "Cannot reach the TimeLens server" | The backend is not running, or not on port 8000. Start it (terminal 1) and refresh |
| Target cards say "Preview not built yet" | Normal on a fresh clone: the preview is being made. Wait a few minutes and refresh, or run the warm command |
| "Loading images: 30 of 458 · about 5 min left" | Normal the first time a target opens on your computer. The second time it is fast |
| `ModuleNotFoundError` when starting the backend | The packages are not installed in `.venv`: run the setup step again |
| Port 8000 or 5173 already in use | Another copy is running: close it, or start the backend with `--port 8001` and change `frontend/vite.config.js` to match |
| The sky globe on the home page stays blank | It loads straight from NASA (IRSA) and a public CDN; check the internet connection or a firewall |

## Tests

```
cd backend && .venv\Scripts\python -m pytest -m "not network"     # offline backend tests
cd frontend && npm test && npm run lint && npm run build
```
Network tests (live NASA, ESA and IRSA checks): `pytest -m network`.

## Rules

Read [docs/SCIENCE_RULES.md](docs/SCIENCE_RULES.md) before changing anything that shows or measures data:
real data only, blank pixels stay blank, every number checked against an independent source.

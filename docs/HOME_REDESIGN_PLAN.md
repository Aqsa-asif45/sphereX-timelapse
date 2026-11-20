# Home redesign: phase plan

A cleaner, more interactive first impression: a full-screen hero over the real SPHEREx sky with depth and
cursor movement, a glass navbar, one "Start your experience" button, and a features page that leads into
every part of TimeLens. Built on top of the finished Phases 0–10; it does not change Explore.

**Status:** all phases marked done: H0 (decisions) on 2026-11-15; H1–H5 built in commit fc9dd06 and refined after.

Phases are named H0–H5 so they do not clash with the SRS phases (11–14). Each ends like the SRS phases:
tests pass → run it → check in a real browser → team review → next phase.

## Decisions (agreed 2026-11-15)

All five were agreed by the team on 2026-11-15 and are recorded in [DECISIONS.md](DECISIONS.md).

| # | Question | Agreed answer |
|---|---|---|
| 1 | Hero backdrop | **Option A:** a real SPHEREx all-sky image, exported once from NASA's DR1 all-sky map, split into depth layers that drift slowly and move with the cursor. Not the live Aladin globe (2.4 MB on the first screen), not a Three.js sphere (out of scope until parity, SRS 2.7) |
| 2 | Where "Start your experience" goes | A new route **`/start`** (Back button works, the page can be shared), not a panel hidden inside Home |
| 3 | Search box | A compact search stays in the hero, under the Start button (so typing a name still works from the first screen) and is repeated as the first card on `/start` |
| 4 | Whole-sky globe | A slide on `/start`, loaded only when it is reached |
| 5 | SRS 8.7 "Never animate the sky image itself" | Holds for the science viewer. The home backdrop is decoration made from real data and may drift; record this in docs/DECISIONS.md |

## Rules the redesign must keep

- **Real data only (science rule 1):** the backdrop is the real SPHEREx sky, with a visible label such as "SPHEREx all-sky map, 2.1 µm (DR1)". No stock nebulae, no made-up stars passed off as SPHEREx.
- **HiPS for looking only (science rule 6):** the backdrop is never used for measurements.
- **Reduce motion (NF-11):** with "reduce motion" on, the backdrop stands still and the splash is skipped.
- **Speed (NF-1):** Home is usable within 3 s on an ordinary connection: a small poster image first, larger layers after.
- **Readable (NF-10):** a dark overlay under the text and navbar keeps contrast at 4.5:1 or more over bright parts of the sky.
- **Parity (SRS 1.3):** the Home features SH-2 to SH-7 and SR-5 move to `/start`; none is removed.

## Where today's Home features go

| Today on Home | SRS ID | After the redesign |
|---|---|---|
| Headline, intro, search with target suggestions | SH-2, SR-5 | Hero (name, 2–3 lines, Start button, compact search) |
| Live Barnard's Star preview | SH-2 | `/start` card "Watch a star move" |
| Whole-sky globe, 4 wavelengths, target markers, fly-to | SH-3 to SH-5 | `/start` slide "The whole sky" |
| 5 target cards with GIF previews and "Look for" chips | SH-6 | `/start` slide "The five targets" |
| Footer credits and Methods link | SH-7 | New footer |

## Routes after the redesign

| Path | Page | Change |
|---|---|---|
| `/` | Home (hero only) | Simplified |
| `/start` | Features menu | **New** |
| `/explore?...` | TimeLens workspace | Unchanged |
| `/about` | Methods | Unchanged |
| `/embed?...` | Embed view | Unchanged (filled in by SRS Phase 11) |
| `*` | Not found | Restyled to match |
| `/timelens`, `/timelens/explore`, `/timelens/about`, `/?q=...` | Redirects | Unchanged |
| `/?embed=1&q=...` | Redirect to `/embed?q=...` | **New** (old viewer's embed links currently open the full Explore page) |

---

## H0: Decisions and docs (½ day) · done 2026-11-15

- [x] Agree the five decisions above
- [x] docs/DECISIONS.md: the backdrop choice, the `/start` route, the SRS 8.7 note
- [x] Update the page list (7 pages) and the parity table (SH-2 to SH-6 now on `/start`): see "Routes after the redesign" and "Where today's Home features go" above

**Done when:** the team has signed off the decisions and the docs say where every Home feature lives.

## H1: The backdrop image (1 day)

- [x] Script `backend/app/cli.py backdrop` (or `scripts/`): render NASA's SPHEREx DR1 all-sky map at 2.1 µm from IRSA's HiPS into one wide image (Astropy + reproject, or the hips2fits service), plus the source, frame and date in a small JSON next to it
- [x] Depth layers from the real pixels only: a faint-sky layer and a bright-stars layer (split by brightness), so they can move at different speeds
- [x] WebP files for desktop (~2400 px) and phones (~1200 px), and a tiny blurred poster (< 20 KB) for the first paint
- [x] Files in `frontend/public/backdrop/`; check the total stays near 300 KB on phones

**Done when:** the layers stacked back together match the source map (no invented pixels), and the files are within size.

## H2: Glass navbar and footer (½ day)

- [x] TopBar: see-through with background blur over the hero and `/start`; solid on Explore, Methods and Embed (where the image must stay the brightest thing)
- [x] Logo, Explore, Methods, server status dot; a menu button on phones; the visible focus ring and skip link stay
- [x] Footer: slimmer and cleaner; keeps every data credit and the Methods link (SH-7)

**Done when:** the navbar reads clearly over the brightest part of the backdrop (4.5:1), works by keyboard, and nothing scrolls sideways at 320–2560 px.

## H3: Hero and splash (1 day)

- [x] `SkyBackdrop` component: layers drift slowly; the cursor shifts them by different amounts for depth (a few degrees of tilt, not a fly-through); on phones, a slow drift only (no motion-sensor permission prompts)
- [x] Moves only with transform and opacity (SRS 8.7); pauses when the tab is hidden; stands still with "reduce motion"
- [x] Hero: the name, 2–3 introductory lines, **Start your experience** (to `/start`), a compact search, and the backdrop's data label
- [x] Splash: restyled to fade into the hero over the same backdrop; still once per session, skippable, skipped with "reduce motion"

**Done when:** Home is usable within 3 s with 1 MB/s throttling, the backdrop is smooth (no dropped frames on a mid-range laptop), and SH-1, SH-2 and SR-5 pass.

## H4: The `/start` features page (1 day)

- [x] Route `/start` and its page title
- [x] A carousel or grid of large cards (arrow keys, swipe on phones, visible "1 of 7"), each a deep link:
  1. Search any spot (search box with the five target suggestions)
  2. The whole sky (the Aladin globe, loaded when the slide is reached; 4 wavelengths, colour or grey, target markers)
  3. Watch a star move (`/explore?q=Barnard's Star&view=blink`, with the live preview)
  4. Read a spectrum (`/explore?q=R Draconis&mode=spectrum`)
  5. Hunt for movers (`/explore?q=Epsilon Indi B&mode=movers`)
  6. The five targets (the GIF cards with "Look for" chips)
  7. How it works (`/about`)
- [x] Redirect `/?embed=1&q=...` to `/embed?q=...`
- [x] Move the existing SkyGlobe, TargetCards and TargetPreview components here (no rewrite)

**Done when:** every card opens the right view, SH-3 to SH-6 pass on `/start`, and the carousel works by keyboard and touch.

## H5: Polish and checks (½–1 day)

- [x] Playwright/browser run at 320, 390, 768, 1024, 1440 and 2560 px: no sideways scroll, no overlap
- [x] Keyboard-only run; focus visible everywhere; Esc and arrow keys in the carousel
- [x] "Reduce motion" on: backdrop still, splash skipped, carousel without animation
- [x] Contrast check on the navbar, hero text and cards
- [x] Update `home.test.jsx` and the App route tests for `/start` and the new redirect
- [x] Explore, Methods and Embed unchanged (Phases 6–10 still pass)

**Done when:** all of the above pass and the team approves the look.

---

**Total:** about 4–5 days (H0 ½, H1 1, H2 ½, H3 1, H4 1, H5 ½–1). A true 3D Three.js sky (option C) would add 3–4 days and an alignment check that stars land in the right place; leave it until after parity.

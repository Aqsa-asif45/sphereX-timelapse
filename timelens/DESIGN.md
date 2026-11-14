# SPHEREx TimeLens: design record

TimeLens is the second frontend for this project, served at `/timelens/` by the same Node server.
The original app at `/` is unchanged. TimeLens reuses the original app's verified image code
(`web/src/render.ts`, `scene.ts`, `astro.ts`, `movers.ts`, `api.ts`, `gif.ts`, `SkyMap.tsx`) and adds a new interface on top.

## Visual thesis: "night-shift instrument"

The sky image is the only bright thing on screen. Everything else is quiet ink with hairline rules.
Colour carries meaning and nothing else:

| Colour | Means |
|---|---|
| Amber `#ffb84d` | time, the later visit (A), the target ring, primary actions |
| Blue `#6ec3ff` | the earlier visit (B) |
| Orange / blue in Difference | brighter in A / brighter in B (same as the A/B pins) |
| Blue → violet → pink → amber | a visit's date in charts (earliest → latest) |
| Wavelength ramp (violet → red) | wavelength only: timeline ticks, band series |
| Cyan `#5fd4e3` | focus rings, links, selected controls |
| Pink arrows | auto-found movers (drawn by the original renderer) |

Status is never colour alone: every chip has words.

## Tokens (`src/styles.css :root`)

- Surfaces: `--bg #07090e` · `--bg-2 #0b0f16` · `--panel #0f141c` · `--raised #151c27` · `--hover #1b2431`
- Lines: `--line #1f2835` (decorative), `--line-2 #2a3546`, `--ctl #5b6b82` (control borders, ≥3:1 on every surface)
- Text: `--text #edf1f6`, `--text-2 #a9b4c3`, `--text-3 #8592a5` (muted, ≥4.5:1 on every surface)
- Type: IBM Plex Sans (interface), IBM Plex Mono (coordinates, dates, measurements; tabular figures)

## Layout

- **Landing**: one sentence, one search, a real animated SPHEREx preview, five challenge targets with a "Look for" hint, how it works, and "honest by design".
- **Workspace** (`/timelens/explore`):
  - Stage bar, two rows. Row one shows the target and coverage, plus Details. Row two has the modes (Sky · Time · Spectrum · Movers) and the view settings (colours, display, field).
  - One viewer that never remounts. Zoom is in whole device pixels per SPHEREx pixel, so pixels stay exact squares at any display scaling. Pan and zoom survive every change of visit, band or mode.
  - A dock under the viewer that changes with the mode: the time ruler and compare views, the spectrum lab, or the candidate table.
  - An inspector that is a side panel from 1200 px up, a drawer below that, and a bottom sheet on phones. It starts closed below 1440 px wide so the image gets the room.
- **Methods** (`/timelens/about`): every processing step, how to read each view, the limits, and credits.

## Rules the interface keeps

- First view: blink the earliest and latest visits, because neighbouring visits are days apart and show no motion.
- The time ruler shows real dates. Long gaps become labelled breaks, and each tick is a real exposure.
- A spectrum point is one exposure with its error bar, and links back to that exposure and its file. No smooth curves; light-curve lines never cross months that have no data.
- Molecule markers say "would absorb here", never "detected".
- "Not in Gaia" is described as "worth a closer look", never "new". Review status is stored on this device only, and the interface says so.
- Nothing is invented: blank pixels stay blank, and there are no demo data and no interpolated frames.
- Everything that defines a view is in the URL: target, field, mode, view, A/B, colours and zoom.
- Failures are said out loud: if images fail, the viewer says how many and offers "Try again", and it never shows a silent blank frame. If quality flags fail, the Details panel says so.
- An answer belongs to the view that asked for it: catalogue and mover results that arrive after the target or field changed are dropped.
- Below 1200 px the Details drawer takes focus when it opens, closes with Esc, and gives focus back. The tour keeps Tab inside its card.

# Design system

Shared by v1 TimeLens and v2. v1's full record is in `timelens/DESIGN.md`; this file extends it for v2 and records what is still open.

## Thesis: "night-shift instrument"

The sky is the only bright thing on screen. Everything else is quiet ink with hairline rules. Colour carries meaning and nothing else, and status is never colour alone: every chip has words.

## Tokens (carried over from v1, to become the Tailwind theme)

| Role | Value |
|---|---|
| Background | `#07090e` · `#0b0f16` (bg-2) |
| Surfaces | panel `#0f141c` · raised `#151c27` · hover `#1b2431` |
| Lines | decorative `#1f2835` · `#2a3546` · control borders `#5b6b82` (≥ 3:1 on every surface) |
| Text | `#edf1f6` · secondary `#a9b4c3` · muted `#8592a5` (≥ 4.5:1 on every surface) |
| Time / later visit A / primary action | amber `#ffb84d` |
| Earlier visit B | blue `#6ec3ff` |
| Focus, links, selected controls | cyan `#5fd4e3` |
| Wavelength | violet → red ramp, used only for wavelength |
| Type | IBM Plex Sans (interface) · IBM Plex Mono (coordinates, dates, measurements; tabular figures) |

Spacing: a 4 px base (4, 8, 12, 16, 24, 32, 48, 64). Radius 6 px for controls, 10 px for panels.

## Decided for v2

- shadcn/ui (Radix underneath) for dialogs, menus, drawers, tabs and forms, themed with the tokens above.
- Image viewer pixels stay exact squares at every zoom and display scaling; a smooth (Lanczos) display is opt-in.
- Motion only with a purpose; everything honours `prefers-reduced-motion`.
- No NASA insignia or logo. Credit lines name NASA/JPL-Caltech/IPAC as data sources.

## Open (decided in Phase 2, with options shown first)

- The panorama's look: false-colour wavelengths, labels, marker halo, compass, and how the brief's "restrained cyan and violet accents" sit alongside v1's amber time colour.
- The landing's scroll choreography: tour stops, pacing, and the hand-off to free look.

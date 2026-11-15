# Decisions

Choices that change or add to the SRS, newest first. Each says what was decided, why, and what it affects.

## 2026-11-15 · Home redesign (plan: [HOME_REDESIGN_PLAN.md](HOME_REDESIGN_PLAN.md))

1. **Hero backdrop: real SPHEREx sky with parallax layers.** A wide image exported once from NASA's SPHEREx DR1
   all-sky map (2.1 µm), split by brightness into depth layers made only of real pixels, drifting slowly and
   moving with the cursor. Labelled as SPHEREx data on screen.
   *Why:* real data, about 300 KB on phones, smooth everywhere, keeps Home usable within 3 s (NF-1). The live
   Aladin globe (2.4 MB) is too heavy for the first screen; a Three.js sky is out of scope until parity (SRS 2.7).

2. **New route `/start`: the features page.** "Start your experience" leads there. It holds the search, the
   whole-sky globe, the live Barnard's Star preview, the five target cards and deep links into Explore's modes.
   *Why:* the Back button works and the page can be shared. *Affects:* SRS 3.1 and 8.2 (7 pages instead of 6);
   SH-2 to SH-6 are checked on `/start` instead of `/`.

3. **Search stays in the hero** (compact, under the Start button) and is repeated as the first card on `/start`.
   *Why:* typing a name must still work from the first screen (SH-2, SR-5).

4. **The whole-sky globe is a slide on `/start`,** loaded only when it is reached (SH-3 lazy loading kept).

5. **SRS 8.7 "Never animate the sky image itself" applies to the science viewer.** The home backdrop is
   decoration made from real data and may drift (transform and opacity only), and stands still with
   "reduce motion" (NF-11). It is never used for measurements (science rule 6).

Also added with the redesign: old viewer links `/?embed=1&q=...` redirect to `/embed?q=...` (part of EX-6).

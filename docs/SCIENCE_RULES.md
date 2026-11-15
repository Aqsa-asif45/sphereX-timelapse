# Science rules

These rules make SPHEREx TimeLens trustworthy. Every phase is reviewed against them.

1. **Real data only.** No simulated, demo or stock images shown as SPHEREx. Blank pixels stay blank. No made-up frames between visits.
2. **Check every number** against an independent source (Astropy or NASA's own service) before calling it correct. Always show units.
3. **One release per week:** DR1, else QR3, else QR2. Never count an exposure twice.
4. **Wavelength:** use the spectral WCS (key W) with the sky's SIP terms removed. WCS-WAVE is display accuracy (~1 nm).
5. **Flags:** DR1/QR3 FLAGS are RICE_1 compressed; read bit names from the file's `MSKNnnnn` cards.
6. **All-sky pictures (HiPS) are for looking only**, never for time comparison or measurement.
7. **Brown dwarfs** (WISE 0855, Epsilon Indi B) are not stars and are not in Gaia: say so on screen.
8. **Candidates are evidence, never discoveries.** "Not in Gaia" means "worth a closer look", never "new".
9. **Photometry limit:** the 1.6-pixel aperture has no aperture correction, so it is not total flux. Say so on the Methods page.
10. **Molecule markers** say "would absorb here", never "detected".

## Numbers the new build must match

Use these as test cases. The new app must give the same answers as the old one.

| Check | Expected |
| --- | --- |
| Barnard's Star motion (mover finder) | About 10.3–10.5″/yr north (Gaia: 10.39″/yr) |
| Epsilon Indi B motion | About 4.7–4.8″/yr south-east (Gaia: 4.68″/yr) |
| Other three targets | No movers reported |
| WISE 0855 exposures found | 256 (old site, IRSA and index agree) |
| RW Aurigae exposures found | 331 |
| Raw pixels vs IRSA's cutout service | 0 differences |
| Target pixel vs Astropy | Within 0.004 px |
| Gaia overlay vs ESA archive | Identical rows |
| A visit minus itself | Exactly zero |
| 1 MJy/sr over one pixel | 888.996 µJy |

Exposure counts can grow as NASA adds data, so compare against the old site run on the same day.
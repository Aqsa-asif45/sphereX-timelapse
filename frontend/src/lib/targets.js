/**
 * Home-page facts about the five challenge targets.
 * SKY positions are where TimeLens searches each target (moving ones at their end-2025 positions, as
 * SPHEREx sees them), checked on the old site. Names, kinds and blurbs come from the backend's /api/targets.
 */

export const SKY_TARGETS = [
  { slug: 'barnard', name: "Barnard's Star", kind: 'Red dwarf star', ra: 269.44627, dec: 4.7682 },
  { slug: 'eps-indi-b', name: 'Epsilon Indi B', kind: 'Brown dwarf pair', ra: 331.09644, dec: -56.80116 },
  { slug: 'wise-0855', name: 'WISE 0855−0714', kind: 'Coldest known brown dwarf', ra: 133.76003, dec: -7.24223 },
  { slug: 'rw-aur', name: 'RW Aurigae', kind: 'Young variable star', ra: 76.95653, dec: 30.40144 },
  { slug: 'r-dra', name: 'R Draconis', kind: 'Pulsating red giant', ra: 248.16761, dec: 66.75498 },
]

export const LOOK_FOR = {
  barnard: {
    what: 'Motion',
    hint: 'The fastest-moving star in the sky shifts about 1.7 SPHEREx pixels a year. Blink the first and last visit.',
  },
  'eps-indi-b': {
    what: 'Motion',
    hint: 'A pair of brown dwarfs moving about 4.7″ a year, close to the bright star Epsilon Indi A.',
  },
  'wise-0855': {
    what: 'Motion',
    hint: 'The coldest brown dwarf known. Very faint: if it shows at all, look in the longest-wavelength bands.',
  },
  'rw-aur': {
    what: 'Brightness',
    hint: 'A young star that dims and brightens unpredictably. Compare its brightness between visits.',
  },
  'r-dra': {
    what: 'Brightness',
    hint: 'A pulsating giant that brightens and fades over about 8 months.',
  },
}

/** Format a position for people: RA 269.4463° · Dec +4.7682° */
export const fmtRaDec = (ra, dec) => `RA ${ra.toFixed(4)}° · Dec ${dec >= 0 ? '+' : '−'}${Math.abs(dec).toFixed(4)}°`

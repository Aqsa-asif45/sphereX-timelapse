/**
 * NASA's SPHEREx DR1 all-sky HiPS cube shown in Aladin Lite (CDS). Aladin maps the HEALPix tiles onto the
 * sphere correctly; nothing here alters pixel values. These pictures are for looking only (science rule 6).
 *
 * Colour: each cube frame is ONE infrared wavelength (brightness only), so any colour is a colour map,
 * not true colour.
 */

export const ALADIN_URL = 'https://cdn.jsdelivr.net/npm/aladin-lite@3.9.2-beta/dist/aladin.js'
export const SPHEREX_HIPS = 'https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube'

/**
 * Aladin shares one layer object between layers with the same address, so each viewer gets its own
 * spelling of the same URL ("./" segments the browser removes before fetching: same tiles, same cache).
 */
let spelling = 0
const hipsUrl = () => SPHEREX_HIPS.replace('/SPHEREx/', '/SPHEREx/' + './'.repeat(spelling++))

/** Cube frames (0-based) and their wavelengths, from the HiPS `data_cube_crval3_arr` property. */
export const FRAMES = [
  { i: 16, um: 1.1 },
  { i: 44, um: 2.1 },
  { i: 62, um: 3.3 },
  { i: 90, um: 4.6 },
]

/**
 * Aladin's setSliceNumber(n) turns n into a wavelength linearly (em_min..em_max) but back into a tile
 * frame linearly in frequency; this inverts that round trip so frame k is what gets fetched
 * (checked in the browser on the old site).
 */
const EM_MIN = 7.43e-7
const EM_MAX = 5.009e-6
const DEPTH = 102
export function sliceFor(k) {
  const s = (k + 0.5) / DEPTH
  const lambda = 1 / (s * (1 / EM_MIN - 1 / EM_MAX) + 1 / EM_MAX)
  return ((lambda - EM_MIN) / (EM_MAX - EM_MIN)) * DEPTH
}

let lib = null
/** Load Aladin Lite once (about 2.4 MB), only when the globe scrolls into view. */
export function aladinLib() {
  lib ??= import(/* @vite-ignore */ ALADIN_URL).then(async (m) => {
    await m.default.init
    return m.default
  })
  return lib
}

export function createSky(A, el, { fov, target, interactive }) {
  return A.aladin(el, {
    survey: hipsUrl(),
    projection: 'SIN',
    cooFrame: 'ICRS',
    fov,
    target,
    pixelateCanvas: false,
    showReticle: false,
    showLayersControl: false,
    showGotoControl: false,
    showFullscreenControl: false,
    showSimbadPointerControl: false,
    showShareControl: false,
    showFrame: false,
    showCooGrid: false,
    showProjectionControl: false,
    showCooGridControl: false,
    showContextMenu: false,
    showCooLocation: false,
    showFov: false,
    showZoomControl: interactive,
    log: false,
    backgroundColor: 'rgb(7,9,14)',
  })
}

/** Run fn on a layer once Aladin has added it (setSliceNumber only acts on an added layer). */
function whenAdded(layer, fn) {
  let tries = 0
  const go = () => {
    if (layer?.added) fn(layer)
    else if (++tries < 150) setTimeout(go, 80)
  }
  go()
}

/** Show one wavelength in colour ('inferno') or grey. Colour map first, then frame, so the frame sticks. */
export function setSkyMode(view, frame, colour) {
  whenAdded(view.getBaseImageLayer(), (l) => {
    l.setColormap(colour ? 'inferno' : 'grayscale', { stretch: 'linear' })
    l.setSliceNumber(sliceFor(frame))
  })
}

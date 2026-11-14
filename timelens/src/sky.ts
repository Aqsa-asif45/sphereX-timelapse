/**
 * NASA's SPHEREx DR1 all-sky HiPS cube in Aladin Lite (CDS), shared by the interactive globe and the
 * page backdrop. Aladin maps the HEALPix tiles onto the sphere correctly; nothing here alters pixel values.
 *
 * Colour: each cube frame is ONE infrared wavelength (greyscale brightness), so colour is false colour by
 * construction: 1.1 µm → blue, 2.1 µm → green, 4.6 µm → red, added together (as astronomers make RGB images).
 */
export const ALADIN = 'https://cdn.jsdelivr.net/npm/aladin-lite@3.9.2-beta/dist/aladin.js';
export const SPHEREX_HIPS = 'https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube';

/**
 * Aladin shares one layer object between layers with the same address, so every layer (blue/green/red, in the
 * globe and in the backdrop) gets its own spelling of the same URL: "./" segments, which the browser removes
 * before fetching, so the same tiles are loaded (and shared by the HTTP cache).
 */
let spelling = 0;
const hipsUrl = () => SPHEREX_HIPS.replace('/SPHEREx/', '/SPHEREx/' + './'.repeat(spelling++));

/** Cube frames (0-based) → wavelength, from the HiPS `data_cube_crval3_arr` property (frames 50–51 are blank). */
export const FRAMES = [
  { i: 16, um: 1.102 }, { i: 44, um: 2.089 }, { i: 62, um: 3.293 }, { i: 90, um: 4.6 },
];

/**
 * Aladin's setSliceNumber(n) turns n into a wavelength linearly (em_min…em_max) but back into a tile frame
 * linearly in frequency; this inverts that round trip so frame k is what gets fetched (checked in the browser).
 */
const EM_MIN = 7.43e-7, EM_MAX = 5.009e-6, DEPTH = 102;
export function sliceFor(k: number): number {
  const s = (k + 0.5) / DEPTH;
  const lambda = 1 / (s * (1 / EM_MIN - 1 / EM_MAX) + 1 / EM_MAX);
  return ((lambda - EM_MIN) / (EM_MAX - EM_MIN)) * DEPTH;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
let lib: Promise<Any> | null = null;
export const aladinLib = () => (lib ??= import(/* @vite-ignore */ ALADIN).then(async (m) => { await m.default.init; return m.default; }));

/** Run fn on a layer once Aladin has added it (setSliceNumber only acts on an added layer). */
function whenAdded(layer: Any, fn: (l: Any) => void) {
  let tries = 0;
  const go = () => { if (layer?.added) fn(layer); else if (++tries < 150) setTimeout(go, 80); };
  go();
}

export function createSky(A: Any, el: HTMLElement, opts: { fov: number; target: string; interactive: boolean }): Any {
  return A.aladin(el, {
    survey: hipsUrl(), projection: 'SIN', cooFrame: 'ICRS', fov: opts.fov, target: opts.target,
    pixelateCanvas: false, // smooth scaling instead of blocky pixels
    showReticle: false, showLayersControl: false, showGotoControl: false, showFullscreenControl: false, showSimbadPointerControl: false,
    showShareControl: false, showFrame: false, showCooGrid: false, showProjectionControl: false, showCooGridControl: false,
    showContextMenu: false, showCooLocation: false, showFov: false, showZoomControl: opts.interactive,
    log: false, backgroundColor: 'rgb(7,9,14)',
  });
}

/**
 * Show one wavelength, coloured by brightness with a colour map ('inferno', as in the TimeLens viewer) or in
 * grey. The colour map is applied first and the frame chosen after, so a colour change cannot reset the frame.
 * (A three-layer blue/green/red blend of the cube proved unreliable in this Aladin version.)
 */
export function setSkyMode(v: Any, frame: number, colour: boolean) {
  whenAdded(v.getBaseImageLayer(), (l) => {
    l.setColormap(colour ? 'inferno' : 'grayscale', { stretch: 'linear' });
    l.setSliceNumber(sliceFor(frame));
  });
}

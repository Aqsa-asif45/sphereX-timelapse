/**
 * Viewer geometry. Sharp pixels: the zoom is always a whole number of DEVICE pixels per SPHEREx pixel and
 * the image is placed on whole device pixels, so every SPHEREx pixel is an exact square, also on displays
 * scaled to 125 % or 150 %.
 */

export const GAP = 3 // data pixels between panels of one scene (six bands)
export const SCENE_GAP = 4 // data pixels between side-by-side scenes
export const ZMAX = 16

export const gridOf = (count) => (count === 6 ? { cols: 3, rows: 2 } : { cols: 1, rows: 1 })

/** Size of one scene in data pixels. */
export function sceneSize(panelCount, n) {
  const { cols, rows } = gridOf(panelCount)
  return [cols * n + (cols - 1) * GAP, rows * n + (rows - 1) * GAP]
}

/**
 * @param {{ box: [number, number], dataW: number, dataH: number, dpr: number, zoom: number,
 *           centre?: {cx:number, cy:number} | null }} g
 * @returns {{ scale: number, devScale: number, fitDev: number, ox: number, oy: number }}
 *   scale = CSS px per SPHEREx pixel; (ox, oy) = where the data's top-left corner goes, in CSS px
 */
export function viewGeometry({ box, dataW, dataH, dpr, zoom, centre }) {
  const exact = Math.min((box[0] - 24) / dataW, (box[1] - 24) / dataH) * dpr
  // Whole device pixels per SPHEREx pixel keep every pixel an exact square. For big fields (under 3 device
  // pixels per SPHEREx pixel) that left the picture far smaller than the frame (30′: 293 px drawn 1:1 in a
  // 528 px frame), so there the fit is fractional: pixels may differ by one device pixel, but it fills the frame.
  const fitDev = exact >= 3 ? Math.floor(exact) : Math.max(1, exact)
  const z = fitDev * zoom
  const devScale = z >= 3 ? Math.round(z) : Math.max(1, z)
  const scale = devScale / dpr
  const cx = centre?.cx ?? dataW / 2
  const cy = centre?.cy ?? dataH / 2
  const ox = Math.round((box[0] / 2 - cx * scale) * dpr) / dpr
  const oy = Math.round((box[1] / 2 - cy * scale) * dpr) / dpr
  return { scale, devScale, fitDev, ox, oy }
}

/**
 * Which scene, panel and grid pixel is under a point of the viewer (CSS px from its top-left corner).
 * @returns {{scene:number, panel:number, gx:number, gy:number} | null}
 */
export function hitTest(mx, my, { ox, oy, scale }, dims, n) {
  let x0 = ox
  for (let k = 0; k < dims.length; k++) {
    const [w, h] = dims[k]
    const lx = (mx - x0) / scale
    const ly = (my - oy) / scale
    if (lx >= 0 && ly >= 0 && lx < w && ly < h) {
      const col = Math.floor(lx / (n + GAP))
      const row = Math.floor(ly / (n + GAP))
      const gx = Math.floor(lx - col * (n + GAP))
      const gy = Math.floor(ly - row * (n + GAP))
      if (gx >= n || gy >= n) return null // in the gap between panels
      const { cols } = gridOf(w > n ? 6 : 1)
      return { scene: k, panel: row * cols + col, gx, gy }
    }
    x0 += (w + SCENE_GAP) * scale
  }
  return null
}

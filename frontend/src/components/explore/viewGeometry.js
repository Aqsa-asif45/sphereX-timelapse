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
  const fitDev = Math.max(1, Math.floor(Math.min((box[0] - 24) / dataW, (box[1] - 24) / dataH) * dpr))
  const devScale = Math.max(1, Math.round(fitDev * zoom))
  const scale = devScale / dpr
  const cx = centre?.cx ?? dataW / 2
  const cy = centre?.cy ?? dataH / 2
  const ox = Math.round((box[0] / 2 - cx * scale) * dpr) / dpr
  const oy = Math.round((box[1] / 2 - cy * scale) * dpr) / dpr
  return { scale, devScale, fitDev, ox, oy }
}

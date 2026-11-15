import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { PIXEL_ARCSEC } from '../../lib/astro'
import { drawOverlays, paintBad } from '../../lib/overlays'
import { GAP as GAP_RGB, paintDiff, paintHeat, paintRgb, upscaleBicubic } from '../../lib/render'
import { GAP, SCENE_GAP, ZMAX, gridOf, hitTest, sceneSize, viewGeometry } from './viewGeometry'

const BG = [11, 14, 20]

const isTyping = (e) => {
  const t = e.target
  return t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))
}

/** Paint one scene's panels into an ImageData (one pixel per SPHEREx pixel). */
function paintScene(scene, n, contrast, stretch) {
  const { cols, rows } = gridOf(scene.panels.length)
  const Wd = cols * n + (cols - 1) * GAP
  const Hd = rows * n + (rows - 1) * GAP
  const im = new ImageData(Wd, Hd)
  for (let i = 0; i < im.data.length; i += 4) {
    im.data[i] = BG[0]
    im.data[i + 1] = BG[1]
    im.data[i + 2] = BG[2]
    im.data[i + 3] = 255
  }
  scene.panels.forEach((p, k) => {
    const off = Math.floor(k / cols) * (n + GAP) * Wd + (k % cols) * (n + GAP)
    if (p.kind === 'rgb' && p.rgb) paintRgb(im.data, off, p.rgb[0], p.rgb[1], p.rgb[2], n, Wd, contrast, stretch)
    else if (p.data) (p.kind === 'diff' ? paintDiff : paintHeat)(im.data, off, p.data, n, Wd, contrast, stretch)
    else {
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) im.data.set([...GAP_RGB, 255], (off + j * Wd + i) * 4)
    }
    if (p.bad) paintBad(im.data, off, p.bad, n, Wd)
  })
  return im
}

/** Smooth display: bicubic upscale (cached, so blinking and panning do not redo it). */
const smoothCache = []
function smoothCanvas(scene, im, k, contrast, stretch) {
  const refs = scene.panels.flatMap((p) => [p.data, p.rgb?.[0], p.rgb?.[1], p.rgb?.[2], p.bad])
  const hit = smoothCache.find(
    (c) => c.k === k && c.contrast === contrast && c.stretch === stretch && c.refs.length === refs.length && c.refs.every((r, i) => r === refs[i]),
  )
  if (hit) return hit.canvas
  const canvas = document.createElement('canvas')
  canvas.width = im.width * k
  canvas.height = im.height * k
  canvas.getContext('2d').putImageData(new ImageData(upscaleBicubic(im.data, im.width, im.height, k), im.width * k, im.height * k), 0, 0)
  smoothCache.unshift({ refs, k, contrast, stretch, canvas })
  if (smoothCache.length > 8) smoothCache.pop()
  return canvas
}

function drawScene(x, scene, n, scale, { contrast, stretch, smooth }) {
  const im = paintScene(scene, n, contrast, stretch)
  if (smooth) {
    const k = Math.min(8, Math.max(1, Math.ceil(scale * (window.devicePixelRatio || 1))))
    x.imageSmoothingEnabled = true
    x.imageSmoothingQuality = 'high'
    x.drawImage(smoothCanvas(scene, im, k, contrast, stretch), 0, 0, im.width * scale, im.height * scale)
  } else {
    const c = document.createElement('canvas')
    c.width = im.width
    c.height = im.height
    c.getContext('2d').putImageData(im, 0, 0)
    x.imageSmoothingEnabled = false // every SPHEREx pixel stays an exact square
    x.drawImage(c, 0, 0, im.width * scale, im.height * scale)
  }
  const { cols } = gridOf(scene.panels.length)
  if (scene.overlay) {
    // target ring and catalogue stars, clipped to each panel
    scene.panels.forEach((_, k) => {
      x.save()
      x.translate((k % cols) * (n + GAP) * scale, Math.floor(k / cols) * (n + GAP) * scale)
      x.beginPath()
      x.rect(0, 0, n * scale, n * scale)
      x.clip()
      drawOverlays(x, scene.overlay, n, scale)
      x.restore()
    })
  }
  x.font = '600 12px "IBM Plex Sans", sans-serif'
  scene.panels.forEach((p, k) => {
    const px = (k % cols) * (n + GAP) * scale
    const py = Math.floor(k / cols) * (n + GAP) * scale
    if (p.label) {
      const w = x.measureText(p.label).width
      x.fillStyle = 'rgba(11,14,20,.75)'
      x.fillRect(px + 6, py + 6, w + 12, 20)
      x.fillStyle = '#e8ecf3'
      x.fillText(p.label, px + 12, py + 20)
    }
    if (p.empty) {
      x.fillStyle = 'rgba(154,166,187,.9)'
      x.textAlign = 'center'
      x.fillText('no exposures in this band', px + (n * scale) / 2, py + (n * scale) / 2)
      x.textAlign = 'left'
    }
  })
  // compass (north up, east left) and a 1′ scale bar
  const W = im.width * scale
  const H = im.height * scale
  x.strokeStyle = x.fillStyle = 'rgba(232,236,243,.9)'
  x.lineWidth = 1.5
  const cx = W - 30
  const cy = H - 16
  x.beginPath()
  x.moveTo(cx, cy)
  x.lineTo(cx, cy - 20)
  x.moveTo(cx, cy)
  x.lineTo(cx - 20, cy)
  x.stroke()
  x.fillText('N', cx - 4, cy - 24)
  x.fillText('E', cx - 32, cy + 4)
  const one = (60 / PIXEL_ARCSEC) * scale
  if (one < W / 2) {
    x.beginPath()
    x.moveTo(10, H - 12)
    x.lineTo(10 + one, H - 12)
    x.stroke()
    x.fillText('1′', 10 + one / 2 - 5, H - 18)
  }
  if (scene.tag) {
    const w = x.measureText(scene.tag).width
    x.fillStyle = scene.tagColour ?? 'rgba(11,14,20,.8)'
    x.fillRect(6, H - 54, w + 14, 22)
    x.fillStyle = '#0b0f16'
    x.fillText(scene.tag, 13, H - 38)
  }
}

/**
 * The hover read-out. It keeps its own state, so moving the pointer re-renders only this line, not the
 * canvas. Its ref is the setter for the pixel under the pointer.
 */
function Readout({ ref, describe }) {
  const [hit, setHit] = useState(null)
  useImperativeHandle(ref, () => setHit, [])
  const body = hit ? describe?.(hit) : null
  return (
    <div
      className="pointer-events-none absolute bottom-2 left-1/2 max-w-[calc(100%-1rem)] -translate-x-1/2 rounded-ctl border border-line-2 bg-bg-2/90 px-2.5 py-1.5 font-mono text-[11px] leading-snug text-ink-2"
      aria-hidden="true"
      data-testid="readout"
    >
      {body ?? <span className="text-ink-3">Point at a pixel for its value, noise, flags, RA and Dec · scroll to zoom · drag to pan</span>}
    </div>
  )
}

/**
 * The sky viewer: one canvas that draws one scene, or two side by side, with zoom (1–16x; buttons, scroll
 * wheel, + − 0 keys) and drag-to-pan. Zoom and pan survive every change of visit, band or mode.
 * Each scene may carry an `overlay` (target ring, Gaia, WISE) and its panels a `bad` map (bad pixels).
 * `describe(hit)` returns the hover read-out for a pixel; `onPick(hit)` is called on a click (not a drag).
 * @param {{ n:number, scenes:Array, zoom:number, onZoom:(z:number)=>void, resetKey:string, contrast:number,
 *   stretch:string, smooth:boolean, alt:string, caption?:React.ReactNode, children?:React.ReactNode,
 *   describe?:(hit:{scene:number, panel:number, gx:number, gy:number}) => React.ReactNode }} p
 */
export default function Viewer(p) {
  const box = useRef(null)
  const cv = useRef(null)
  const [size, setSize] = useState([800, 520])
  const [centre, setCentre] = useState(null)
  const [lastReset, setLastReset] = useState(p.resetKey)
  const drag = useRef(null)
  const readout = useRef(null)
  if (lastReset !== p.resetKey) {
    setLastReset(p.resetKey) // a new target or field: centre the view again
    setCentre(null)
  }

  useLayoutEffect(() => {
    if (!box.current || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(([e]) => setSize([Math.max(1, e.contentRect.width), Math.max(1, e.contentRect.height)]))
    ro.observe(box.current)
    return () => ro.disconnect()
  }, [])

  const dims = p.scenes.map((s) => sceneSize(Math.max(1, s.panels.length), p.n))
  const dataW = Math.max(1, dims.reduce((a, d) => a + d[0], 0) + SCENE_GAP * Math.max(0, dims.length - 1))
  const dataH = Math.max(1, ...dims.map((d) => d[1]))
  const dpr = window.devicePixelRatio || 1
  const g = viewGeometry({ box: size, dataW, dataH, dpr, zoom: p.zoom, centre })
  const sceneX = (k) => dims.slice(0, k).reduce((a, d) => a + d[0] + SCENE_GAP, 0)

  useEffect(() => {
    const c = cv.current
    const x = c?.getContext?.('2d')
    if (!x || typeof ImageData === 'undefined') return
    const W = Math.round(size[0] * dpr)
    const H = Math.round(size[1] * dpr)
    if (c.width !== W || c.height !== H) {
      c.width = W
      c.height = H
    }
    x.setTransform(1, 0, 0, 1, 0, 0)
    x.clearRect(0, 0, W, H)
    p.scenes.forEach((s, k) => {
      x.setTransform(dpr, 0, 0, dpr, Math.round((g.ox + sceneX(k) * g.scale) * dpr), Math.round(g.oy * dpr))
      drawScene(x, s, p.n, g.scale, p)
    })
  })

  // latest geometry for the native wheel and key handlers (updated after each render)
  const geo = useRef(null)

  const zoomTo = (z, at) => {
    const s = geo.current
    const z2 = Math.min(ZMAX, Math.max(1, +z.toFixed(3)))
    if (z2 === 1) {
      setCentre(null)
      s.onZoom(1)
      return
    }
    const s2 = Math.max(1, Math.round(s.fitDev * z2)) / dpr
    const m = at ?? [s.size[0] / 2, s.size[1] / 2]
    const ptX = (m[0] - s.ox) / s.scale
    const ptY = (m[1] - s.oy) / s.scale
    const clamp = (v, hi) => Math.min(hi, Math.max(0, v))
    setCentre({ cx: clamp(ptX - (m[0] - s.size[0] / 2) / s2, s.dataW), cy: clamp(ptY - (m[1] - s.size[1] / 2) / s2, s.dataH) })
    s.onZoom(z2)
  }
  const zoomRef = useRef(null)
  useLayoutEffect(() => {
    geo.current = { ...g, dataW, dataH, size, zoom: p.zoom, onZoom: p.onZoom }
    zoomRef.current = zoomTo
  })

  useEffect(() => {
    const el = box.current
    if (!el) return undefined
    const wheel = (e) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomRef.current(geo.current.zoom * (e.deltaY < 0 ? 1.25 : 0.8), [e.clientX - r.left, e.clientY - r.top])
    }
    const key = (e) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === '+' || e.key === '=') zoomRef.current(geo.current.zoom * 1.5)
      else if (e.key === '-' || e.key === '_') zoomRef.current(geo.current.zoom / 1.5)
      else if (e.key === '0') zoomRef.current(1)
    }
    el.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('keydown', key)
    return () => {
      el.removeEventListener('wheel', wheel)
      window.removeEventListener('keydown', key)
    }
  }, [])

  const down = useRef(null) // where a press started, to tell a click (measure here) from a drag
  const onPointerDown = (e) => {
    if (e.target.closest?.('button')) return
    down.current = [e.clientX, e.clientY]
    if (p.zoom <= 1) return
    drag.current = { x: e.clientX, y: e.clientY, cx: centre?.cx ?? dataW / 2, cy: centre?.cy ?? dataH / 2 }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e) => {
    const d = drag.current
    if (!d) {
      const r = box.current.getBoundingClientRect()
      readout.current?.(hitTest(e.clientX - r.left, e.clientY - r.top, g, dims, p.n))
      return
    }
    setCentre({
      cx: Math.min(dataW, Math.max(0, d.cx - (e.clientX - d.x) / g.scale)),
      cy: Math.min(dataH, Math.max(0, d.cy - (e.clientY - d.y) / g.scale)),
    })
  }
  const endDrag = () => {
    drag.current = null
  }
  const onPointerUp = (e) => {
    const d = down.current
    down.current = null
    endDrag()
    if (!p.onPick || !d || Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 4) return
    const r = box.current.getBoundingClientRect()
    const h = hitTest(e.clientX - r.left, e.clientY - r.top, g, dims, p.n)
    if (h) p.onPick(h)
  }

  const btn = 'grid h-8 w-8 place-items-center rounded-ctl border border-ctl bg-bg-2/90 text-ink hover:bg-hover disabled:opacity-40'
  return (
    <figure className="flex min-h-0 flex-1 flex-col gap-2">
      <div
        ref={box}
        className={`relative min-h-[320px] flex-1 overflow-hidden rounded-panel border border-line bg-bg ${p.zoom > 1 ? 'cursor-grab active:cursor-grabbing' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={endDrag}
        onPointerLeave={() => readout.current?.(null)}
        data-testid="viewer"
      >
        <canvas
          ref={cv}
          role="img"
          aria-label={p.alt}
          className="absolute inset-0 h-full w-full"
          data-scale={g.devScale}
          data-dpr={dpr}
        />
        <div role="group" aria-label="Zoom" className="absolute top-2 right-2 flex flex-col gap-1">
          <button type="button" className={btn} aria-label="Zoom in (+)" title="Zoom in (+)" disabled={p.zoom >= ZMAX} onClick={() => zoomTo(p.zoom * 1.5)}>
            +
          </button>
          <button type="button" className={btn} aria-label="Zoom out (−)" title="Zoom out (−)" disabled={p.zoom <= 1} onClick={() => zoomTo(p.zoom / 1.5)}>
            −
          </button>
          <button type="button" className={`${btn} text-xs`} aria-label="Fit to view (0)" title="Fit to view (0)" onClick={() => zoomTo(1)}>
            Fit
          </button>
        </div>
        {p.describe && <Readout ref={readout} describe={p.describe} />}
        {p.children}
      </div>
      {p.caption && <figcaption className="text-sm text-ink-2">{p.caption}</figcaption>}
    </figure>
  )
}

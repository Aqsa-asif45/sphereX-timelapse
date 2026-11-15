import { useEffect, useRef, useState } from 'react'
import { aladinLib } from '../../lib/sky'

/** Other telescopes' all-sky pictures from ESA's HiPS mirror (reachable where CDS's own servers are not). */
const SURVEYS = [
  { id: 'allwise', name: 'AllWISE (infrared, 3.4–12 µm)', url: 'https://skies.esac.esa.int/AllWISEColor/' },
  { id: '2mass', name: '2MASS (near-infrared, 1.2–2.2 µm)', url: 'https://skies.esac.esa.int/2MASSColor/' },
  { id: 'dss', name: 'DSS (visible light)', url: 'https://skies.esac.esa.int/DSSColor/' },
]

/**
 * "Sky around it": the wider area in Aladin Lite, with the SPHEREx field drawn as an amber square.
 * Loaded only when opened (Aladin is about 2.4 MB). These are not SPHEREx images.
 */
export default function SkyMap({ ra, dec, fovArcmin }) {
  const box = useRef(null)
  const view = useRef(null)
  const [state, setState] = useState('loading')
  const [err, setErr] = useState('')
  const [survey, setSurvey] = useState('allwise')

  useEffect(() => {
    let dead = false
    const el = box.current
    aladinLib()
      .then((A) => {
        if (dead || !box.current) return
        const v = A.aladin(box.current, {
          target: `${ra} ${dec}`,
          fov: Math.max(0.1, (fovArcmin * 3) / 60),
          projection: 'TAN',
          cooFrame: 'ICRS',
          survey: SURVEYS[0].url,
          showReticle: false,
          showLayersControl: false,
          showGotoControl: false,
          showFullscreenControl: false,
          showSimbadPointerControl: false,
          showShareControl: false,
          showFrame: false,
          showCooGrid: false,
          showProjectionControl: false,
          showContextMenu: false,
          log: false, // no usage ping to CDS
          backgroundColor: 'rgb(7,9,14)',
        })
        const ov = A.graphicOverlay({ color: '#ffb84d', lineWidth: 2 })
        v.addOverlay(ov)
        const half = fovArcmin / 120
        const dra = half / Math.cos((dec * Math.PI) / 180)
        ov.add(A.polygon([[ra - dra, dec - half], [ra + dra, dec - half], [ra + dra, dec + half], [ra - dra, dec + half]]))
        view.current = v
        setState('ready')
      })
      .catch((e) => {
        if (dead) return
        setErr(String(e?.message ?? e))
        setState('error')
      })
    return () => {
      dead = true
      if (el) el.innerHTML = ''
      view.current = null
    }
  }, [ra, dec, fovArcmin])

  useEffect(() => {
    if (state !== 'ready' || !view.current) return
    aladinLib().then((A) => {
      const s = SURVEYS.find((x) => x.id === survey)
      view.current?.setBaseImageLayer(A.imageHiPS(s.url, { name: s.name }))
    })
  }, [survey, state])

  return (
    <div className="flex flex-col gap-2">
      <div ref={box} className="aspect-square w-full overflow-hidden rounded-ctl border border-line bg-bg" data-testid="skymap" />
      {state === 'loading' && <p className="text-xs text-ink-3">Loading the sky map (Aladin Lite, about 2.4 MB)…</p>}
      {state === 'error' && <p className="text-xs text-danger">The sky map could not load here: {err}</p>}
      {state === 'ready' && (
        <label className="flex items-center gap-2 text-xs text-ink-2">
          Survey
          <select className="min-w-0 flex-1 rounded-ctl border border-ctl bg-raised px-2 py-1 text-xs text-ink" value={survey} onChange={(e) => setSurvey(e.target.value)}>
            {SURVEYS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="text-xs text-ink-3">
        The amber square is the SPHEREx field in the viewer. Drag to pan, scroll to zoom. Another telescope's picture, not SPHEREx data
        (Aladin Lite by CDS; images from ESA's sky mirror).
      </p>
    </div>
  )
}

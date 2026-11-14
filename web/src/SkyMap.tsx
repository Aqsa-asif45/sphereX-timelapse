/**
 * Sky context map with Aladin Lite (CDS). Loaded only when opened (the library is ~2.4 MB).
 * Sky images come from ESA's HiPS mirror (skies.esac.esa.int), which stays reachable on
 * networks where CDS's own servers are not.
 */
import { useEffect, useRef, useState } from 'preact/hooks';

const ALADIN = 'https://cdn.jsdelivr.net/npm/aladin-lite@3.9.2-beta/dist/aladin.js';
const SURVEYS = [
  { id: 'allwise', name: 'AllWISE (infrared, 3.4–12 µm)', url: 'https://skies.esac.esa.int/AllWISEColor/' },
  { id: '2mass', name: '2MASS (near-infrared, 1.2–2.2 µm)', url: 'https://skies.esac.esa.int/2MASSColor/' },
  { id: 'dss', name: 'DSS (visible light)', url: 'https://skies.esac.esa.int/DSSColor/' },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lib: Promise<any> | null = null;

export function SkyMap({ ra, dec, fovArcmin }: { ra: number; dec: number; fovArcmin: number }) {
  const box = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const view = useRef<any>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [survey, setSurvey] = useState('allwise');
  const [err, setErr] = useState('');

  useEffect(() => {
    let dead = false;
    lib ??= import(/* @vite-ignore */ ALADIN).then((m) => m.default);
    lib.then(async (A) => {
      await A.init;
      if (dead || !box.current) return;
      const s = SURVEYS[0];
      view.current = A.aladin(box.current, {
        target: `${ra} ${dec}`, fov: Math.max(0.1, (fovArcmin * 3) / 60), projection: 'TAN', cooFrame: 'ICRS',
        survey: s.url, showReticle: false, showLayersControl: false, showGotoControl: false, showFullscreenControl: false,
        showSimbadPointerControl: false, showShareControl: false, showFrame: false, showCooGrid: false,
        log: false, // no usage ping to CDS (unreachable on some networks, and not needed)
      });
      const ov = A.graphicOverlay({ color: '#ffb84d', lineWidth: 2 });
      view.current.addOverlay(ov);
      const half = fovArcmin / 120;
      ov.add(A.polygon([[ra - half / Math.cos((dec * Math.PI) / 180), dec - half], [ra + half / Math.cos((dec * Math.PI) / 180), dec - half], [ra + half / Math.cos((dec * Math.PI) / 180), dec + half], [ra - half / Math.cos((dec * Math.PI) / 180), dec + half]]));
      setState('ready');
    }).catch((e: unknown) => { if (!dead) { setErr(String((e as Error)?.message ?? e)); setState('error'); } });
    return () => { dead = true; };
  }, []);

  useEffect(() => {
    if (state !== 'ready' || !view.current) return;
    lib!.then((A) => { const s = SURVEYS.find((x) => x.id === survey)!; view.current.setBaseImageLayer(A.imageHiPS(s.url, { name: s.name })); });
  }, [survey, state]);

  return (
    <div class="skymap">
      <div class="skymap-box" ref={box} />
      {state === 'loading' && <p class="note">Loading the sky map (Aladin Lite, about 2.4 MB)…</p>}
      {state === 'error' && <p class="note">The sky map could not load here: {err}</p>}
      {state === 'ready' && (
        <label class="ctl" style={{ marginTop: '.5rem' }}>Survey
          <select value={survey} onChange={(e) => setSurvey((e.target as HTMLSelectElement).value)}>
            {SURVEYS.map((s) => <option value={s.id}>{s.name}</option>)}
          </select>
        </label>
      )}
      <p class="note">The amber square is the SPHEREx field shown in the viewer. Drag to pan, scroll to zoom. Powered by Aladin Lite (CDS) and ESA's sky-image mirror.</p>
    </div>
  );
}

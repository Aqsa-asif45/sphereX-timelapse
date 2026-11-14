/**
 * The whole sky as SPHEREx sees it, on a draggable globe (Aladin Lite + NASA's SPHEREx DR1 all-sky HiPS).
 * False colour by default (1.1 / 2.1 / 4.6 µm as blue / green / red), or one wavelength in grey.
 * The five challenge targets are interface markers only. Loaded only when scrolled into view.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { AnimatePresence, EASE, inView, motion, rise, stagger } from './motion';
import { aladinLib, createSky, FRAMES, setSkyMode } from './sky';

/** Where TimeLens searches each target (moving ones at their mid-2026 positions, as SPHEREx sees them). */
export const SKY_TARGETS = [
  { slug: 'barnard', name: "Barnard's Star", kind: 'Red dwarf star', ra: 269.44627, dec: 4.7682 },
  { slug: 'eps-indi-b', name: 'Epsilon Indi B', kind: 'Brown dwarf pair', ra: 331.09644, dec: -56.80116 },
  { slug: 'wise-0855', name: 'WISE 0855−0714', kind: 'Coldest known brown dwarf', ra: 133.76003, dec: -7.24223 },
  { slug: 'rw-aur', name: 'RW Aurigae', kind: 'Young variable star', ra: 76.95653, dec: 30.40144 },
  { slug: 'r-dra', name: 'R Draconis', kind: 'Pulsating red giant', ra: 248.16761, dec: 66.75498 },
];

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function SkySphere({ go }: { go: (q: string) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const view = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const libRef = useRef<any>(null);
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [err, setErr] = useState('');
  const [focus, setFocus] = useState<string | null>(null);
  const [frame, setFrame] = useState(44);
  const [colour, setColour] = useState(true);

  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); } }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let dead = false;
    setState('loading');
    aladinLib().then((A) => {
      if (dead || !box.current) return;
      libRef.current = A;
      const v = createSky(A, box.current, { fov: 140, target: '266.4 -29.0', interactive: true }); // Galactic centre first
      view.current = v;
      const cat = A.catalog({
        name: 'Challenge targets', shape: 'circle', sourceSize: 22, color: '#ffb84d', hoverColor: '#ffd38a', selectionColor: '#5fd4e3',
        displayLabel: true, labelColumn: 'name', labelColor: '#edf1f6', labelFont: '14px "IBM Plex Sans", sans-serif',
        onClick: (s: { data: { name: string } }) => go(s.data.name),
      });
      v.addCatalog(cat);
      cat.addSources(SKY_TARGETS.map((t) => A.source(t.ra, t.dec, { name: t.name, slug: t.slug })));
      setState('ready');
    }).catch((e: unknown) => { if (!dead) { setErr(String((e as Error)?.message ?? e)); setState('error'); } });
    return () => { dead = true; };
  }, [visible]);

  useEffect(() => { if (state === 'ready') setSkyMode(view.current, frame, colour); }, [state, frame, colour]);

  const flyTo = (t: (typeof SKY_TARGETS)[number]) => {
    setFocus(t.slug);
    const v = view.current;
    if (!v) return;
    if (!reduced() && typeof v.animateToRaDec === 'function') v.animateToRaDec(t.ra, t.dec, 1.2);
    else v.gotoRaDec(t.ra, t.dec);
    v.setFoV(8);
  };
  const t = SKY_TARGETS.find((x) => x.slug === focus);

  return (
    <motion.section class="sky" aria-labelledby="sky-h" ref={wrap} {...inView} variants={stagger}>
      <motion.div class="sky-head" variants={rise}>
        <div>
          <h2 id="sky-h">The whole sky, as SPHEREx sees it</h2>
          <p>NASA's SPHEREx DR1 all-sky map. Drag to look around, scroll to zoom, and click a target to open its images.</p>
        </div>
        <p class="sky-real"><span class="real">Real SPHEREx data</span></p>
      </motion.div>
      <motion.div class="sky-stage" variants={{ hidden: { opacity: 0, scale: 0.985 }, show: { opacity: 1, scale: 1, transition: { duration: 0.7, ease: EASE } } }}>
        <div class="sky-box" ref={box} role="application" aria-label="Interactive map of the whole sky from SPHEREx. Use the target buttons below to move it with the keyboard." />
        {state !== 'ready' && (
          <p class="sky-status" role={state === 'error' ? 'alert' : 'status'}>
            {state === 'error' ? `The sky map could not load here (${err}). The targets below still work.` : 'Loading the SPHEREx sky (Aladin Lite, about 2.4 MB)…'}
          </p>
        )}
        <AnimatePresence mode="wait">
          {t && (
            <motion.div key={t.slug} class="sky-card glass" aria-live="polite"
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } }} exit={{ opacity: 0, y: 8, transition: { duration: 0.15 } }}>
              <b>{t.name}</b><span>{t.kind}</span>
              <span class="mono">RA {t.ra.toFixed(4)}° · Dec {t.dec >= 0 ? '+' : '−'}{Math.abs(t.dec).toFixed(4)}°</span>
              <button class="btn primary" onClick={() => go(t.name)}>Explore its images</button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
      <motion.div class="sky-bands" role="group" aria-label="Colours shown" variants={rise}>
        <span>Infrared</span>
        {FRAMES.map((f) => (
          <button class={'btn sm' + (frame === f.i ? ' on' : '')} aria-pressed={frame === f.i} onClick={() => setFrame(f.i)}>{f.um.toFixed(1)} µm</button>
        ))}
        <button class={'btn sm' + (colour ? ' on' : '')} aria-pressed={colour} onClick={() => setColour((c) => !c)} title="Colour by brightness (inferno) or plain grey">Colour</button>
      </motion.div>
      <motion.ul class="sky-targets" aria-label="Fly to a challenge target" variants={stagger}>
        {SKY_TARGETS.map((x) => (
          <motion.li key={x.slug} variants={rise}><button class={'chip-btn glass' + (focus === x.slug ? ' on' : '')} aria-pressed={focus === x.slug} onClick={() => flyTo(x)}>{x.name}<span>{x.kind}</span></button></motion.li>
        ))}
      </motion.ul>
      <motion.p class="note" variants={rise}>
        Sky: SPHEREx DR1 all-sky HiPS (NASA/JPL-Caltech/IPAC, IRSA), a visual overview with a fixed display stretch; measurements use the individual exposures.
        Each view is one infrared wavelength; SPHEREx sees light our eyes cannot, so colour shows brightness (dark → purple → orange → yellow), not true colour. Globe: Aladin Lite (CDS). Amber circles mark the targets; the sky pixels are not altered.
      </motion.p>
    </motion.section>
  );
}

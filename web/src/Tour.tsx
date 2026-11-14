/** A short guided tour: dims the page, highlights one control at a time, explains it in a sentence. */
import { useEffect, useLayoutEffect, useState } from 'preact/hooks';

export interface Step { sel: string; title: string; text: string }

export const TOUR: Step[] = [
  { sel: '[data-tour=viewer]', title: 'Your patch of sky', text: 'It plays by itself: each picture is one SPHEREx visit, months apart. Watch for anything that jumps or changes.' },
  { sel: '[data-tour=player]', title: 'Play, pause, step', text: 'Pause, step one picture at a time, or drag along the timeline. Change the speed on the right.' },
  { sel: '[data-tour=modes]', title: 'Three ways to look', text: '“Visits” blinks the visits. “Every exposure” shows each raw photo. “Combine” subtracts two visits: orange is where something is now, blue is where it was.' },
  { sel: '[data-tour=colours]', title: '102 infrared colours', text: 'Split them into six bands side by side, or use false colour, which makes cold, red objects like brown dwarfs stand out.' },
  { sel: '[data-tour=find]', title: 'Let the app look', text: 'It checks every star for movement between visits, and anything that appeared just once, then compares each find with ESA’s Gaia star catalogue.' },
  { sel: '[data-tour=spectrum]', title: 'Click for a spectrum', text: 'Click anywhere on the image to see that spot’s brightness across all the colours. Different objects have different fingerprints.' },
  { sel: '[data-tour=spot]', title: 'Spotted something?', text: 'Mark it on the image, add a note, and export your list for the science team.' },
];

export function Tour({ onClose }: { onClose: () => void }) {
  const steps = TOUR.filter((s) => document.querySelector(s.sel));
  const [k, setK] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = steps[k];

  useLayoutEffect(() => {
    if (!step) return;
    const el = document.querySelector(step.sel) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const update = () => setRect(el.getBoundingClientRect());
    update();
    const t = setTimeout(update, 350);
    addEventListener('resize', update); addEventListener('scroll', update, true);
    return () => { clearTimeout(t); removeEventListener('resize', update); removeEventListener('scroll', update, true); };
  }, [k]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); k < steps.length - 1 ? setK(k + 1) : onClose(); }
      else if (e.key === 'ArrowLeft' && k > 0) { e.preventDefault(); setK(k - 1); }
    };
    addEventListener('keydown', h, true);
    return () => removeEventListener('keydown', h, true);
  }, [k]);

  if (!step || !rect) return null;
  const pad = 6, cardH = 240, below = rect.bottom + cardH + 20 < innerHeight;
  const cardTop = below ? rect.bottom + 12 : Math.max(12, rect.top - 12 - cardH);
  const cardLeft = Math.min(innerWidth - 340, Math.max(12, rect.left));
  return (
    <div class="tour" role="dialog" aria-modal="true" aria-labelledby="tour-h">
      <div class="tour-hole" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + 2 * pad, height: rect.height + 2 * pad }} />
      <div class="tour-card" style={{ left: cardLeft, top: cardTop }}>
        <span class="tour-n">{k + 1} / {steps.length}</span>
        <h3 id="tour-h">{step.title}</h3>
        <p>{step.text}</p>
        <div class="tour-btns">
          <button class="link" onClick={onClose}>Skip tour</button>
          <span class="spacer" />
          {k > 0 && <button class="btn" onClick={() => setK(k - 1)}>Back</button>}
          <button class="btn on" autofocus onClick={() => (k < steps.length - 1 ? setK(k + 1) : onClose())}>{k < steps.length - 1 ? 'Next' : 'Done'}</button>
        </div>
      </div>
    </div>
  );
}

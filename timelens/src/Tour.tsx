/** A five-step guided tour: highlights one part of the workspace at a time. Skippable; Esc closes. */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

const STEPS = [
  { sel: '[data-tour=viewer]', title: 'Your patch of sky', text: 'Real SPHEREx images of the spot you chose, turned north-up. Each square is one SPHEREx pixel, about 6″ of sky. Scroll to zoom, drag to pan, click to measure.' },
  { sel: '[data-tour=timeline]', title: 'Real dates, real gaps', text: 'Each block is one visit. SPHEREx comes back about every six months, so the gaps are long. The little ticks are single exposures, coloured by wavelength.' },
  { sel: '[data-tour=views]', title: 'Ways to compare', text: 'Blink flips between visits A and B. Difference subtracts them: orange is brighter in A, blue brighter in B, so a moving star leaves an orange-and-blue pair.' },
  { sel: '[data-tour=modes]', title: 'Four workspaces', text: 'Sky for the deepest picture, Time to compare dates, Spectrum to measure brightness across 102 colours, Movers to let TimeLens search for motion.' },
  { sel: '[data-tour=details]', title: 'Every number has a source', text: 'Details shows the target, the exact files on screen, data-quality flags and where everything came from.' },
];

export function Tour({ onClose }: { onClose: () => void }) {
  const steps = STEPS.filter((s) => document.querySelector(s.sel));
  const [k, setK] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const step = steps[k];

  useLayoutEffect(() => {
    if (!step) return;
    const el = document.querySelector(step.sel) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ block: 'nearest' });
    const update = () => setRect(el.getBoundingClientRect());
    update();
    addEventListener('resize', update);
    addEventListener('scroll', update, true);
    return () => { removeEventListener('resize', update); removeEventListener('scroll', update, true); };
  }, [k]);

  useEffect(() => { card.current?.querySelector<HTMLButtonElement>('.btn.primary')?.focus(); }, [k, !!rect]);
  // when the tour ends, focus goes back where it was (or to the workspace switcher)
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    return () => {
      const back = before?.isConnected && before !== document.body ? before : document.querySelector<HTMLElement>('[data-tour=modes] button[aria-pressed=true]');
      setTimeout(() => back?.focus(), 0);
    };
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Tab') { // a modal dialog: Tab cycles through the card's buttons only
        const bs = [...(card.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
        if (!bs.length) return;
        e.preventDefault();
        const i = bs.indexOf(document.activeElement as HTMLButtonElement);
        bs[e.shiftKey ? (i <= 0 ? bs.length - 1 : i - 1) : (i + 1) % bs.length].focus();
      } else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); k < steps.length - 1 ? setK(k + 1) : onClose(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); if (k > 0) setK(k - 1); }
    };
    addEventListener('keydown', h, true);
    return () => removeEventListener('keydown', h, true);
  }, [k, steps.length]);

  if (!step || !rect) return null;
  const pad = 6, W = Math.min(340, innerWidth - 24), cardH = 210;
  const below = rect.bottom + cardH + 24 < innerHeight;
  const top = below ? rect.bottom + 12 : Math.max(12, rect.top - 12 - cardH);
  const inside = !below && rect.top - cardH < 24; // the element fills the screen: put the card inside it
  const left = Math.min(innerWidth - W - 12, Math.max(12, rect.left));
  return (
    <div class="tour" role="dialog" aria-modal="true" aria-labelledby="tour-h">
      <div class="tour-hole" style={{ left: `${rect.left - pad}px`, top: `${rect.top - pad}px`, width: `${rect.width + 2 * pad}px`, height: `${rect.height + 2 * pad}px` }} />
      <div class="tour-card" ref={card} style={{ left: `${left}px`, top: `${inside ? rect.top + 16 : top}px`, width: `${W}px` }}>
        <span class="tour-n mono">{k + 1} / {steps.length}</span>
        <h3 id="tour-h">{step.title}</h3>
        <p>{step.text}</p>
        <div class="tour-btns">
          <button class="link" onClick={onClose}>Skip tour</button>
          <span class="spacer" />
          {k > 0 && <button class="btn" onClick={() => setK(k - 1)}>Back</button>}
          <button class="btn primary" onClick={() => (k < steps.length - 1 ? setK(k + 1) : onClose())}>{k < steps.length - 1 ? 'Next' : 'Done'}</button>
        </div>
      </div>
    </div>
  );
}

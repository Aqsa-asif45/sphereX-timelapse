/** Search box (combobox): star names or coordinates, with the challenge targets and recent searches as suggestions. */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Featured } from '../../web/src/api';
import { Icon } from './icons';
import { load, save } from './util';

const RECENT = 'timelens.recent';

export function SearchBox({ value, featured, onSubmit, big, id, button = 'Explore' }: { value: string; featured: Featured[]; onSubmit: (q: string) => void; big?: boolean; id: string; button?: string }) {
  const [q, setQ] = useState(value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [err, setErr] = useState('');
  const wrap = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setQ(value); }, [value]);
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener('pointerdown', h);
    return () => removeEventListener('pointerdown', h);
  }, [open]);

  const recent = load<string[]>(RECENT, []);
  const t = q.trim().toLowerCase();
  const opts = [
    ...featured.map((f) => ({ label: f.name, sub: f.kind, kind: 'Challenge target' })),
    ...recent.filter((r) => !featured.some((f) => f.name === r)).map((r) => ({ label: r, sub: '', kind: 'Recent' })),
  ].filter((o) => !t || o.label.toLowerCase().includes(t) || o.sub.toLowerCase().includes(t)).slice(0, 8);

  const submit = (text: string) => {
    const s = text.trim();
    if (!s) { setErr('Type a star name, or coordinates such as 08h55m10.8s −07°14′42″.'); return; }
    setErr(''); setOpen(false); setActive(-1); setQ(s);
    save(RECENT, [s, ...recent.filter((r) => r !== s)].slice(0, 6));
    onSubmit(s);
  };
  const listId = `${id}-list`;
  return (
    <form class={'search' + (big ? ' big' : '')} role="search" ref={wrap} onSubmit={(e) => { e.preventDefault(); submit(active >= 0 && opts[active] ? opts[active].label : input.current?.value ?? q); }}>
      <label class="sr-only" for={id}>Star name or sky coordinates</label>
      <span class="search-ico" aria-hidden="true"><Icon name="search" size={big ? 20 : 17} /></span>
      <input id={id} ref={input} value={q} autocomplete="off" spellcheck={false}
        placeholder={big ? "Try Barnard's Star, or 08h55m10.8s −07°14′42″" : 'Star name or coordinates'}
        role="combobox" aria-expanded={open && opts.length > 0} aria-controls={open && opts.length > 0 ? listId : undefined} aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined} aria-invalid={!!err} aria-describedby={err ? `${id}-err` : undefined}
        onFocus={() => setOpen(true)}
        onInput={(e) => { setQ((e.target as HTMLInputElement).value); setOpen(true); setActive(-1); setErr(''); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(opts.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(-1, a - 1)); }
          else if (e.key === 'Escape') { setOpen(false); setActive(-1); }
        }} />
      <button type="submit" class={'btn primary' + (big ? '' : ' sm')}>{button}</button>
      {open && opts.length > 0 && (
        <ul class="search-list" id={listId} role="listbox" aria-label="Suggestions">
          {opts.map((o, k) => (
            <li id={`${listId}-${k}`} role="option" aria-selected={k === active} class={k === active ? 'on' : ''}
              onPointerDown={(e) => { e.preventDefault(); submit(o.label); }}>
              <b>{o.label}</b>{o.sub && <span>{o.sub}</span>}<em>{o.kind}</em>
            </li>
          ))}
        </ul>
      )}
      {err && <p class="search-err" id={`${id}-err`} role="alert">{err}</p>}
    </form>
  );
}

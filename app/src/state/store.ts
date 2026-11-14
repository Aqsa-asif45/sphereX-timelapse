import { create } from 'zustand';
import { subscribe, type Stamped } from '@/lib/events';
import type { CutPreset, Colormap, Stretch } from '@/lib/image';
import type { Observation, SearchResult } from '@/lib/types';

/** ra/dec: where to search (moving targets: their mid-2026 position). ra0/dec0/epoch/pm: the catalogue position and motion. */
export interface Position {
  ra: number; dec: number; label: string; source: string; slug?: string; kind?: string | null; classification?: string;
  ra0?: number; dec0?: number; epoch?: number; pmra?: number | null; pmdec?: number | null;
}

interface State {
  position: Position | null;
  /** partial: exposures from the collections that have answered so far (shown before the search finishes) */
  search: { status: 'idle' | 'running' | 'done' | 'error'; progress: string[]; partial?: Observation[]; startedAt?: number; result?: SearchResult; error?: string };
  selected: Observation | null;
  view: { stretch: Stretch; colormap: Colormap; cut: CutPreset; showFlags: boolean; sizeDeg: number };
  events: Stamped[];
  setPosition: (p: Position | null) => void;
  setSearch: (s: Partial<State['search']>) => void;
  select: (o: Observation | null) => void;
  setView: (v: Partial<State['view']>) => void;
}

export const useApp = create<State>((set) => ({
  position: null,
  search: { status: 'idle', progress: [] },
  selected: null,
  view: { stretch: 'asinh', colormap: 'inferno', cut: 'p99.5', showFlags: false, sizeDeg: 0.05 },
  events: [],
  setPosition: (position) => set({ position, selected: null, search: { status: 'idle', progress: [] } }),
  setSearch: (s) => set((st) => ({ search: { ...st.search, ...s } })),
  select: (selected) => set({ selected }),
  setView: (v) => set((st) => ({ view: { ...st.view, ...v } })),
}));

// keep the last 200 events for the Activity log
subscribe((e) => useApp.setState((st) => ({ events: [...st.events.slice(-199), e] })));

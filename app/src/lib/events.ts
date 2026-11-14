/** Typed application events (brief §14). Every event carries an id and a timestamp. */

export type AppEvent =
  | { type: 'TARGET_SELECTED'; slug: string; name: string }
  | { type: 'COORDINATES_VALIDATED'; input: string; ra: number; dec: number; source: string }
  | { type: 'COORDINATES_INVALID'; input: string; reason: string }
  | { type: 'SEARCH_STARTED'; ra: number; dec: number; collections: string[] }
  | { type: 'COLLECTION_DONE'; collection: string; count: number }
  | { type: 'COLLECTION_FAILED'; collection: string; error: string }
  | { type: 'FALLBACK'; adapter: string; reason?: string }
  | { type: 'OBSERVATIONS_FOUND'; count: number; byRelease: Record<string, number>; adapter: string; complete: boolean }
  | { type: 'SEARCH_FAILED'; error: string }
  | { type: 'CUTOUT_REQUESTED'; obsId: string; detector: number; release: string }
  | { type: 'IMAGE_READY'; obsId: string; ms: number; fromCache: boolean }
  | { type: 'IMAGE_FAILED'; obsId: string; error: string };

export type EventType = AppEvent['type'];
export type Stamped<E extends AppEvent = AppEvent> = E & { id: string; at: number };

type Listener = (e: Stamped) => void;
const listeners = new Set<Listener>();
let seq = 0;

export function emit(e: AppEvent): Stamped {
  const s = { ...e, id: `${Date.now().toString(36)}-${(seq++).toString(36)}`, at: Date.now() } as Stamped;
  for (const l of listeners) l(s);
  return s;
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

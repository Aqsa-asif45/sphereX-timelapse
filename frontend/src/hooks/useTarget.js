import { useQuery } from '@tanstack/react-query'
import * as api from '../lib/api'

/** Name or coordinates -> position (and proper motion for moving stars). */
export function useTarget(q) {
  return useQuery({
    queryKey: ['resolve', q],
    queryFn: ({ signal }) => api.resolve(q, signal),
    enabled: !!q,
    staleTime: Infinity,
    retry: (count, e) => e?.status !== 404 && e?.status !== 400 && count < 1,
  })
}

import { useQuery } from '@tanstack/react-query'
import * as api from '../lib/api'

/**
 * Is the backend up, and can it reach IRSA? Checked on load and every 30 seconds.
 * @returns {{ state: 'checking'|'ok'|'down', irsa: boolean|null, coverage: object|null, retry: () => void }}
 */
export function useServerStatus() {
  const q = useQuery({
    queryKey: ['status'],
    queryFn: ({ signal }) => api.status(signal),
    refetchInterval: 30_000,
    retry: 1,
  })
  const state = q.isSuccess ? 'ok' : q.isError ? 'down' : 'checking'
  return {
    state: q.isFetching && q.isError ? 'checking' : state,
    irsa: q.data?.irsa ?? null,
    coverage: q.data?.coverage ?? null,
    retry: () => q.refetch(),
  }
}

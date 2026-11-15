import { useQuery } from '@tanstack/react-query'
import * as api from '../lib/api'

/**
 * Stars from Gaia DR3 or CatWISE2020 around the field, only while that overlay is on. Answers are filed
 * under the field they were asked for (the query key), so a slow answer for the previous target or field
 * is never drawn on the new one; leaving a field cancels its request.
 * @param {'gaia'|'wise'} cat
 * @param {[number, number]|null} center
 */
export function useCatalog(cat, center, fov, enabled) {
  const r = +((fov / 60) * 0.75).toFixed(4) // covers the field's corners (half-diagonal = 0.71 × width)
  return useQuery({
    queryKey: ['catalog', cat, center?.[0], center?.[1], r],
    queryFn: ({ signal }) => api.catalog(cat, { ra: center[0], dec: center[1], r }, signal),
    enabled: !!center && enabled,
    staleTime: Infinity,
    retry: 1,
  })
}

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCatalog } from '../../hooks/useCatalog'
import * as api from '../../lib/api'
import Inspector from './Inspector'

vi.mock('../../lib/api', async (orig) => ({ ...(await orig()), catalog: vi.fn() }))

const wrapper = ({ children }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
)

describe('catalogue answers (OV-5)', () => {
  it('never shows a late answer for the previous field', async () => {
    const pending = []
    api.catalog.mockImplementation(
      (cat, params) => new Promise((resolve) => pending.push({ params, resolve })),
    )
    const { result, rerender } = renderHook(({ c }) => useCatalog('gaia', c, 4, true), {
      wrapper,
      initialProps: { c: [269.4, 4.7] },
    })
    await waitFor(() => expect(pending).toHaveLength(1))
    rerender({ c: [133.8, -7.2] }) // the user opened another target
    await waitFor(() => expect(pending).toHaveLength(2))
    await act(async () =>
      pending[0].resolve({ rows: [{ ra: 269.4, dec: 4.7, mag: 9 }], count: 1, source: 'old' }),
    )
    expect(result.current.data).toBeUndefined() // the old answer is not used
    await act(async () => pending[1].resolve({ rows: [], count: 0, source: 'new' }))
    await waitFor(() => expect(result.current.data?.source).toBe('new'))
    expect(pending[1].params).toEqual({ ra: 133.8, dec: -7.2, r: 0.05 })
  })

  it('asks nothing while the overlay is off', () => {
    api.catalog.mockClear()
    renderHook(() => useCatalog('wise', [10, 10], 4, false), { wrapper })
    expect(api.catalog).not.toHaveBeenCalled()
  })
})

const FRAME = {
  id: 'dr1/level2/x.fits',
  mjd: 61000.5,
  det: 3,
  lambda_um: 1.9,
  dlambda_um: 0.04,
  release: 'dr1',
  version: 'l2b-v27',
  week: '2025W33_2C',
  obs: 321,
  exp: 1,
  file_url: 'https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/x.fits',
  collection: 'spherex_dr1',
  processing_date: '2026-08-16',
  found_via: 'IRSA SIA2',
}
const TARGET = {
  name: 'WISE 0855−0714',
  kind: 'brown dwarf',
  slug: 'wise-0855',
  ra: 133.786,
  dec: -7.244,
  epoch_mjd: 57388.5,
  pmra: -8118,
  pmdec: 673,
  source: 'checked',
  in_gaia: false,
}
const props = {
  q: 'WISE 0855',
  target: TARGET,
  result: {
    by_release: { dr1: 1 },
    sources: ['sia2'],
    exposures_available: 1,
    exposures_kept: 1,
    files_failed: 0,
    retrieved_utc: '2026-11-15T08:00:00Z',
    errors: [],
  },
  frames: [FRAME],
  visits: [{ i: 0, frames: [FRAME], mjd: FRAME.mjd, start: FRAME.mjd, end: FRAME.mjd }],
  cur: { label: 'Exposure 1 of 1', sub: '15 Nov 2025', mjd: FRAME.mjd, frames: [FRAME] },
  fov: 4,
  n: 39,
  center: [133.78, -7.243],
  cut: { loaded: 1, failed: 0, total: 1, quality: true, version: 1 },
  images: new Map([
    [
      FRAME.id,
      {
        image: new Float32Array(39 * 39),
        flags: new Int32Array(39 * 39).fill(1 << 21),
        variance: new Float32Array(39 * 39),
      },
    ],
  ]),
  flagNames: { dr1: { 21: 'SOURCE' } },
  irsa: true,
}

function matchWidth(px) {
  window.matchMedia = (q) => {
    const m = q.match(/(min|max)-width:\s*(\d+)px/)
    const ok = m ? (m[1] === 'min' ? px >= +m[2] : px <= +m[2]) : false
    return { matches: ok, addEventListener() {}, removeEventListener() {} }
  }
}

const renderInspector = (extra) =>
  render(
    <MemoryRouter>
      <Inspector open onClose={() => {}} {...props} {...extra} />
    </MemoryRouter>,
  )

describe('Details panel (OV-6, OV-7)', () => {
  afterEach(() => delete window.matchMedia)

  it('has the six sections, with provenance, flags by the file’s name and the brown-dwarf note', () => {
    renderInspector({ wide: true })
    for (const h of [
      'Target',
      'On screen',
      'Data quality',
      'Where this comes from',
      'Sky around it',
      'Share',
    ]) {
      expect(screen.getByRole('heading', { name: h })).toBeInTheDocument()
    }
    expect(screen.getByTestId('details').dataset.layout).toBe('side')
    expect(screen.getByText(/Not in Gaia: brown dwarfs are too faint/)).toBeInTheDocument()
    expect(screen.getByText(/SOURCE · 1\/1/)).toBeInTheDocument()
    expect(screen.getByText('1.900 µm ± 0.020')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Original FITS/ })).toHaveAttribute(
      'href',
      FRAME.file_url,
    )
    expect(screen.getByText('spherex_dr1')).toBeInTheDocument()
    expect(screen.getByText(/IRSA's image search/)).toBeInTheDocument()
  })

  it('is a drawer below 1200 px and a bottom sheet on phones; Esc closes it', () => {
    matchWidth(1000)
    const onClose = vi.fn()
    const { unmount } = renderInspector({ wide: false, onClose })
    expect(screen.getByTestId('details').dataset.layout).toBe('drawer')
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('button', { name: 'Close details' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
    unmount()
    matchWidth(390)
    renderInspector({ wide: false })
    expect(screen.getByTestId('details').dataset.layout).toBe('sheet')
  })

  it('renders nothing on a wide screen when closed', () => {
    renderInspector({ wide: true, open: false })
    expect(screen.queryByTestId('details')).toBeNull()
  })
})

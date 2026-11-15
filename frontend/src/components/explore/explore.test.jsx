import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MotionConfig } from 'motion/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ExplorePage from '../../pages/ExplorePage'
import { useExploreStore } from '../../store/exploreStore'

// two visits six months apart, three exposures each (detectors 1, 3 and 6)
const FRAMES = [
  [60902.1, 1],
  [60902.2, 3],
  [60902.3, 6],
  [61083.1, 1],
  [61083.2, 3],
  [61083.3, 6],
].map(([mjd, det], i) => ({ id: `f${i}`, mjd, det, lambda_um: [1, 2, 4.8][i % 3], week: 'w', obs: i, exp: 1 }))
const TARGET = { name: "Barnard's Star", kind: 'star', ra: 269.452, dec: 4.693, epoch_mjd: 51544.5, pmra: -801.551, pmdec: 10362.394 }

vi.mock('../../lib/api', async (orig) => ({
  ...(await orig()),
  resolve: vi.fn(() => Promise.resolve(TARGET)),
  streamObservations: vi.fn(async (params, onEvent) => {
    onEvent({ type: 'progress', done: 3, total: 6, frames: 3 })
    return { frames: FRAMES, sources: ['sia2'] }
  }),
  cutoutBatch: vi.fn(async (body, onCutout) => {
    for (const id of body.ids) onCutout(id, { n: body.n, image: Float32Array.from({ length: body.n * body.n }, (_, k) => k % 7) })
    return { ok: body.ids.length, failed: 0 }
  }),
}))

function Where() {
  const l = useLocation()
  return <output data-testid="url">{l.search}</output>
}

function renderAt(search) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MotionConfig reducedMotion="always">
        <MemoryRouter initialEntries={[`/explore${search}`]}>
          <ExplorePage />
          <Where />
        </MemoryRouter>
      </MotionConfig>
    </QueryClientProvider>,
  )
}

const caption = () => screen.getByTestId('viewer').parentElement.querySelector('figcaption').textContent

beforeEach(() => useExploreStore.setState({ playing: false, cur: 0, phase: 0, contrast: 25, stretch: 'asinh', smooth: false }))
afterEach(() => vi.clearAllMocks())

describe('Explore', () => {
  it('opens in Sky mode with the deepest picture and the coverage (MD-1, VW-5)', async () => {
    renderAt("?q=Barnard's Star&mode=sky")
    await waitFor(() => expect(caption()).toMatch(/All 2 visits combined/))
    expect(screen.getByTestId('coverage')).toHaveTextContent('6 exposures · 2 visits')
    expect(caption()).toMatch(/4′ field, north up, east left/)
    expect(screen.getByRole('tab', { name: 'Sky' })).toHaveAttribute('aria-selected', 'true')
  })

  it('shows the search progress, then the image', async () => {
    renderAt('?q=Vega')
    expect(await screen.findByText(/Looking up|Asking NASA|Checking/)).toBeInTheDocument()
    expect(await screen.findByTestId('viewer')).toBeInTheDocument()
  })

  it('Time mode: Blink flips between A (latest) and B (earliest) with the arrow keys (MD-2, MD-8)', async () => {
    renderAt('?q=Vega')
    await waitFor(() => expect(caption()).toMatch(/A · Visit 2 of 2/))
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(caption()).toMatch(/B · Visit 1 of 2/)
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(caption()).toMatch(/A · Visit 2 of 2/)
  })

  it('space plays and pauses (MD-8)', async () => {
    renderAt('?q=Vega&view=play')
    await screen.findByTestId('viewer')
    fireEvent.keyDown(window, { key: ' ' })
    expect(useExploreStore.getState().playing).toBe(true)
    fireEvent.keyDown(window, { key: ' ' })
    expect(useExploreStore.getState().playing).toBe(false)
  })

  it('Play visits steps through visits and wraps around (MD-3)', async () => {
    renderAt('?q=Vega&view=play')
    await waitFor(() => expect(caption()).toMatch(/^Visit 1 of 2/))
    fireEvent.click(screen.getByRole('button', { name: 'Next (→)' }))
    expect(caption()).toMatch(/^Visit 2 of 2/)
    fireEvent.click(screen.getByRole('button', { name: 'Next (→)' }))
    expect(caption()).toMatch(/^Visit 1 of 2/) // wrap-around
  })

  it('plays on its own at the chosen speed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderAt('?q=Vega&view=play')
    await waitFor(() => expect(caption()).toMatch(/^Visit 1 of 2/))
    fireEvent.click(screen.getByRole('button', { name: 'Play (space)' }))
    act(() => vi.advanceTimersByTime(750)) // "Normal" = 700 ms
    expect(caption()).toMatch(/^Visit 2 of 2/)
    vi.useRealTimers()
  })

  it('Every exposure shows single exposures with wavelength (MD-4)', async () => {
    renderAt('?q=Vega&view=exposures')
    await waitFor(() => expect(caption()).toMatch(/Exposure 1 of 6 · .*1\.00 µm · detector 1/))
    expect(within(screen.getByLabelText('Colours')).getByRole('option', { name: /Six bands/ })).toBeDisabled()
  })

  it('Side by side, Difference and Combine use visits A and B (MD-5, MD-6, MD-7)', async () => {
    renderAt('?q=Vega&view=side')
    await waitFor(() => expect(caption()).toMatch(/Visit B \(left/))
    fireEvent.click(screen.getByRole('button', { name: 'Difference' }))
    expect(caption()).toMatch(/Visit 2 minus visit 1/)
    expect(screen.getByText(/Orange: brighter in A/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Combine' }))
    fireEvent.click(screen.getByRole('button', { name: 'plus' }))
    expect(caption()).toMatch(/Visit 2 plus visit 1/)
    expect(screen.getByTestId('url')).toHaveTextContent('view=combine&op=add')
  })

  it('A and B pickers change the comparison, and warn when they are the same visit', async () => {
    renderAt('?q=Vega&view=diff')
    await waitFor(() => expect(caption()).toMatch(/Visit 2 minus visit 1/))
    fireEvent.change(screen.getByLabelText('Visit A'), { target: { value: '0' } })
    expect(caption()).toMatch(/Visit 1 minus visit 1/)
    expect(screen.getByText(/A and B are the same visit/)).toBeInTheDocument()
    expect(screen.getByTestId('url')).toHaveTextContent('a=1')
  })

  it('the time ruler shows each visit with its exposures, and clicking sets A (MD-9)', async () => {
    renderAt('?q=Vega&view=blink')
    const ruler = await screen.findByTestId('time-ruler')
    const visit1 = within(ruler).getByRole('button', { name: /Visit 1, .* 3 exposures, compared as B/ })
    expect(within(ruler).getByRole('button', { name: /Visit 2, .* compared as A/ })).toBeInTheDocument()
    expect(within(ruler).getByText('6 months later')).toBeInTheDocument()
    fireEvent.click(visit1)
    expect(screen.getByTestId('url')).toHaveTextContent('a=1')
  })

  it('every setting lands in the URL', async () => {
    renderAt('?q=Vega')
    await screen.findByTestId('viewer')
    fireEvent.change(screen.getByLabelText('Colours'), { target: { value: 'six' } })
    fireEvent.change(screen.getByLabelText('Field'), { target: { value: '6' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Sky' }))
    expect(screen.getByTestId('url')).toHaveTextContent('?q=Vega&fov=6&mode=sky&colours=six')
  })

  it('says so when nothing covers the position', async () => {
    const { streamObservations } = await import('../../lib/api')
    streamObservations.mockImplementationOnce(async () => ({ frames: [] }))
    renderAt('?q=Vega')
    expect(await screen.findByText(/No SPHEREx exposures cover this position yet/)).toBeInTheDocument()
  })

  it('reports a failed search with Try again', async () => {
    const { streamObservations } = await import('../../lib/api')
    streamObservations.mockImplementationOnce(async () => {
      throw new Error('IRSA is down')
    })
    renderAt('?q=Vega')
    expect(await screen.findByRole('alert')).toHaveTextContent('The search failed: IRSA is down')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByTestId('viewer')).toBeInTheDocument()
  })
})

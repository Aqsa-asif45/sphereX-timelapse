import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MotionConfig } from 'motion/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sliceFor } from '../../lib/sky'
import HomePage from '../../pages/HomePage'
import StartPage from '../../pages/StartPage'
import TargetPreview from './TargetPreview'

vi.mock('../../lib/sky', async (orig) => ({
  ...(await orig()),
  aladinLib: () => new Promise(() => {}), // the globe stays "loading" in tests (no network, no WebGL)
}))

const TARGETS = [
  { slug: 'barnard', name: "Barnard's Star", kind: 'star', blurb: 'Fastest-moving star.' },
  { slug: 'eps-indi-b', name: 'Epsilon Indi B', kind: 'brown dwarf', blurb: 'Two brown dwarfs.' },
  { slug: 'wise-0855', name: 'WISE 0855−0714', kind: 'brown dwarf', blurb: 'Coldest.' },
  { slug: 'rw-aur', name: 'RW Aurigae', kind: 'variable star', blurb: 'Dims.' },
  { slug: 'r-dra', name: 'R Draconis', kind: 'variable star', blurb: 'Pulsates.' },
]

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname + l.search}</p>
}

function renderAt(path) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MotionConfig reducedMotion="always">
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/start" element={<StartPage />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </MotionConfig>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(TARGETS) })),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Home', () => {
  it('is the hero: headline, Start button to /start and the backdrop label (SH-2)', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { level: 1, name: /find what moves/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /start your experience/i })).toHaveAttribute(
      'href',
      '/start',
    )
    expect(screen.getByText(/SPHEREx all-sky map in false colour/)).toBeInTheDocument()
    expect(screen.getByText(/for looking only/i)).toBeInTheDocument()
  })

  it('keeps search on /start, not in the hero (SR-5)', () => {
    renderAt('/')
    expect(screen.queryByLabelText(/star name or sky coordinates/i)).not.toBeInTheDocument()
  })
})

describe('/start', () => {
  it('has the globe and five target cards with what to look for (SH-3, SH-6)', async () => {
    renderAt('/start')
    expect(
      screen.getByRole('heading', { level: 1, name: /start your experience/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /whole sky/i })).toBeInTheDocument()
    expect(await screen.findByText('Fastest-moving star.')).toBeInTheDocument()
    expect(screen.getAllByTestId('target-card')).toHaveLength(5)
    expect(screen.getAllByText('Look for: Motion')).toHaveLength(3)
    expect(screen.getAllByText('Look for: Brightness')).toHaveLength(2)
  })

  it('suggests the five targets in the search box (SR-5)', async () => {
    renderAt('/start')
    const list = document.getElementById(
      screen.getByLabelText(/star name or sky coordinates/i).getAttribute('list'),
    )
    await screen.findByText('Fastest-moving star.')
    expect([...list.querySelectorAll('option')].map((o) => o.value)).toEqual(
      TARGETS.map((t) => t.name),
    )
  })

  it('searching opens Explore', async () => {
    renderAt('/start')
    fireEvent.change(screen.getByLabelText(/star name or sky coordinates/i), {
      target: { value: 'R Dra' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Explore the sky' }))
    expect(await screen.findByTestId('where')).toHaveTextContent('/explore?q=R%20Dra')
  })

  it('a target card opens that target', async () => {
    renderAt('/start')
    await screen.findByText('Fastest-moving star.')
    fireEvent.click(screen.getAllByTestId('target-card')[3])
    expect(await screen.findByTestId('where')).toHaveTextContent('/explore?q=RW%20Aurigae')
  })

  it('the globe buttons fly to a target and offer to open it (SH-5)', async () => {
    renderAt('/start')
    expect(screen.getByText(/Loading the SPHEREx sky/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Epsilon Indi B/ }))
    expect(await screen.findByText(/RA 331\.0964° · Dec −56\.8012°/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Explore its images' }))
    expect(await screen.findByTestId('where')).toHaveTextContent('/explore?q=Epsilon%20Indi%20B')
  })

  it('has the four wavelengths and a colour switch (SH-4)', () => {
    renderAt('/start')
    for (const um of ['1.1 µm', '2.1 µm', '3.3 µm', '4.6 µm']) {
      expect(screen.getByRole('button', { name: um })).toBeInTheDocument()
    }
    const colour = screen.getByRole('button', { name: 'Colour' })
    expect(colour).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(colour)
    expect(colour).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: '4.6 µm' }))
    expect(screen.getByRole('button', { name: '4.6 µm' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('/start carousel', () => {
  it('moves with the buttons, the arrow keys and the chips, and shows where you are', () => {
    renderAt('/start')
    const where = () => screen.getByText(/^\d of 7$/).textContent
    expect(where()).toBe('1 of 7')
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(where()).toBe('2 of 7')
    fireEvent.keyDown(screen.getByRole('tab', { name: /Whole sky/ }), { key: 'ArrowRight' })
    expect(where()).toBe('3 of 7')
    fireEvent.keyDown(screen.getByRole('tab', { name: /Whole sky/ }), { key: 'End' })
    expect(where()).toBe('7 of 7')
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    fireEvent.click(screen.getByRole('tab', { name: /Spectrum/ }))
    expect(where()).toBe('4 of 7')
    expect(screen.getByRole('tab', { name: /Spectrum/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps the arrow keys for the text while typing in the search box', () => {
    renderAt('/start')
    fireEvent.keyDown(screen.getByLabelText(/star name or sky coordinates/i), { key: 'ArrowRight' })
    expect(screen.getByText('1 of 7')).toBeInTheDocument()
  })

  it.each([
    ["Blink Barnard's Star", "/explore?q=Barnard's%20Star&view=blink"],
    ["Open R Draconis's spectrum", '/explore?q=R%20Draconis&mode=spectrum'],
    ['Hunt around Epsilon Indi B', '/explore?q=Epsilon%20Indi%20B&mode=movers'],
    ['Read the methods', '/about'],
  ])('the "%s" card opens %s', (name, href) => {
    renderAt('/start')
    expect(screen.getByRole('link', { name: new RegExp(name) })).toHaveAttribute('href', href)
  })
})

describe('preview', () => {
  it('says "not built yet" and tries again later', async () => {
    vi.useFakeTimers()
    render(<TargetPreview slug="barnard" size={100} alt="" />)
    const img = document.querySelector('img')
    expect(img.getAttribute('src')).toBe('/api/previews/barnard.gif')
    act(() => fireEvent.error(img))
    expect(screen.getByRole('status')).toHaveTextContent(/not built yet\. It is being made now/)
    act(() => vi.advanceTimersByTime(30_000))
    expect(document.querySelector('img').getAttribute('src')).toBe(
      '/api/previews/barnard.gif?try=1',
    )
  })
})

describe('sky frames', () => {
  it('inverts Aladin’s slice mapping so the chosen cube frame is fetched', () => {
    // round trip used by Aladin: slice -> wavelength (linear) -> frame (linear in frequency)
    const EM_MIN = 7.43e-7
    const EM_MAX = 5.009e-6
    for (const k of [16, 44, 62, 90]) {
      const lambda = EM_MIN + (sliceFor(k) / 102) * (EM_MAX - EM_MIN)
      const frame = ((1 / lambda - 1 / EM_MAX) / (1 / EM_MIN - 1 / EM_MAX)) * 102
      expect(Math.floor(frame)).toBe(k)
    }
  })
})

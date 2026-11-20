import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MotionConfig } from 'motion/react'
import { MemoryRouter } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from './App.jsx'
import { useGalaxy } from './store/galaxyStore'
import { useIntro } from './store/introStore'

vi.mock('./lib/sky', async (orig) => ({
  ...(await orig()),
  aladinLib: () => new Promise(() => {}), // the globe stays "loading" in tests (no network, no WebGL)
}))

const STATUS = {
  version: '0.1.0',
  irsa: true,
  coverage: { weeks: 151, indexed_weeks: 151, observations: 101080 },
}

function serverUp(irsa = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url) =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve(String(url).startsWith('/api/status') ? { ...STATUS, irsa } : []),
      }),
    ),
  )
}

function renderAt(path) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MotionConfig reducedMotion="always">
        <MemoryRouter initialEntries={[path]}>
          <AppShell />
        </MemoryRouter>
      </MotionConfig>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  sessionStorage.setItem('timelens.splashSeen', 'true') // most tests are not about the splash
  localStorage.setItem('timelens.introSeen', 'true') // or Nova's intro
  serverUp()
})
afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
  localStorage.clear()
  useIntro.setState({ open: false })
  useGalaxy.setState({ to: null })
})

describe("Nova's intro", () => {
  // the intro fades in and unfolds in stages: give the waits more room on a busy machine
  beforeAll(() => configure({ asyncUtilTimeout: 5000 }))
  afterAll(() => configure({ asyncUtilTimeout: 1000 }))

  it('plays once on a first visit to Home; Skip closes it and remembers', async () => {
    localStorage.removeItem('timelens.introSeen')
    renderAt('/')
    const intro = await screen.findByTestId('intro')
    expect(within(intro).getByRole('heading', { name: /Nova’s infrared voyage/ })).toBeInTheDocument()
    fireEvent.click(within(intro).getByRole('button', { name: 'Skip intro' }))
    await waitFor(() => expect(screen.queryByTestId('intro')).toBeNull())
    expect(localStorage.getItem('timelens.introSeen')).toBe('true')
  })

  it('steps through the five targets with real previews, and ends on /start', async () => {
    localStorage.removeItem('timelens.introSeen')
    renderAt('/')
    const intro = await screen.findByTestId('intro')
    const next = () => fireEvent.click(within(screen.getByTestId('intro')).getByRole('button', { name: /Next/ }))
    next()
    expect(await within(intro).findByRole('heading', { name: 'Barnard’s Star' })).toBeInTheDocument()
    expect(within(intro).getByAltText(/real SPHEREx images/)).toHaveAttribute('src', '/api/previews/barnard.gif')
    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    expect(await within(intro).findByRole('heading', { name: /Nova’s infrared voyage/ })).toBeInTheDocument()
    for (let i = 0; i < 6; i++) next()
    fireEvent.click(await within(intro).findByRole('button', { name: /Start exploring/ }))
    await waitFor(() => expect(screen.queryByTestId('intro')).toBeNull())
    expect(screen.getByTestId('galaxy-zoom')).toBeInTheDocument() // the zoom into the galaxy, then /start
    expect(await screen.findByRole('heading', { level: 1, name: /start your experience/i })).toBeInTheDocument()
  }, 20_000) // seven scenes, then the 2.3 s zoom

  it('Esc skips it, and it does not come back by itself', async () => {
    localStorage.removeItem('timelens.introSeen')
    const first = renderAt('/')
    await screen.findByTestId('intro')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('intro')).toBeNull())
    first.unmount()
    renderAt('/')
    await screen.findByRole('button', { name: /Watch Nova’s intro/ })
    expect(screen.queryByTestId('intro')).toBeNull()
  })

  it('Start your experience zooms into the galaxy, then opens /start; Esc skips the zoom', async () => {
    renderAt('/')
    fireEvent.click(await screen.findByRole('link', { name: /start your experience/i }))
    expect(await screen.findByTestId('galaxy-zoom')).toBeInTheDocument()
    expect(screen.getByText('Illustration · click or press Esc to skip')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(await screen.findByRole('heading', { level: 1, name: /start your experience/i })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('galaxy-zoom')).toBeNull())
  })

  it('can be replayed from Home', async () => {
    renderAt('/')
    fireEvent.click(await screen.findByRole('button', { name: /Watch Nova’s intro/ }))
    expect(await screen.findByTestId('intro')).toBeInTheDocument()
  })
})

describe('routes', () => {
  it('drops a trailing slash, so /start/ is the /start page with its glass top bar', async () => {
    renderAt('/start/')
    // a redirect, then the page fades in: allow for a busy machine
    expect(await screen.findByRole('heading', { level: 1, name: /start your experience/i }, { timeout: 5000 })).toBeInTheDocument()
  })

  it('an empty Explore offers the five targets and all features, not a dead end', async () => {
    renderAt('/explore')
    expect(await screen.findByRole('link', { name: 'Barnard’s Star'.replace('’', "'") })).toHaveAttribute('href', "/explore?q=Barnard's%20Star")
    expect(screen.getByRole('link', { name: 'See all features' })).toHaveAttribute('href', '/start')
  })

  it("the top bar's Explore link returns to the last target of this session", async () => {
    sessionStorage.setItem('timelens.lastExplore', JSON.stringify('?q=Vega&mode=sky'))
    renderAt('/about')
    const nav = (await screen.findAllByRole('navigation', { name: 'Main' }))[0]
    expect(within(nav).getByRole('link', { name: 'Explore' })).toHaveAttribute('href', '/explore?q=Vega&mode=sky')
  })

  it('opens Home', async () => {
    renderAt('/')
    expect(await screen.findByRole('heading', { name: /find what moves/i })).toBeInTheDocument()
    // the navbar's link (the page has a second "Methods" link further down)
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[0]
    expect(within(nav).getByRole('link', { name: 'Methods' })).toHaveAttribute('href', '/about')
  })

  it('opens Explore with the target from the URL, and puts the search in the top bar', async () => {
    renderAt('/explore?q=Barnard%27s%20Star')
    expect(
      await screen.findByRole('heading', { level: 1, name: "Barnard's Star" }),
    ).toBeInTheDocument()
    expect(screen.getByRole('search')).toBeInTheDocument()
  })

  it('opens Methods', async () => {
    renderAt('/about')
    expect(await screen.findByRole('heading', { name: /how timelens works/i })).toBeInTheDocument()
  })

  it('opens Embed without the top bar or footer', async () => {
    renderAt('/embed?q=Vega')
    expect(await screen.findByText('Vega')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Methods' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Methods and credits/)).not.toBeInTheDocument()
  })

  it('opens the /start features page with the glass top bar', async () => {
    renderAt('/start')
    expect(
      await screen.findByRole('heading', { level: 1, name: /start your experience/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('1 of 7')).toBeInTheDocument()
    expect(document.title).toBe('Start · SPHEREx TimeLens')
  })

  it("redirects the old viewer's embed link /?embed=1&q=... to /embed", async () => {
    renderAt('/?embed=1&q=Vega')
    expect(await screen.findByText('Vega')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Methods' })).not.toBeInTheDocument() // the embed view, not Explore
  })

  it('shows Not found for unknown paths', async () => {
    renderAt('/no/such/page')
    expect(await screen.findByRole('heading', { name: /not in our sky/i })).toBeInTheDocument()
  })

  it.each([
    ['/timelens/explore?q=Vega', 'Vega'],
    ['/?q=Vega', 'Vega'],
    ['/?ra=133.79&dec=-7.24', '133.79 -7.24'],
  ])('redirects old link %s to Explore', async (path, shown) => {
    renderAt(path)
    expect(await screen.findByRole('heading', { level: 1, name: shown })).toBeInTheDocument()
  })

  it.each(['/timelens', '/timelens/about'])('redirects old link %s', async (path) => {
    renderAt(path)
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
  })
})

describe('splash screen', () => {
  beforeEach(() => sessionStorage.clear())

  it('plays on the first visit to Home, skips with Enter, and not again this session', async () => {
    const first = renderAt('/')
    expect(screen.getByTestId('splash')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() => expect(screen.queryByTestId('splash')).not.toBeInTheDocument())
    expect(sessionStorage.getItem('timelens.splashSeen')).toBe('true')
    first.unmount()
    renderAt('/')
    expect(screen.queryByTestId('splash')).not.toBeInTheDocument()
  })

  it('is skipped for people who prefer reduced motion', () => {
    vi.stubGlobal('matchMedia', (q) => ({
      matches: q.includes('reduce'),
      addEventListener() {},
      removeEventListener() {},
    }))
    renderAt('/')
    expect(screen.queryByTestId('splash')).not.toBeInTheDocument()
  })

  it('does not cover a page opened from a link', () => {
    renderAt('/explore?q=Vega')
    expect(screen.queryByTestId('splash')).not.toBeInTheDocument()
  })
})

describe('server status', () => {
  it('shows connected, and says when IRSA is unreachable', async () => {
    renderAt('/')
    await waitFor(() =>
      expect(screen.getByTestId('status-dot')).toHaveAttribute('data-state', 'ok'),
    )
    expect(screen.getByText(/IRSA is reachable/)).toBeInTheDocument()
  })

  it('says when IRSA is down but the server is up', async () => {
    serverUp(false)
    renderAt('/')
    expect(await screen.findByText(/using the local sky index/)).toBeInTheDocument()
  })

  it('shows a banner with Try again when the server is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
    renderAt('/')
    // the status check retries once (about 1 s) before saying the server is down
    const banner = await screen.findByText(/so no SPHEREx data can load/, {}, { timeout: 4000 })
    expect(banner.closest('[role=alert]')).toBeInTheDocument()
    expect(screen.getByTestId('status-dot')).toHaveAttribute('data-state', 'down')
    serverUp()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() =>
      expect(screen.queryByText(/so no SPHEREx data can load/)).not.toBeInTheDocument(),
    )
  })
})

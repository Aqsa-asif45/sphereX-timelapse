import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MotionConfig } from 'motion/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from './App.jsx'

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
  serverUp()
})
afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

describe('routes', () => {
  it('opens Home', async () => {
    renderAt('/')
    expect(await screen.findByRole('heading', { name: /find what moves/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Methods' })).toBeInTheDocument()
  })

  it('opens Explore with the target from the URL, and puts the search in the top bar', async () => {
    renderAt('/explore?q=Barnard%27s%20Star')
    expect(await screen.findByRole('heading', { level: 1, name: "Barnard's Star" })).toBeInTheDocument()
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

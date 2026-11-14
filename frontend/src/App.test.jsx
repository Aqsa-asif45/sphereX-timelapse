import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App.jsx'

afterEach(() => vi.unstubAllGlobals())

describe('App (Phase 0 check page)', () => {
  it('shows the API version when /api/health answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, version: '0.1.0', astropy: '8.0.2' }),
        }),
      ),
    )
    render(<App />)
    expect(screen.getByRole('heading', { name: 'SPHEREx TimeLens' })).toBeInTheDocument()
    expect(await screen.findByText(/API ok · version 0.1.0/)).toBeInTheDocument()
  })

  it('says so when the API is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 502 })),
    )
    render(<App />)
    expect(await screen.findByText(/API unreachable \(HTTP 502\)/)).toBeInTheDocument()
  })
})

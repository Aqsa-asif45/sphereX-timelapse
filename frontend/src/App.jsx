import { useEffect, useState } from 'react'

/** Phase 0 check page: proves React, Tailwind and the /api proxy to FastAPI all work. */
export default function App() {
  const [api, setApi] = useState({ state: 'checking' })

  useEffect(() => {
    const ac = new AbortController()
    fetch('/api/health', { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => setApi({ state: 'ok', data }))
      .catch((e) => {
        if (e.name !== 'AbortError') setApi({ state: 'down', error: e.message })
      })
    return () => ac.abort()
  }, [])

  return (
    <main className="grid min-h-dvh place-items-center bg-[#07090e] p-6 text-[#edf1f6]">
      <div className="space-y-3 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">SPHEREx TimeLens</h1>
        <p className="text-[#a9b4c3]">Explore the invisible. Discover what moves.</p>
        <p role="status" className="font-mono text-sm">
          {api.state === 'checking' && 'Checking the API…'}
          {api.state === 'ok' &&
            `API ok · version ${api.data.version} · Astropy ${api.data.astropy}`}
          {api.state === 'down' &&
            `API unreachable (${api.error}). Is the backend running on port 8000?`}
        </p>
      </div>
    </main>
  )
}

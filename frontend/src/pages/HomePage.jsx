import { Navigate, useLocation } from 'react-router'
import Hero from '../components/home/Hero'
import { useTitle } from '../hooks/useTitle'

/** Home: the full-screen hero over the SPHEREx sky. Every other Home feature lives on /start. */
export default function HomePage() {
  useTitle('')
  const { search } = useLocation()
  const p = new URLSearchParams(search)
  if (p.get('embed') === '1') {
    p.delete('embed') // the old viewer's embed links (/?embed=1&q=...) open the embed view, not all of Explore
    return <Navigate to={`/embed?${p}`} replace />
  }
  if (p.get('q') || (p.get('ra') && p.get('dec'))) {
    return <Navigate to={`/explore${search}`} replace /> // old links such as /?q=Barnard's Star
  }
  return (
    <main id="main" className="flex w-full flex-1 flex-col">
      <Hero />
    </main>
  )
}

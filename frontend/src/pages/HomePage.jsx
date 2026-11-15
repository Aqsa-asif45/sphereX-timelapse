import { Navigate, useLocation } from 'react-router'
import Hero from '../components/home/Hero'
import SkyGlobe from '../components/home/SkyGlobe'
import TargetCards from '../components/home/TargetCards'
import { useTitle } from '../hooks/useTitle'

/** Home: hero with search and a live preview, the whole-sky globe, and the five challenge targets. */
export default function HomePage() {
  useTitle('')
  const { search } = useLocation()
  const p = new URLSearchParams(search)
  if (p.get('q') || (p.get('ra') && p.get('dec'))) {
    return <Navigate to={`/explore${search}`} replace /> // old links such as /?q=Barnard's Star
  }
  return (
    <main id="main" className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-12 px-4 pb-16">
      <Hero />
      <SkyGlobe />
      <TargetCards />
    </main>
  )
}

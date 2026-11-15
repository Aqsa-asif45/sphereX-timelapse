import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { useCallback, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router'
import Footer from './components/layout/Footer'
import ServerBanner from './components/layout/ServerBanner'
import TopBar from './components/layout/TopBar'
import { KEYS, load, save } from './lib/storage'
import AboutPage from './pages/AboutPage'
import EmbedPage from './pages/EmbedPage'
import ExplorePage from './pages/ExplorePage'
import HomePage from './pages/HomePage'
import NotFoundPage from './pages/NotFoundPage'
import SplashScreen from './pages/SplashScreen'

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Old TimeLens links (/timelens/...) keep working: same page, same settings. */
function OldLink({ to }) {
  const { search } = useLocation()
  return <Navigate to={`${to}${search}`} replace />
}

const page = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
}

/** Everything inside the router: layout, routes, page transitions and the splash screen. */
export function AppShell() {
  const location = useLocation()
  const embed = location.pathname === '/embed'
  // the splash shows on Home, once per browser session, and never for people who prefer reduced motion
  const [splash, setSplash] = useState(
    () =>
      location.pathname === '/' &&
      !location.search &&
      !load(KEYS.splashSeen, false, 'session') &&
      !prefersReducedMotion(),
  )
  const endSplash = useCallback(() => {
    save(KEYS.splashSeen, true, 'session')
    setSplash(false)
  }, [])

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-ctl focus:bg-raised focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      {!embed && <TopBar />}
      {!embed && <ServerBanner />}
      <AnimatePresence mode="wait">
        <motion.div key={location.pathname} className="flex flex-1 flex-col" {...page}>
          <Routes location={location}>
            <Route path="/" element={<HomePage />} />
            <Route path="/explore" element={<ExplorePage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/embed" element={<EmbedPage />} />
            <Route path="/timelens" element={<OldLink to="/" />} />
            <Route path="/timelens/explore" element={<OldLink to="/explore" />} />
            <Route path="/timelens/about" element={<OldLink to="/about" />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </motion.div>
      </AnimatePresence>
      {!embed && <Footer />}
      <AnimatePresence>
        {splash && <SplashScreen key="splash" onDone={endSplash} />}
      </AnimatePresence>
    </div>
  )
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <BrowserRouter>
          <AppShell />
        </BrowserRouter>
      </MotionConfig>
    </QueryClientProvider>
  )
}

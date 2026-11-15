import { Link, NavLink, useLocation, useSearchParams } from 'react-router'
import SearchBox from '../search/SearchBox'
import Logo from './Logo'
import StatusDot from './StatusDot'

const navClass = ({ isActive }) =>
  `rounded-ctl px-2 py-1 text-sm ${isActive ? 'text-ink underline decoration-focus underline-offset-4' : 'text-ink-2 hover:text-ink'}`

/** Logo, search (on Explore), Explore and Methods links, and the server status dot. */
export default function TopBar() {
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const onExplore = pathname === '/explore'
  return (
    <header className="flex h-14 items-center gap-2 border-b sm:gap-4 border-line bg-bg px-4">
      <Link to="/" className="flex shrink-0 items-center gap-2" aria-label="SPHEREx TimeLens home">
        <Logo size={24} />
        <span className="hidden font-medium tracking-tight sm:inline">
          <b className="font-semibold">SPHEREx</b> TimeLens
        </span>
      </Link>
      {onExplore && (
        <SearchBox key={params.get('q') ?? ''} initial={params.get('q') ?? ''} id="top-search" />
      )}
      <span className="flex-1" />
      <nav aria-label="Main" className="flex items-center gap-1">
        <NavLink to="/explore" className={navClass}>
          Explore
        </NavLink>
        <NavLink to="/about" className={navClass}>
          Methods
        </NavLink>
      </nav>
      <StatusDot />
    </header>
  )
}

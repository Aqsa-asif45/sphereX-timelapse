import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useSearchParams } from 'react-router'
import { KEYS, load } from '../../lib/storage'
import SearchBox from '../search/SearchBox'
import Logo from './Logo'
import { GLASS_PAGES } from './glass'
import StatusDot from './StatusDot'

const navClass = ({ isActive }) =>
  `rounded-ctl px-2 py-1 text-sm ${isActive ? 'text-ink underline decoration-focus underline-offset-4' : 'text-ink-2 hover:text-ink'}`

const LINKS = [
  { to: '/explore', label: 'Explore' },
  { to: '/about', label: 'Methods' },
]

/** Logo, search (on Explore), Explore and Methods links (a menu on phones), and the server status dot. */
export default function TopBar() {
  const { pathname, search } = useLocation()
  const [params] = useSearchParams()
  const onExplore = pathname === '/explore'
  // Explore opens the target you were last looking at (this session), or stays on the current one
  const exploreTo = `/explore${onExplore ? search : load(KEYS.lastExplore, '', 'session')}`
  const links = LINKS.map((l) => (l.to === '/explore' ? { ...l, to: exploreTo } : l))
  const glass = GLASS_PAGES.includes(pathname)
  // the phone menu remembers the page it was opened on, so it closes by itself after moving to another page
  const [openOn, setOpenOn] = useState(null)
  const open = openOn === pathname
  const setOpen = (v) => setOpenOn(v ? pathname : null)
  const menu = useRef(null)
  const button = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpenOn(null)
        button.current?.focus()
      }
    }
    const onDown = (e) => {
      if (!menu.current?.contains(e.target) && !button.current?.contains(e.target)) setOpenOn(null)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open])

  return (
    <header
      className={`relative flex h-14 items-center gap-2 border-b px-4 sm:gap-4 ${
        glass
          ? 'border-white/10 bg-bg/55 backdrop-blur-md backdrop-saturate-150'
          : 'border-line bg-bg'
      }`}
    >
      <Link
        to="/"
        className="flex shrink-0 items-center gap-2 rounded-ctl transition hover:opacity-80"
        aria-label="SPHEREx TimeLens home"
        title="Home"
      >
        <Logo size={24} />
        <span className="hidden font-medium tracking-tight sm:inline">
          <b className="font-semibold">SPHEREx</b> TimeLens
        </span>
      </Link>
      {onExplore && (
        <SearchBox key={params.get('q') ?? ''} initial={params.get('q') ?? ''} id="top-search" />
      )}
      <span className="flex-1" />
      <nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
        {links.map((l) => (
          <NavLink key={l.label} to={l.to} className={navClass}>
            {l.label}
          </NavLink>
        ))}
      </nav>
      <StatusDot />
      <button
        ref={button}
        type="button"
        aria-label="Menu"
        aria-expanded={open}
        aria-controls="phone-menu"
        onClick={() => setOpen(!open)}
        className="grid size-9 shrink-0 place-items-center rounded-ctl text-ink-2 hover:bg-hover hover:text-ink sm:hidden"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d={open ? 'M5 5l10 10M15 5L5 15' : 'M3 6h14M3 10h14M3 14h14'}
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {open && (
        <nav
          ref={menu}
          id="phone-menu"
          aria-label="Menu"
          className="absolute top-full right-2 left-2 z-50 mt-2 flex flex-col gap-1 rounded-panel border border-line-2 bg-bg-2/95 p-2 shadow-xl backdrop-blur-md sm:hidden"
        >
          {links.map((l) => (
            <NavLink
              key={l.label}
              to={l.to}
              className={({ isActive }) =>
                `rounded-ctl px-3 py-2.5 text-base ${isActive ? 'bg-raised text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink'}`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
      )}
    </header>
  )
}

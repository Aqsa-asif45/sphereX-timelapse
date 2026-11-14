/** SPHEREx TimeLens: app shell, client-side routes (/, /explore, /about under /timelens) and server status. */
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './styles.css';
import * as api from '../../web/src/api';
import type { Featured } from '../../web/src/api';
import { About } from './About';
import { Explore } from './Explore';
import { Icon, Mark } from './icons';
import { Landing } from './Landing';
import { SearchBox } from './Search';
import { BASE, readExplore } from './util';

type Server = { state: 'checking' | 'ok' | 'down'; irsa: boolean | null };

function App() {
  // `nav` counts navigations, so searching for the same thing again is still a new request (a retry)
  const [loc, setLoc] = useState({ path: location.pathname, search: location.search, nav: 0 });
  useEffect(() => {
    const h = () => setLoc((l) => ({ path: location.pathname, search: location.search, nav: l.nav + 1 }));
    addEventListener('popstate', h);
    return () => removeEventListener('popstate', h);
  }, []);
  const navigate = (to: string) => {
    if (BASE + to !== location.pathname + location.search) history.pushState(null, '', BASE + to);
    setLoc((l) => ({ path: location.pathname, search: location.search, nav: l.nav + 1 }));
    scrollTo(0, 0);
  };
  const link = (to: string) => (e: Event) => { const m = e as MouseEvent; if (m.ctrlKey || m.metaKey || m.shiftKey || m.button === 1) return; e.preventDefault(); navigate(to); };
  const route = loc.path.replace(/^\/timelens\/?/, '').replace(/\/+$/, '');
  const go = (q: string) => navigate(`/explore?q=${encodeURIComponent(q)}`);

  const [featured, setFeatured] = useState<Featured[]>([]);
  const [server, setServer] = useState<Server>({ state: 'checking', irsa: null });
  const check = () => {
    setServer((s) => ({ ...s, state: 'checking' }));
    api.status().then((s) => setServer({ state: 'ok', irsa: s.irsa })).catch(() => setServer({ state: 'down', irsa: null }));
    api.featured().then(setFeatured).catch(() => {});
  };
  useEffect(check, []);
  useEffect(() => { if (route !== 'explore') document.title = route === 'about' ? 'Methods and data · SPHEREx TimeLens' : 'SPHEREx TimeLens: find what moves in the infrared sky'; }, [route]);

  const q = route === 'explore' ? readExplore(loc.search).q : '';
  return (
    <>
      <a class="skip" href="#main">Skip to content</a>
      <header class={'topbar' + (route === 'explore' ? ' compact' : '')}>
        <a class="brand" href={`${BASE}/`} onClick={link('/')} aria-label="SPHEREx TimeLens home">
          <Mark /><span><b>SPHEREx</b> TimeLens</span>
        </a>
        {route === 'explore' && <SearchBox id="top-q" value={q} featured={featured} onSubmit={go} />}
        <span class="spacer" />
        <nav class="topnav" aria-label="Main">
          <a href={`${BASE}/explore`} aria-current={route === 'explore' ? 'page' : undefined} onClick={link(route === 'explore' ? `/explore${location.search}` : '/explore')}>Explore</a>
          <a href={`${BASE}/about`} aria-current={route === 'about' ? 'page' : undefined} onClick={link('/about')}>Methods</a>
        </nav>
        <span class={'srv ' + server.state} title={server.state === 'ok' ? (server.irsa ? 'Connected. NASA/IPAC IRSA reachable.' : 'Connected. IRSA unreachable: using the sky index of the AWS archive.') : server.state === 'down' ? 'Cannot reach the TimeLens server' : 'Checking the server…'}>
          <i aria-hidden="true" /><span class="sr-only">{server.state === 'ok' ? 'Server connected' : server.state === 'down' ? 'Server unreachable' : 'Checking server'}</span>
        </span>
      </header>
      {server.state === 'down' && (
        <div class="banner" role="alert"><Icon name="warn" size={16} /><span>Cannot reach the TimeLens server, so no SPHEREx data can load. Is it running (<span class="mono">npm start</span>)?</span><button class="btn sm" onClick={check}>Try again</button></div>
      )}
      {route === 'explore' ? <div id="main"><Explore search={loc.search} nonce={loc.nav} featured={featured} irsa={server.irsa} /></div>
        : route === 'about' ? <About link={link} />
          : <Landing featured={featured} go={go} link={link} />}
    </>
  );
}

render(<App />, document.getElementById('app')!);

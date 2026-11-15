import { Link } from 'react-router'

/** Data credits on every page. No NASA logo; NASA/JPL-Caltech/IPAC are credited as data sources. */
export default function Footer() {
  return (
    <footer className="border-t border-line px-4 py-4 text-xs text-ink-3">
      SPHEREx data: NASA/JPL-Caltech/IPAC, via the NASA/IPAC Infrared Science Archive (IRSA) and the
      AWS Open Data programme · Gaia DR3 (ESA/Gaia/DPAC) · CatWISE2020 · Sky globe: Aladin Lite
      (CDS). Images are shown as stored; nothing is filled in or simulated. ·{' '}
      <Link to="/about" className="text-focus underline underline-offset-2">
        Methods and credits
      </Link>
    </footer>
  )
}

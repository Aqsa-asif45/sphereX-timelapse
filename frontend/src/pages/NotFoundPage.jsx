import { Link } from 'react-router'
import { useTitle } from '../hooks/useTitle'

export default function NotFoundPage() {
  useTitle('Page not found')
  return (
    <main
      id="main"
      className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center"
    >
      <h1 className="text-2xl font-semibold">This page is not in our sky.</h1>
      <p className="text-ink-2">The address may be mistyped, or the page has moved.</p>
      <Link
        to="/"
        className="rounded-ctl bg-time px-4 py-2 font-medium text-bg hover:brightness-110"
      >
        Back to Home
      </Link>
    </main>
  )
}

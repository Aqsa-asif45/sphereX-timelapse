import { useEffect } from 'react'

/** Set the browser tab title for a page. */
export function useTitle(title) {
  useEffect(() => {
    document.title = title
      ? `${title} · SPHEREx TimeLens`
      : 'SPHEREx TimeLens: find what moves in the infrared sky'
  }, [title])
}

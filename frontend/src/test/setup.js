import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// remove each test's rendered page before the next test (Vitest has no global afterEach by default)
afterEach(() => cleanup())

// jsdom has no IntersectionObserver (Motion's "animate when scrolled into view" needs one):
// this stand-in reports every observed element as visible straight away
if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class {
    constructor(callback) {
      this.callback = callback
    }
    observe(el) {
      queueMicrotask(() => this.callback([{ target: el, isIntersecting: true, intersectionRatio: 1 }], this))
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }
}

// jsdom does not scroll: the app's scroll memory (App.jsx) calls scrollTo on every page change
window.scrollTo = () => {}

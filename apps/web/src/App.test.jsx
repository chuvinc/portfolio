import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import App from './App'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function stubFetch(routes) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const body = routes[url]
      if (!body) return { ok: false, status: 500, statusText: 'Error' }
      return { ok: true, json: async () => body }
    }),
  )
}

test('renders projects and build info from the API', async () => {
  stubFetch({
    '/api/projects': [
      { id: 'p1', name: 'Demo project', summary: 'A demo', tags: ['node'], url: 'https://example.com' },
    ],
    '/api/build-info': { version: '1.2.3', commit: 'abcdef1234', builtAt: null },
  })

  render(<App />)

  expect(await screen.findByText('Demo project')).toBeTruthy()
  expect(await screen.findByText('abcdef1')).toBeTruthy()
})

test('shows an error message when the API fails', async () => {
  stubFetch({})

  render(<App />)

  expect(await screen.findByText(/Couldn't load projects/)).toBeTruthy()
  expect(await screen.findByText('build info unavailable')).toBeTruthy()
})

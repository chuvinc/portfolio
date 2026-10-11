import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
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

test('skills reflect the technologies implemented in this portfolio', async () => {
  stubFetch({})
  render(<App />)
  const skills = within(document.querySelector('#skills'))
  expect(skills.getByText('React')).toBeTruthy()
  expect(skills.getByText('Fastify')).toBeTruthy()
  expect(skills.getByText('Tesseract.js')).toBeTruthy()
  expect(skills.getByText('OpenCV.js')).toBeTruthy()
  expect(skills.getByText('WebAssembly')).toBeTruthy()
  expect(skills.getByText('Canvas API')).toBeTruthy()
  expect(skills.getByText('Vitest')).toBeTruthy()
  expect(skills.getByText('GitHub Actions')).toBeTruthy()
  expect(skills.getByText('GitHub Pages')).toBeTruthy()
  expect(skills.queryByText('Kubernetes')).toBeNull()
  expect(skills.queryByText('Terraform')).toBeNull()
  await screen.findByText('build info unavailable')
})

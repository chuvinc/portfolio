import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildApp, buildInfo } from '../src/app.js'

test('GET /healthcheck returns ok', async () => {
  const app = buildApp()
  const res = await app.inject({ method: 'GET', url: '/healthcheck' })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.json(), { status: 'ok' })
})

test('GET /api/projects returns a non-empty list', async () => {
  const app = buildApp()
  const res = await app.inject({ method: 'GET', url: '/api/projects' })
  assert.equal(res.statusCode, 200)
  assert.ok(res.json().length > 0)
  const projects = res.json()
  const portfolio = projects.find((project) => project.id === 'portfolio')
  const ocr = projects.find((project) => project.id === 'ocr')
  assert.equal(portfolio.url, 'https://github.com/chuvinc/portfolio')
  assert.ok(portfolio.tags.includes('vite'))
  assert.ok(portfolio.tags.includes('node.js'))
  assert.equal(ocr.name, 'Image text reader')
  assert.match(ocr.summary, /Browser-based OCR with selectable text regions/)
  assert.ok(ocr.tags.includes('opencv.js'))
  assert.ok(ocr.tags.includes('canvas-api'))
})

test('buildInfo reads from env and has defaults', () => {
  assert.deepEqual(buildInfo({ GIT_SHA: 'abc', APP_VERSION: '1.2.3', BUILD_TIME: 't' }), {
    version: '1.2.3',
    commit: 'abc',
    builtAt: 't',
  })
  assert.equal(buildInfo({}).commit, 'unknown')
})

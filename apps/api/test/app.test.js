import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildApp, buildInfo } from '../src/app.js'

test('GET /healthz returns ok', async () => {
  const app = buildApp()
  const res = await app.inject({ method: 'GET', url: '/healthz' })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.json(), { status: 'ok' })
})

test('GET /api/projects returns a non-empty list', async () => {
  const app = buildApp()
  const res = await app.inject({ method: 'GET', url: '/api/projects' })
  assert.equal(res.statusCode, 200)
  assert.ok(res.json().length > 0)
})

test('buildInfo reads from env and has defaults', () => {
  assert.deepEqual(buildInfo({ GIT_SHA: 'abc', APP_VERSION: '1.2.3', BUILD_TIME: 't' }), {
    version: '1.2.3',
    commit: 'abc',
    builtAt: 't',
  })
  assert.equal(buildInfo({}).commit, 'unknown')
})

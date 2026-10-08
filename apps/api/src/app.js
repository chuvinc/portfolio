import Fastify from 'fastify'
import { projects } from './projects.js'

// Build metadata is injected at image build time (GIT_SHA, BUILD_TIME, APP_VERSION).
export function buildInfo(env = process.env) {
  return {
    version: env.APP_VERSION ?? 'dev',
    commit: env.GIT_SHA ?? 'unknown',
    builtAt: env.BUILD_TIME ?? null,
  }
}

export function buildApp(opts = {}) {
  const app = Fastify(opts)

  app.get('/healthcheck', async () => ({ status: 'ok' }))
  app.get('/api/projects', async () => projects)
  app.get('/api/build-info', async () => buildInfo())

  return app
}

import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) }
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'server/**/*.test.ts', 'features/**/*.test.ts', 'cli/**/*.test.ts'],
    // PGlite (Postgres als WASM) braucht beim ersten Start einen Moment.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: { SERVER_SECRET: 'test-secret-test-secret-test-secret-0123456789' }
  }
})

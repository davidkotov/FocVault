import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

type Mode = 'abort-mid-body' | 'hang'
const state: { mode: Mode; signals: AbortSignal[] } = { mode: 'hang', signals: [] }

// Netzwerk simulieren: kein echter Verbindungsaufbau in Tests
vi.mock('node:https', () => ({
  request: (_url: URL, opts: { signal: AbortSignal }, cb: (res: unknown) => void) => {
    const req = Object.assign(new EventEmitter(), {
      destroy: (e?: Error) => req.emit('error', e ?? new Error('destroyed')),
      end: () => {
        state.signals.push(opts.signal)
        opts.signal?.addEventListener('abort', () => req.emit('error', new Error('AbortError')))
        if (state.mode === 'abort-mid-body') {
          const res = Object.assign(new EventEmitter(), { statusCode: 200, headers: { 'content-type': 'image/png' }, complete: false, resume: () => undefined })
          cb(res)
          setTimeout(() => {
            res.emit('data', Buffer.alloc(10))
            res.emit('aborted')
            res.emit('close')
          }, 5)
        }
      }
    })
    return req
  }
}))

describe('Icon-Abruf', () => {
  it('Abbruch mitten im Body setzt das Promise ab (kein Hängen)', async () => {
    const { fetchIcon } = await import('./service')
    state.mode = 'abort-mid-body'
    await expect(fetchIcon('abbruch-test.example', 5_000)).resolves.toBeNull()
  })

  it('Gesamtfrist greift, auch wenn der Server nie antwortet', async () => {
    const { fetchIcon } = await import('./service')
    state.mode = 'hang'
    state.signals = []
    const t0 = Date.now()
    await expect(fetchIcon('haengt-test.example', 200)).resolves.toBeNull()
    expect(Date.now() - t0).toBeLessThan(2_000)
    expect(state.signals.length).toBeGreaterThan(0)
    expect(state.signals.every(s => s.aborted)).toBe(true)
  })
})

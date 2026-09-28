import { describe, expect, it } from 'vitest'
import { isPrivateIp, pickIconHref, validHost } from './service'

describe('Website-Icons', () => {
  it('blockiert private und lokale Ziele', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.20.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '0.0.0.0'])
      expect(isPrivateIp(ip)).toBe(true)
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) expect(isPrivateIp(ip)).toBe(false)
    expect(validHost('github.com')).toBe(true)
    for (const h of ['localhost', 'router.local', '127.0.0.1', 'a', 'foo.internal', 'x..com', 'evil.com:8080']) expect(validHost(h)).toBe(false)
  })
  it('wählt das beste Icon aus dem HTML', () => {
    const html = `<link rel="icon" href="/fav.ico"><link rel="icon" sizes="192x192" href="/i192.png"><link rel="apple-touch-icon" href="/apple.png">`
    expect(pickIconHref(html)).toBe('/apple.png')
    expect(pickIconHref('<link rel="shortcut icon" href=\'/s.ico\'>')).toBe('/s.ico')
    expect(pickIconHref('<link rel="stylesheet" href="/a.css">')).toBeNull()
  })
})

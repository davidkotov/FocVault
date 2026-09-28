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
  it('blockiert IPv6-Übersetzungen auf private IPv4 (NAT64, 6to4, mapped/compatible)', () => {
    for (const ip of [
      '64:ff9b::a9fe:a9fe', // NAT64 → 169.254.169.254
      '64:ff9b::169.254.169.254',
      '64:ff9b::808:808', // NAT64 generell gesperrt
      '64:ff9b:1::a00:1',
      '2002:7f00:1::1', // 6to4 → 127.0.0.1
      '2002:0808:0808::1', // 6to4 generell gesperrt
      '2001:0:4136:e378:8000:63bf:3fff:fdd2', // Teredo
      '::ffff:10.0.0.1',
      '::ffff:a00:1', // mapped in Hex-Schreibweise
      '0:0:0:0:0:ffff:7f00:1',
      '::ffff:0:192.168.1.1', // IPv4-translated
      '::127.0.0.1', // IPv4-compatible
      '::a9fe:a9fe',
      '::',
      'fec0::1', // site-local
      '100::1', // discard
      '2001:db8::1',
      'fe80::1%eth0',
      'nonsense'
    ])
      expect(isPrivateIp(ip), ip).toBe(true)
    for (const ip of ['2a00:1450:4001:80b::200e', '2606:4700:4700::1111', '::ffff:8.8.8.8']) expect(isPrivateIp(ip), ip).toBe(false)
  })
  it('wählt das beste Icon aus dem HTML', () => {
    const html = `<link rel="icon" href="/fav.ico"><link rel="icon" sizes="192x192" href="/i192.png"><link rel="apple-touch-icon" href="/apple.png">`
    expect(pickIconHref(html)).toBe('/apple.png')
    expect(pickIconHref('<link rel="shortcut icon" href=\'/s.ico\'>')).toBe('/s.ico')
    expect(pickIconHref('<link rel="stylesheet" href="/a.css">')).toBeNull()
  })
})

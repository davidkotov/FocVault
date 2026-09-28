import { describe, expect, it } from 'vitest'
import { isSafeIconDataUrl, MAX_ICON_DATA_URL_LENGTH, parseSecrets, parseVaultContainer } from './vault'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg=='
const secret = (icon: unknown) => ({ id: 's1', kind: 'password', title: 'GitHub', icon, iconHost: 'github.com', createdAt: 1, updatedAt: 1 })

describe('Website-Icons im Tresor', () => {
  it('nur eingebettete Raster-Data-URLs', () => {
    expect(isSafeIconDataUrl(PNG)).toBe(true)
    for (const t of ['jpeg', 'gif', 'webp', 'x-icon', 'vnd.microsoft.icon']) expect(isSafeIconDataUrl(`data:image/${t};base64,AAAA`)).toBe(true)
    for (const bad of [
      'https://evil.example/pixel.png',
      'http://10.0.0.1/x.png',
      '//evil.example/x.png',
      'data:image/svg+xml;base64,PHN2Zy8+',
      'data:text/html;base64,PGgxPg==',
      'data:image/png,<svg>',
      'data:image/png;base64,AAAA"onerror=',
      `data:image/png;base64,${'A'.repeat(MAX_ICON_DATA_URL_LENGTH)}`,
      'javascript:alert(1)',
      42
    ])
      expect(isSafeIconDataUrl(bad)).toBe(false)
  })

  it('Parsing verwirft https-Icons (eigener und geteilter Tresor), lässt gültige und „keins“ stehen', () => {
    const [bad] = parseSecrets([secret('https://evil.example/track.png?member=1')])
    expect(bad.icon).toBeUndefined()
    expect(bad.iconHost).toBeUndefined()
    expect(bad.title).toBe('GitHub')
    expect(parseSecrets([secret(PNG)])[0].icon).toBe(PNG)
    expect(parseSecrets([secret('')])[0].icon).toBe('')
    expect(parseSecrets('kaputt')).toEqual([])

    const c = parseVaultContainer(JSON.stringify({ v: 3, files: [], secrets: [secret('https://evil.example/a.png'), secret(PNG)] }))
    expect(c.secrets.map(s => s.icon)).toEqual([undefined, PNG])
  })
})

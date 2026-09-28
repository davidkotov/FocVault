'use client'

import { useEffect, useState } from 'react'
import { loadSiteIcon } from '@/features/icons/client'
import { isSafeIconDataUrl } from '@/lib/vault'

/**
 * Icon einer Website (aus dem Tresor oder bei Bedarf nachgeladen) oder Kürzel als Ersatz.
 * Gerendert werden nur eingebettete Data-URLs – nie eine externe Adresse (IP-Leak in geteilten Tresoren).
 */
export default function SiteAvatar({ title, icon, host, size = 34 }: { title: string; icon?: string; host?: string; size?: number }) {
  const [loaded, setLoaded] = useState<string>('')
  const stored = isSafeIconDataUrl(icon) ? icon : ''
  useEffect(() => {
    if (stored || !host) return
    let alive = true
    void loadSiteIcon(host).then(x => alive && setLoaded(x))
    return () => {
      alive = false
    }
  }, [stored, host])
  const src = stored || (isSafeIconDataUrl(loaded) ? loaded : '')
  return src ? (
    <span className="pwavatar siteicon" style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" width={size - 12} height={size - 12} />
    </span>
  ) : (
    <span className="pwavatar" style={{ width: size, height: size }}>
      {title.slice(0, 2).toUpperCase()}
    </span>
  )
}

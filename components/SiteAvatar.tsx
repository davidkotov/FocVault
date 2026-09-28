'use client'

import { useEffect, useState } from 'react'
import { loadSiteIcon } from '@/features/icons/client'

/** Icon einer Website (aus dem Tresor oder bei Bedarf nachgeladen) oder Kürzel als Ersatz. */
export default function SiteAvatar({ title, icon, host, size = 34 }: { title: string; icon?: string; host?: string; size?: number }) {
  const [loaded, setLoaded] = useState<string>('')
  useEffect(() => {
    if (icon || !host) return
    let alive = true
    void loadSiteIcon(host).then(x => alive && setLoaded(x))
    return () => {
      alive = false
    }
  }, [icon, host])
  const src = icon || loaded
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

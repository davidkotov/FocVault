'use client'

/** Icon einer Website (aus dem Tresor) oder Kürzel als Ersatz. */
export default function SiteAvatar({ title, icon, size = 34 }: { title: string; icon?: string; size?: number }) {
  return icon ? (
    <span className="pwavatar siteicon" style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={icon} alt="" width={size - 12} height={size - 12} />
    </span>
  ) : (
    <span className="pwavatar" style={{ width: size, height: size }}>
      {title.slice(0, 2).toUpperCase()}
    </span>
  )
}

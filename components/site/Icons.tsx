/** Einheitliche Linien-Icons (24×24, currentColor) – statt Emojis auf Landing und in der Dashboard-Vorschau. */
const P: Record<string, JSX.Element> = {
  cloud: <path d="M7 18h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.1 9.6 4.2 4.2 0 0 0 7 18z" />,
  send: <path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" />,
  trash: (
    <>
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5M12 7v5l3 2" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M10.8 12.2 20 3M16 7l3 3M14 9l2 2" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  note: (
    <>
      <path d="M5 3h10l4 4v14H5z" />
      <path d="M15 3v4h4M8 12h8M8 16h5" />
    </>
  ),
  otp: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  passkey: (
    <>
      <path d="M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
      <path d="M6 20v-1a6 6 0 0 1 9-5.2M17 14v7M17 17h3M17 20h2" />
    </>
  ),
  lifebuoy: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
      <path d="m5.6 5.6 3.6 3.6M14.8 14.8l3.6 3.6M18.4 5.6l-3.6 3.6M9.2 14.8l-3.6 3.6" />
    </>
  ),
  family: (
    <>
      <circle cx="8" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M2.5 20a5.5 5.5 0 0 1 11 0M13.5 20a4 4 0 0 1 8 0" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  vault: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 9V7M12 17v-2M15 12h2M7 12h2" />
    </>
  ),
  admin: (
    <>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3M12 15h5" />
    </>
  ),
  sso: (
    <>
      <rect x="3" y="10" width="18" height="11" rx="2" />
      <path d="M7 10V7a5 5 0 0 1 10 0v3M12 14v3" />
    </>
  ),
  proof: (
    <>
      <path d="M9 12l2 2 4-4" />
      <path d="M12 2l2.4 1.8 3-.2.9 2.9 2.5 1.7-.9 2.8.9 2.8-2.5 1.7-.9 2.9-3-.2L12 22l-2.4-1.8-3 .2-.9-2.9-2.5-1.7.9-2.8-.9-2.8 2.5-1.7.9-2.9 3 .2z" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  scale: (
    <>
      <path d="M12 3v18M5 21h14M6 7h12" />
      <path d="m6 7-3 7a3 3 0 0 0 6 0zM18 7l-3 7a3 3 0 0 0 6 0z" />
    </>
  ),
  eye: (
    <>
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c7 0 11 7 11 7a18 18 0 0 1-3.2 4M6.6 6.6A18 18 0 0 0 1 12s4 7 11 7a10 10 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  activity: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s7-6.1 7-12a7 7 0 0 0-14 0c0 5.9 7 12 7 12z" />
      <circle cx="12" cy="9" r="2.5" />
    </>
  ),
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  file: (
    <>
      <path d="M6 2h8l6 6v14H6z" />
      <path d="M14 2v6h6" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="m21 16-5-5-9 9" />
    </>
  ),
  archive: (
    <>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v12h14V8M10 12h4" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2 21a7 7 0 0 1 14 0M16 4a3.5 3.5 0 0 1 0 7M22 21a6 6 0 0 0-4-5.6" />
    </>
  ),
  mountain: <path d="m3 20 6.5-11 3.5 6 2-3 6 8z" />,
  video: (
    <>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="m16 10 5-3v10l-5-3z" />
    </>
  ),
  idcard: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="11" r="2" />
      <path d="M6 16a3 3 0 0 1 6 0M14 10h4M14 13h3" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18M7 15h3" />
    </>
  ),
  shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
  wifi: (
    <>
      <path d="M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0" />
      <circle cx="12" cy="19" r="1" />
    </>
  ),
  bucket: (
    <>
      <path d="M4 7h16l-2 13H6z" />
      <ellipse cx="12" cy="7" rx="8" ry="2.5" />
    </>
  ),
  chain: (
    <>
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </>
  ),
  building: (
    <>
      <path d="M4 21V5l8-3v19M12 21h8V9l-8-2" />
      <path d="M8 8h.01M8 12h.01M8 16h.01M16 12h.01M16 16h.01" />
    </>
  ),
  checkbox: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="m8 12 3 3 5-6" />
    </>
  )
}

export type IconName = keyof typeof P

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={`sicon${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {P[name]}
    </svg>
  )
}

/** Plattform-Symbole (vereinfacht, einfarbig) für die App-Leiste. */
export function PlatformIcon({ name }: { name: 'apple' | 'android' | 'windows' | 'linux' | 'web' }) {
  if (name === 'apple')
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor">
        <path d="M16.4 12.6c0-2.5 2.1-3.7 2.2-3.8-1.2-1.7-3-2-3.7-2-1.6-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.2 2.5-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8s2 .8 3.3.8c1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9-.1 0-2.8-1-2.8-4.1zM13.9 5.2c.7-.8 1.2-2 1-3.2-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3.1 1.1.1 2.2-.6 2.9-1.4z" />
      </svg>
    )
  if (name === 'android')
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor">
        <path d="M4 5.5v13c0 .6.6 1 1.2.7L16.5 13 5.2 4.8C4.6 4.5 4 4.9 4 5.5zM17.8 12.2l2.7-1.6c.7-.4.7-1.4 0-1.8L6.9 1.5l10.9 10.7zM6.9 22.5l13.6-7.3c.7-.4.7-1.4 0-1.8l-2.7-1.6L6.9 22.5z" opacity=".9" />
      </svg>
    )
  if (name === 'windows')
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor">
        <path d="M3 5.1 10.4 4v7.2H3zM11.4 3.9 21 2.5v8.7h-9.6zM3 12.3h7.4v7.2L3 18.4zM11.4 12.3H21V21l-9.6-1.4z" />
      </svg>
    )
  if (name === 'linux')
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M12 3c-2.2 0-3.4 1.9-3.4 4.4 0 1.6-.6 2.7-1.6 4.1C5.8 13.2 5 15 5.4 17c.4 1.8 2.2 3 3.6 3 1 0 1.8-.5 3-.5s2 .5 3 .5c1.4 0 3.2-1.2 3.6-3 .4-2-.4-3.8-1.6-5.5-1-1.4-1.6-2.5-1.6-4.1C15.4 4.9 14.2 3 12 3z" />
        <circle cx="10.3" cy="8" r=".6" fill="currentColor" />
        <circle cx="13.7" cy="8" r=".6" fill="currentColor" />
        <path d="M10.6 10.2 12 11l1.4-.8" />
      </svg>
    )
  return <Icon name="globe" size={20} />
}

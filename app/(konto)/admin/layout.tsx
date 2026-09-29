import type { ReactNode } from 'react'

/** Bereich, für den das dunkle Design gilt (siehe .apptheme in globals.css). */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <div className="apptheme">{children}</div>
}

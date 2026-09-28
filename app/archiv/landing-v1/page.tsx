import type { Metadata } from 'next'
import Landing from '@/components/Landing'

/** Archiv: erste Landingpage (bis September 2026) – nicht verlinkt, nicht indexiert. */
export const metadata: Metadata = { robots: { index: false, follow: false } }

export default function LandingV1Archive() {
  return <Landing />
}

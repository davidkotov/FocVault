import { redirect } from 'next/navigation'
import { headers } from 'next/headers'

/** /v2 ist jetzt die Startseite. */
export default function LandingV2Redirect() {
  redirect(`/${headers().get('x-fv-locale') ?? 'de'}`)
}

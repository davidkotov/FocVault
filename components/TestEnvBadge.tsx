import type { Locale } from '@/lib/i18n/config'
import { commonMessages } from '@/lib/i18n/messages/common'
import { databaseHost, isTestEnv } from '@/server/shared/env'

/**
 * Leiste mit Badge oben links auf jeder Seite, wenn die Instanz mit APP_ENV=test läuft (keine
 * Produktionsdaten). Im normalen Fluss statt fixiert, damit sie keine Navigation verdeckt.
 */
export function TestEnvBadge({ locale }: { locale: Locale }) {
  if (!isTestEnv()) return null
  const m = commonMessages[locale].testEnv
  return (
    <div className="testenvbar" role="status">
      <span className="testenvbadge">{m.label}</span>
      <span className="testenvhint">
        {m.hint} · DB: {databaseHost()}
      </span>
    </div>
  )
}

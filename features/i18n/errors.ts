'use client'

import { useCallback } from 'react'
import { ApiClientError } from '@/features/api/client'
import { commonMessages } from '@/lib/i18n/messages/common'
import { formatBytes } from '@/lib/vault'
import { fmt, useI18n } from './I18nProvider'

/**
 * Fehlertext in der aktuellen Sprache. Bekannte API-Codes werden übersetzt; auf Deutsch wird die
 * (genauere) Servermeldung bevorzugt, weil der Server deutsch antwortet.
 */
export function useErrorText(): (e: unknown) => string {
  const { locale } = useI18n()
  return useCallback(
    (e: unknown) => {
      const m = commonMessages[locale].errors
      if (e instanceof DOMException && e.name === 'AbortError') return m.ABORTED
      if (e instanceof ApiClientError) {
        if (locale === 'de' && e.message) return e.message
        if (e.code === 'QUOTA_EXCEEDED' && e.details) {
          return fmt(m.QUOTA_EXCEEDED, {
            free: formatBytes(Number(e.details.freeBytes ?? 0)),
            needed: formatBytes(Number(e.details.neededBytes ?? 0))
          })
        }
        const known = (m as Record<string, string>)[e.code]
        return known ?? e.message ?? m.GENERIC
      }
      const code = (e as { code?: unknown })?.code
      if (typeof code === 'string' && code in m) return (m as Record<string, string>)[code]
      if (e instanceof Error && e.message) return e.message
      return m.GENERIC
    },
    [locale]
  )
}

'use client'

import { useAccount } from '@/features/account/AccountProvider'
import { api } from '@/features/api/client'
import { openGrantorVault } from '@/features/emergency/client'
import { fmt, useMessages } from '@/features/i18n/I18nProvider'
import { emergencyMessages } from '@/lib/i18n/messages/emergency'
import ReadOnlyVaultView from './ReadOnlyVaultView'

/** Vertrauensperson: Tresor des Inhabers nur lesen (nach Freigabe des Notfallzugangs). */
export default function EmergencyVaultView({ contactId, name, onBack }: { contactId: string; name: string; onBack: () => void }) {
  const m = useMessages(emergencyMessages)
  const { account, vault } = useAccount()
  return (
    <ReadOnlyVaultView
      title={fmt(m.vaultTitle, { name })}
      lead={m.vaultLead}
      onBack={onBack}
      fetchPieces={oid => api.emergencyDownload(contactId, oid)}
      load={async () => {
        const ov = await api.emergency()
        const c = ov.asGrantee.find(x => x.id === contactId)
        if (!c?.wrapped) throw new Error(m.gRequested.replace('{at}', c?.availableAt ?? '—'))
        if (!vault.familyKey || !account) throw new Error('Schlüsselpaar fehlt.')
        return openGrantorVault(contactId, c.wrapped, account.id, vault.familyKey.privateJwk)
      }}
    />
  )
}

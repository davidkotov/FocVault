import { EMPTY_CONTAINER, type VaultContainer } from '@/lib/vault'
import { mergeContainers } from '@/lib/merge'
import { ApiClientError, api } from '@/features/api/client'
import { decryptIndex, encryptIndex } from './index-crypto'

export interface IndexState {
  version: number
  container: VaultContainer
}

export async function loadIndex(masterKey: CryptoKey, accountId: string): Promise<IndexState> {
  const r = await api.getIndex()
  if (!r) return { version: 0, container: { ...EMPTY_CONTAINER, files: [], secrets: [] } }
  return { version: r.version, container: await decryptIndex(r.body, masterKey, accountId) }
}

/**
 * Speichert `next` auf Basis von `base`. Bei VERSION_CONFLICT (anderes Gerät war schneller):
 * aktuellen Stand laden, 3-Wege-Merge, erneut versuchen.
 */
export async function saveIndex(
  masterKey: CryptoKey,
  accountId: string,
  base: IndexState,
  next: VaultContainer
): Promise<IndexState> {
  let b = base
  let n = next
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const { version } = await api.putIndex(b.version, await encryptIndex(n, masterKey, accountId))
      return { version, container: n }
    } catch (e) {
      if (!(e instanceof ApiClientError && e.code === 'VERSION_CONFLICT')) throw e
      const remote = await loadIndex(masterKey, accountId)
      n = mergeContainers(b.container, n, remote.container)
      b = remote
    }
  }
  throw new Error('Tresor konnte nicht synchronisiert werden – zu viele gleichzeitige Änderungen.')
}

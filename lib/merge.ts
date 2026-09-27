import type { SecretEntry, TrashEntry, VaultContainer, VaultEntry } from './vault'

/**
 * 3-Wege-Merge für den Tresor-Index (mehrere Geräte).
 * base   = Stand, von dem die lokale Änderung ausging
 * local  = lokaler Stand
 * remote = neuerer Stand auf dem Server
 * Regeln: beide geändert → neuerer Zeitstempel gewinnt; auf einer Seite gelöscht und auf der
 * anderen unverändert → gelöscht; gelöscht vs. nach `base` geändert → Änderung gewinnt.
 */
export function merge3<T extends { id: string }>(base: T[], local: T[], remote: T[], stamp: (t: T) => number): T[] {
  const B = new Map(base.map(x => [x.id, x]))
  const L = new Map(local.map(x => [x.id, x]))
  const R = new Map(remote.map(x => [x.id, x]))
  const out: T[] = []
  for (const id of new Set([...L.keys(), ...R.keys()])) {
    const b = B.get(id)
    const l = L.get(id)
    const r = R.get(id)
    if (l && r) out.push(stamp(l) >= stamp(r) ? l : r)
    else if (l) {
      if (!b || stamp(l) > stamp(b)) out.push(l)
    } else if (r) {
      if (!b || stamp(r) > stamp(b)) out.push(r)
    }
  }
  return out.sort((x, y) => stamp(y) - stamp(x))
}

export function mergeContainers(base: VaultContainer, local: VaultContainer, remote: VaultContainer): VaultContainer {
  return {
    v: 3,
    files: merge3<VaultEntry>(base.files, local.files, remote.files, f => f.storedAt),
    secrets: merge3<SecretEntry>(base.secrets, local.secrets, remote.secrets, s => s.updatedAt),
    trash: merge3<TrashEntry>(base.trash ?? [], local.trash ?? [], remote.trash ?? [], t => t.trashedAt),
    // Schlüsselpaar: einmal erzeugt; bei Gleichstand gewinnt der Server-Stand (den kennen die anderen schon)
    ...((remote.familyKey ?? local.familyKey) ? { familyKey: remote.familyKey ?? local.familyKey } : {})
  }
}

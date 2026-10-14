/**
 * Datentypen für Drag & Drop in der App – an einer Stelle, damit Dateiliste,
 * Tresor-Listen und der Status-Block in der Seitenleiste dieselben Formate sprechen.
 */

/** Gezogene Dateien aus „Meine Cloud“ (IDs als JSON-Array) */
export const DRAG_MIME = 'application/x-focvault-files'
/** Gezogener Ordner (Pfad mit „/“ am Ende) */
export const DIR_MIME = 'application/x-focvault-dir'
/** Gezogene Tresor-Einträge: Passwörter, Notizen, 2FA (IDs als JSON-Array) */
export const SECRET_MIME = 'application/x-focvault-secrets'

/** IDs aus einem Drop lesen – fremde Daten ergeben eine leere Liste. */
export function idsFrom(dt: DataTransfer, mime: string): string[] {
  try {
    const ids = JSON.parse(dt.getData(mime)) as unknown
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/**
 * Tresor-Einträge (Passwörter, Notizen, 2FA) ziehbar machen – Ziel ist der Papierkorb
 * im Status-Block der Seitenleiste.
 */
export function secretDragProps(ids: string[], label: string) {
  return {
    draggable: true,
    onDragStart: (ev: { dataTransfer: DataTransfer }) => {
      ev.dataTransfer.setData(SECRET_MIME, JSON.stringify(ids))
      ev.dataTransfer.setData('text/plain', label)
      ev.dataTransfer.effectAllowed = 'move'
      document.body.classList.add('fv-dragging')
    },
    onDragEnd: () => document.body.classList.remove('fv-dragging')
  }
}

/** Mini-IndexedDB-Helfer: speichert Datei-Bruchteile (Blobs) für den
 *  Download-Fallback ohne File System Access API – ohne RAM-Kumulation. */

const DB_NAME = 'focvault-download'
const STORE = 'parts'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function clearParts(jobId: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(jobId)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error)
    }
  })
}

export async function savePart(jobId: string, index: number, blob: Blob): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(blob, `${jobId}:${index}`)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error)
    }
  })
}

export async function listPartKeys(jobId: string): Promise<number[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const os = tx.objectStore(STORE)
    const keys: number[] = []
    const req = os.openCursor()
    req.onsuccess = () => {
      const cursor = req.result
      if (cursor) {
        const k = String(cursor.key)
        if (k.startsWith(`${jobId}:`)) keys.push(Number(k.slice(jobId.length + 1)))
        cursor.continue()
      }
    }
    tx.oncomplete = () => {
      db.close()
      resolve(keys.sort((a, b) => a - b))
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error)
    }
  })
}

export async function getPart(jobId: string, index: number): Promise<Blob | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(`${jobId}:${index}`)
    req.onsuccess = () => {
      db.close()
      resolve((req.result as Blob) ?? null)
    }
    req.onerror = () => {
      db.close()
      reject(req.error)
    }
  })
}
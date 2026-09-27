/** Welche Dateien sich im Browser anzeigen lassen (nach Typ, sonst Dateiendung). */
export type PreviewKind = 'image' | 'pdf' | 'video' | 'audio' | 'text'

const EXT: Record<string, { kind: PreviewKind; mime: string }> = {
  jpg: { kind: 'image', mime: 'image/jpeg' },
  jpeg: { kind: 'image', mime: 'image/jpeg' },
  png: { kind: 'image', mime: 'image/png' },
  gif: { kind: 'image', mime: 'image/gif' },
  webp: { kind: 'image', mime: 'image/webp' },
  avif: { kind: 'image', mime: 'image/avif' },
  svg: { kind: 'image', mime: 'image/svg+xml' },
  pdf: { kind: 'pdf', mime: 'application/pdf' },
  mp4: { kind: 'video', mime: 'video/mp4' },
  webm: { kind: 'video', mime: 'video/webm' },
  mov: { kind: 'video', mime: 'video/quicktime' },
  mp3: { kind: 'audio', mime: 'audio/mpeg' },
  m4a: { kind: 'audio', mime: 'audio/mp4' },
  wav: { kind: 'audio', mime: 'audio/wav' },
  ogg: { kind: 'audio', mime: 'audio/ogg' },
  txt: { kind: 'text', mime: 'text/plain' },
  md: { kind: 'text', mime: 'text/plain' },
  csv: { kind: 'text', mime: 'text/plain' },
  json: { kind: 'text', mime: 'text/plain' },
  log: { kind: 'text', mime: 'text/plain' }
}

/** Obergrenzen: Vorschau entschlüsselt in den Arbeitsspeicher. */
export const PREVIEW_MAX: Record<PreviewKind, number> = {
  image: 60e6,
  pdf: 120e6,
  video: 400e6,
  audio: 200e6,
  text: 2e6
}

export function previewInfo(name: string, type: string): { kind: PreviewKind; mime: string } | null {
  const t = (type || '').toLowerCase()
  if (t.startsWith('image/')) return { kind: 'image', mime: t }
  if (t === 'application/pdf') return { kind: 'pdf', mime: t }
  if (t.startsWith('video/')) return { kind: 'video', mime: t }
  if (t.startsWith('audio/')) return { kind: 'audio', mime: t }
  if (t.startsWith('text/') || t === 'application/json') return { kind: 'text', mime: 'text/plain' }
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return EXT[ext] ?? null
}

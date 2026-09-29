/** Helles/dunkles Design der App (Dashboard, Admin). Die Wahl liegt im Cookie, damit der Server gleich richtig rendert. */
export type Theme = 'light' | 'dark'
export const THEME_COOKIE = 'fv_theme'

export function isTheme(v: unknown): v is Theme {
  return v === 'light' || v === 'dark'
}

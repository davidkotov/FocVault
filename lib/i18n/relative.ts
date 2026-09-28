/** „heute 09:02“, „gestern“, „vor 3 Tagen“ – danach das Datum. */
export function relativeDay(ts: number, locale: string, now = Date.now()): string {
  const startOf = (t: number) => new Date(new Date(t).toDateString()).getTime()
  const d = Math.round((startOf(ts) - startOf(now)) / 86_400_000)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (d === 0) return `${rtf.format(0, 'day')} ${new Date(ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`
  if (Math.abs(d) < 30) return rtf.format(d, 'day')
  return new Date(ts).toLocaleDateString(locale)
}

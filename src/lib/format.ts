// Kurze, deutsche relative Zeitangabe fuer "zuletzt bearbeitet"-Anzeigen. Faellt ab einer
// Woche auf ein festes Datum zurueck, weil "vor 14 Tagen" ab dort weniger nuetzlich ist als
// einfach zu sehen, wann genau.
export function formatRelativeTime(ms: number): string {
  const diffMs = Date.now() - ms
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'gerade eben'
  if (minutes < 60) return `vor ${minutes} Min.`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `vor ${hours} Std.`
  const days = Math.floor(hours / 24)
  if (days < 7) return `vor ${days} Tag${days === 1 ? '' : 'en'}`
  return new Date(ms).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

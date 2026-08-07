// Erzwingt eine garantiert frische Ladung der App: raeumt Service-Worker/Caches auf (falls
// jemals welche aktiv waren) und laedt dann ueber eine cache-gebustete URL neu - das umgeht
// auch den serverseitigen Cache-Control: max-age=600 auf index.html von GitHub Pages, der
// einen normalen Reload sonst noch bis zu 10 Minuten aus dem Cache bedienen kann. Besonders
// bei als Home-Bildschirm-App installierten iPad-Nutzung reicht ein simples Neuladen/
// Neustarten der App oft nicht aus.
export async function forceUpdate(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((r) => r.unregister()))
    }
  } catch {
    // ignorieren, unten wird trotzdem neu geladen
  }
  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
    }
  } catch {
    // ignorieren
  }
  const url = new URL(window.location.href)
  url.searchParams.set('_refresh', Date.now().toString())
  window.location.replace(url.toString())
}

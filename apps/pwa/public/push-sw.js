// Importado pelo service worker do vite-plugin-pwa (workbox.importScripts em vite.config.ts).
// A Edge Function notificar manda { titulo, corpo, url, tag }.

self.addEventListener('push', (event) => {
  let aviso = {}
  try {
    aviso = event.data ? event.data.json() : {}
  } catch {
    aviso = { corpo: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(aviso.titulo || 'Profit', {
      body: aviso.corpo || '',
      icon: '/pwa-192x192.png',
      badge: '/pwa-64x64.png',
      tag: aviso.tag,
      lang: 'pt-BR',
      data: { url: aviso.url || '/dashboard' },
    }),
  )
})

// Toque na notificação: foca o app se já estiver aberto, senão abre na tela do aviso
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const destino = new URL(event.notification.data?.url || '/dashboard', self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((janelas) => {
      const aberta = janelas.find((j) => new URL(j.url).origin === self.location.origin)
      if (aberta) return aberta.focus().then((j) => j.navigate(destino))
      return self.clients.openWindow(destino)
    }),
  )
})

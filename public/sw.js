self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {}
  const title = data.title || 'New Edit Submitted'
  const options = {
    body: data.body || 'An editor has submitted a video for review.',
    icon: '/palm-icon.png',
    badge: '/palm-icon.png',
    data: { url: data.url || '/admin/editor' },
    requireInteraction: true,
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/admin/editor'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes('/admin') && 'focus' in client) {
          client.focus()
          return
        }
      }
      return clients.openWindow(url)
    })
  )
})

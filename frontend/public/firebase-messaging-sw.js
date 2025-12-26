self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }

  const title =
    data.notification?.title ||
    data.data?.title ||
    'Notification'
  const options = {
    body: data.notification?.body || data.data?.body || '',
    data: {
      url: data.notification?.click_action || data.data?.url || null,
    },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification?.data?.url
  if (!url) return
  event.waitUntil(self.clients.openWindow(url))
})

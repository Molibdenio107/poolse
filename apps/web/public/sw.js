/*
 * Poolse's service worker — POOLSE-90 slice 4. Push and the tap on a
 * notification, and NOTHING else.
 *
 * No `fetch` handler, on purpose: a worker that caches pages serves yesterday's
 * deploy, and offline is out of scope. A notification carries `{ title, body,
 * url }`; tapping it focuses an open Poolse tab on that page, or opens one.
 */

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Poolse', body: event.data ? event.data.text() : '' };
  }
  const title = typeof data.title === 'string' && data.title !== '' ? data.title : 'Poolse';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body : '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/app' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data && event.notification.data.url ? event.notification.data.url : '/app', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          return client.navigate(url).then((navigated) => (navigated || client).focus());
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

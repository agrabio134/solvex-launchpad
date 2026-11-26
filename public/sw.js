/* Flip service worker: makes the site installable and opens instantly.
   App code (hashed /assets files) is cached; pages are network-first with the cached shell as fallback.
   API calls, RPC and anything cross-origin are never cached: prices and balances are always live. */
const VERSION = 'flip-v1'
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/logo.png', '/favicon.png']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  // page loads: always try the network, fall back to the cached app shell when offline
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(VERSION).then((c) => c.put('/', copy))
          return res
        })
        .catch(() => caches.match('/')),
    )
    return
  }

  // hashed build files never change: cache first
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(VERSION).then((c) => c.put(req, copy))
            }
            return res
          }),
      ),
    )
  }
})

const BASE = '/circuit-diagram-studio/'
const PREFIX = 'metaborin/circuit-diagram-studio/'
const VERSION = '__BUILD_VERSION__'
const CACHE = PREFIX + VERSION
const PRECACHE = /*__PRECACHE__*/ []
const paths = new Set(PRECACHE)
const complete = async cache => (await Promise.all(PRECACHE.map(url => cache.match(url)))).every(Boolean)
const prepare = cache => cache.addAll(PRECACHE.map(url => new Request(url, { cache: 'reload' })))

// All built assets are required. A failed installation leaves the previous worker active.
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(prepare))
})

// Deliberately no skipWaiting: an editing tab must keep its current application version.
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Storage may have been evicted while this worker was waiting for editing tabs.
    // Keep the previous cache and do not claim clients unless the new build is complete.
    if (!await complete(await caches.open(CACHE))) throw new Error('Offline assets are incomplete')
    const names = await caches.keys()
    await Promise.all(names.filter(name => name !== CACHE && name.startsWith(PREFIX)
      && /^[a-f0-9]{20}$/.test(name.slice(PREFIX.length))).map(name => caches.delete(name)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return
  // Read only this version's cache. Unknown resources never receive HTML as a fallback.
  const asset = request.mode === 'navigate' ? BASE + 'index.html' : url.pathname
  if (!paths.has(asset)) return
  event.respondWith(caches.open(CACHE).then(async cache =>
    (await cache.match(asset)) || fetch(request)))
})

self.addEventListener('message', event => {
  if (event.data?.type !== 'CHECK_OFFLINE_READY' || !event.ports[0]) return
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    let ready = await complete(cache)
    if (!ready) {
      // Repair browser-evicted assets on an online revisit without changing the saved diagram.
      // addAll is atomic; network failure leaves existing responses available.
      try { await prepare(cache); ready = await complete(cache) } catch { /* Remain not ready. */ }
    }
    event.ports[0].postMessage({ type: 'OFFLINE_READY', ready, version: VERSION })
  })())
})

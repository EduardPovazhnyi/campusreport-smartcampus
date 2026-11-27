const CACHE_NAME = 'campusreport-v1';
const CACHE_PREFIX = 'campusreport-';

const CORE_ASSETS = [
    '/',
    '/manifest.json',
    '/icon-192.png',
    '/icon-512.png'
];

// Install and cache the core application resources.
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(CORE_ASSETS);
        })
    );
});

// Remove outdated CampusReport caches.
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys
                    .filter((key) =>
                        key.startsWith(CACHE_PREFIX) &&
                        key !== CACHE_NAME
                    )
                    .map((key) => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
});

// Network-first strategy with offline fallback.
self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);

    // Exclude external APIs and deployment health checks.
    if (
        request.method !== 'GET' ||
        url.origin !== self.location.origin ||
        url.pathname === '/health.json' ||
        url.pathname === '/service-worker.js'
    ) {
        return;
    }

    event.respondWith(
        (async () => {
            const cache = await caches.open(CACHE_NAME);

            try {
                const response = await fetch(request);

                if (response.ok) {
                    await cache.put(request, response.clone());
                }

                return response;
            } catch {
                const cachedResponse = await cache.match(request);

                if (cachedResponse) {
                    return cachedResponse;
                }

                if (request.mode === 'navigate') {
                    const fallback = await cache.match('/');

                    if (fallback) {
                        return fallback;
                    }
                }

                return Response.error();
            }
        })()
    );
});
// Service Worker: Offline-Cache für App-Dateien, Datendateien und die FSRS-Bibliothek.
// Bei Änderungen an der App CACHE_VERSION erhöhen, damit alte Caches ersetzt werden.
const CACHE_VERSION = 'v4';
const CACHE_NAME = `spanisch-trainer-${CACHE_VERSION}`;
const TS_FSRS_CDN_URL = 'https://cdn.jsdelivr.net/npm/ts-fsrs@5.4.2/+esm';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/data.js',
  './js/fsrs-lib.js',
  './js/migrate.js',
  './js/parser.js',
  './js/scheduler.js',
  './js/speech.js',
  './js/storage.js',
  './js/util.js',
  './js/views/home.js',
  './js/views/study.js',
  './js/views/browse.js',
  './js/views/settings.js',
  './js/views/stats.js',
  './lib/ts-fsrs.js',
  './data/index.json',
];
// Nicht kritisch für den Betrieb: Fehlen darf die Installation nicht verhindern.
const OPTIONAL = ['./icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-512-maskable.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(APP_SHELL);
      await Promise.all(OPTIONAL.map((u) => cache.add(u).catch((e) => console.warn('SW: optional nicht gecacht', u, e))));
      // Datendateien laut index.json
      try {
        const res = await fetch('./data/index.json', { cache: 'no-cache' });
        const list = await res.json();
        if (Array.isArray(list)) {
          await Promise.all(
            list.map((name) => cache.add(`./data/${encodeURIComponent(name)}`).catch((e) => console.warn('SW: Datei nicht gecacht', name, e))),
          );
        }
      } catch (e) {
        console.warn('SW: index.json nicht lesbar', e);
      }
      // CDN-Modul (optional – lokale Kopie ist ohnehin im Shell-Cache)
      try {
        await cache.add(new Request(TS_FSRS_CDN_URL, { mode: 'cors' }));
      } catch (e) {
        console.info('SW: CDN-Modul nicht gecacht (lokale Kopie wird genutzt)');
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('spanisch-trainer-') && k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: false });
  const network = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => null);
  if (cached) {
    network.catch(() => {});
    return cached;
  }
  const res = await network;
  if (res) return res;
  return new Response('Offline und nicht im Cache', { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

/** CDN-Modul: Cache zuerst, dann Netz; ohne beides die lokale ts-fsrs-Kopie ausliefern. */
async function cdnModule(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      cache.put(request, res.clone()).catch(() => {});
      return res;
    }
  } catch (e) {
    /* Netz nicht erreichbar */
  }
  const local = await cache.match('./lib/ts-fsrs.js');
  return local || new Response('', { status: 503, statusText: 'Offline' });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (req.mode === 'navigate') {
    // App-Shell: index.html aus dem Cache, im Hintergrund aktualisieren.
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = (await cache.match('./index.html')) || (await cache.match('./'));
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok) {
              cache.put('./index.html', res.clone()).catch(() => {});
            }
            return res;
          })
          .catch(() => null);
        if (cached) {
          network.catch(() => {});
          return cached;
        }
        const res = await network;
        return res || new Response('Offline', { status: 503, statusText: 'Offline' });
      })(),
    );
    return;
  }

  if (isSameOrigin(url)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }
  if (req.url === TS_FSRS_CDN_URL) {
    event.respondWith(cdnModule(req));
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

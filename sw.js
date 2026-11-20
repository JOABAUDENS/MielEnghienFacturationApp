// Service worker : met toute l'application en cache pour un fonctionnement hors ligne.
// À chaque publication : incrémenter VERSION (et VERSION_APP dans js/etat.js).
const VERSION = '1.4.1';
const CACHE = `miel-enghien-${VERSION}`;

const FICHIERS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'vendor/qrcode.js',
  'js/app.js',
  'js/etat.js',
  'js/db.js',
  'js/epc.js',
  'js/money.js',
  'js/panier.js',
  'js/stock.js',
  'js/clients.js',
  'js/ticket.js',
  'js/chargement.js',
  'js/journal.js',
  'js/sync.js',
  'js/views/vente.js',
  'js/views/paiement.js',
  'js/views/historique.js',
  'js/views/stock.js',
  'js/views/clients.js',
  'js/views/reglages.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' contourne le cache HTTP du navigateur pour charger la vraie nouvelle version.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((c) => c.startsWith('miel-enghien-') && c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

// La nouvelle version ne prend la main que lorsque l'utilisateur touche « Recharger ».
self.addEventListener('message', (e) => {
  if (e.data === 'activer') self.skipWaiting();
});

// Cache d'abord : l'application ne dépend jamais du réseau pour s'afficher.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((enCache) => enCache || fetch(e.request)),
  );
});

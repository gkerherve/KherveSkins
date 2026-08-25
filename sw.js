// What makes this an app on a phone rather than a page you have to be online
// for. Add to Home Screen, and then it opens on a train.
//
// Two rules, and they pull in opposite directions on purpose:
//
//   our own files    network first, cache as a backup. Editing a module and
//                    reloading has to show the edit; a service worker that
//                    serves yesterday's app is a day lost to a bug that was
//                    fixed before lunch.
//   Three.js         cache first. It is a megabyte from a CDN that never
//                    changes for a given version, and it is the one thing
//                    that stops this working with no signal.

const CACHE = 'kherveskins-v3';
const THREE = 'https://unpkg.com/three@0.160.0/build/three.module.js';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './js/app.js',
  './js/layout.js',
  './js/pixels.js',
  './js/photo.js',
  './js/generate.js',
  './js/model.js',
  './js/cropper.js',
  './js/paint.js',
  './js/store.js',
  './js/wardrobe.js',
  './js/doll.js',
  './js/carve.js',
  './js/voxel.js',
  './js/fit.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  THREE,
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // one file missing must not fail the whole install
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin !== location.origin) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })),
    );
    return;
  }

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))),
  );
});

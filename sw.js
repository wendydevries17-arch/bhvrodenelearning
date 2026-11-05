/* BHV Roden: kleine service worker. Altijd eerst het netwerk, zodat er
   nooit een oude versie blijft hangen. Alleen zonder internet tonen we
   een nette pagina met 112. */
var CACHE = "bhv-offline-v1";
var BEWAAR = ["/offline.html", "/img/app/icon-192.png"];
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(BEWAAR); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (k) {
    return Promise.all(k.filter(function (n) { return n !== CACHE; }).map(function (n) { return caches.delete(n); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(function () { return caches.match("/offline.html"); }));
});

/* Service worker: lets the app open without internet.
   App files are fetched from the network first (so updates arrive at once) and fall back
   to the saved copy when offline. Fonts are kept once downloaded. data.json is not handled
   here - the page keeps its own last copy. */
const CACHE = "society-app-v11";
const SHELL = ["./", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function keep(request, resp) {
  if (resp.ok || resp.type === "opaque") {
    const copy = resp.clone();
    caches.open(CACHE).then(c => c.put(request, copy));
  }
  return resp;
}

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => keep(e.request, r))));
    return;
  }
  if (url.origin !== location.origin || url.pathname.endsWith("data.json")) return;
  e.respondWith(
    fetch(e.request).then(resp => keep(e.request, resp))
      .catch(() => caches.match(e.request, { ignoreSearch: true })
        .then(hit => hit || (e.request.mode === "navigate" ? caches.match("./") : Response.error())))
  );
});

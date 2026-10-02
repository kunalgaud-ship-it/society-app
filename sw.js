/* Service worker: lets the app open without internet.
   App files are fetched from the network first (so updates arrive at once) and fall back
   to the saved copy when offline. Fonts are kept once downloaded. data.json is not handled
   here - the page keeps its own last copy. Also shows the payment notifications. */
const CACHE = "society-app-v18";
const STATE = "society-state";          // written by the page: flat, last seen payments, passcode
const SHELL = ["./", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== STATE).map(k => caches.delete(k))))
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
  if (url.origin !== location.origin || url.pathname.endsWith("data.json") || url.pathname.endsWith("inbox.json")) return;
  e.respondWith(
    fetch(e.request).then(resp => keep(e.request, resp))
      .catch(() => caches.match(e.request, { ignoreSearch: true })
        .then(hit => hit || (e.request.mode === "navigate" ? caches.match("./") : Response.error())))
  );
});

/* Payment notifications. The page shows them whenever it loads new data; on Android an
   installed app is also woken now and then (periodic sync) to look while it is closed. */
function b64(s) { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
async function decrypt(enc, pass) {
  const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64(enc.salt), iterations: enc.iter, hash: "SHA-256" }, km, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(enc.iv) }, key, b64(enc.ct))));
}
function money(v, lang) {
  const s = "₹" + Math.round(v).toLocaleString("en-IN");
  return lang === "mr" ? s.replace(/\d/g, d => "०१२३४५६७८९"[d]) : s;
}

async function checkPayments() {
  try {
    const store = await caches.open(STATE), hit = await store.match("pay-state");
    const st = hit ? await hit.json() : null;
    if (!st || !st.on || Notification.permission !== "granted") return;
    const resp = await fetch("data.json?t=" + Date.now(), { cache: "no-store" });
    if (!resp.ok) return;
    const data = await decrypt(await resp.json(), st.pass);
    const flat = data.flats.find(f => String(f.no) === String(st.flat));
    if (!flat) return;
    try {                                 // payments the committee entered on the phone, not yet in data.json
      const box = await fetch("inbox.json?t=" + Date.now(), { cache: "no-store" });
      if (box.ok) for (const o of (await decrypt(await box.json(), st.pass)).ops || [])
        if (o.type === "payment" && String(o.flat) === String(st.flat) && !(data.applied || []).includes(o.id)) flat.paid[o.month] = +o.amount || 0;
    } catch (e) { /* no inbox */ }
    const got = data.year === st.year
      ? flat.paid.map((v, m) => ({ m, a: v - (st.paid[m] || 0) })).filter(x => x.a > 0) : [];
    await store.put("pay-state", new Response(JSON.stringify({ ...st, year: data.year, paid: flat.paid })));
    if (!got.length) return;
    const body = got.map(x => st.body.replace("{m}", st.mons[x.m]).replace("{a}", money(x.a, st.lang))).join("\n");
    await self.registration.showNotification(st.title, { body, icon: "icon-192.png", badge: "icon-192.png", tag: "pay",
      data: { url: self.registration.scope + "#k=" + st.pass } });
  } catch (e) { /* no internet or a new passcode: the page reports it on the next open */ }
}

self.addEventListener("periodicsync", e => {
  if (e.tag === "pay-check") e.waitUntil(checkPayments());
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data || {}).url || self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true })
    .then(list => list.length ? list[0].focus() : self.clients.openWindow(url)));
});

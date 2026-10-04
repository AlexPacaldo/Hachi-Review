const CACHE_VERSION = "review-hub-v9";
const APP_SHELL = [
  "./",
  "./index.html",
  "./home",
  "./about",
  "./contact",
  "./privacy",
  "./terms",
  "./offline.html",
  "./manifest.webmanifest",
  "./icon.png"
];

async function cacheUrls(cache, urls) {
  await Promise.all(
    urls.map(async (url) => {
      try {
        await cache.add(url);
      } catch {
        // Optional shell files should not prevent service worker installation.
      }
    })
  );
}

async function cacheAppShell() {
  const cache = await caches.open(CACHE_VERSION);
  await cacheUrls(cache, APP_SHELL);

  try {
    const indexResponse = await fetch("./index.html", { cache: "no-store" });
    const indexHtml = await indexResponse.clone().text();
    await cache.put("./index.html", indexResponse);

    // Every route is served the same SPA shell, so the landing page, the app
    // home, and the public legal pages can all be answered offline from one
    // copy of index.html without waiting on the network.
    const shellResponse = () => new Response(indexHtml, { headers: { "Content-Type": "text/html" } });
    await Promise.all(
      ["./", "./home", "./about", "./contact", "./privacy", "./terms"].map((url) => cache.put(url, shellResponse()))
    );

    const assetUrls = [...indexHtml.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((url) => url.includes("/assets/"))
      .map((url) => new URL(url, self.registration.scope).toString());

    await cacheUrls(cache, assetUrls);
  } catch {
    // A later online visit can refresh the app shell.
  }
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);

  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await caches.match(request)) || caches.match("./index.html") || caches.match("./offline.html");
  }
}

async function cacheFirst(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) return cachedResponse;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_VERSION);
    await cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cachedResponse = await caches.match(request);
  const fetchPromise = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(CACHE_VERSION);
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cachedResponse);

  return cachedResponse || fetchPromise;
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheAppShell());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.includes("/assets/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

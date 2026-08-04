const CACHE_PREFIX = "jan-staff-clock-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const SHELL_URLS = ["/clock", "/brand/jan-logo.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME,
            )
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isExcludedPath(pathname) {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/attendance") ||
    pathname.startsWith("/payroll") ||
    pathname.startsWith("/compliance")
  );
}

function isStaticShellAsset(pathname) {
  return (
    pathname.startsWith("/_next/static/") || pathname.startsWith("/brand/")
  );
}

async function networkFirstClock(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put("/clock", response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match("/clock");
    if (cached) {
      return cached;
    }
    return new Response("Staff Clock is unavailable while offline.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

async function cacheFirstStatic(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isExcludedPath(url.pathname)) {
    return;
  }

  if (
    request.mode === "navigate" &&
    (url.pathname === "/clock" || url.pathname.startsWith("/clock/"))
  ) {
    event.respondWith(networkFirstClock(request));
    return;
  }

  if (isStaticShellAsset(url.pathname)) {
    event.respondWith(cacheFirstStatic(request));
  }
});

self.addEventListener("sync", (event) => {
  if (event.tag !== "jan-staff-clock-sync") {
    return;
  }
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: "OFFLINE_SYNC_REQUESTED" });
        }
      }),
  );
});

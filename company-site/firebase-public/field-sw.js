/* global self, caches, fetch */

"use strict";

const CACHE_PREFIX = "bring-field-shell-";
const CACHE_NAME = "bring-field-shell-v4";
const FIELD_SHELL = "/field";
const PRECACHE_URLS = [
  FIELD_SHELL,
  "/field/manifest.webmanifest",
  "/field-icons/icon-192.png",
  "/field-icons/icon-512.png",
];
const SAFE_STATIC_URLS = new Set(PRECACHE_URLS.slice(1));
const SAFE_STATIC_ROOTS = ["/_next/static/", "/assets/"];
const SAFE_STATIC_DESTINATIONS = new Set([
  "script",
  "style",
  "font",
  "worker",
  "manifest",
]);
const SAFE_STATIC_EXTENSION = /\.(?:css|js|mjs|woff|woff2|ttf|otf)$/iu;
const PROTECTED_PATH_PREFIXES = [
  "/field-media-finalized",
  "/field-media",
  "/__/auth",
  "/api/",
];
const REMOTE_SERVICE_HOST_SUFFIXES = [
  "firebaseio.com",
  "firebasedatabase.app",
  "firebasestorage.app",
  "googleapis.com",
  "google.com",
  "gstatic.com",
];

function isProtectedPath(pathname) {
  return PROTECTED_PATH_PREFIXES.some((prefix) => (
    pathname === prefix
    || pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`)
  ));
}

function isRemoteServiceHost(url) {
  return url.origin !== self.location.origin
    && REMOTE_SERVICE_HOST_SUFFIXES.some((suffix) => (
      url.hostname === suffix || url.hostname.endsWith(`.${suffix}`)
    ));
}

function shouldBypass(request, url) {
  return request.method !== "GET"
    || isRemoteServiceHost(url)
    || url.origin !== self.location.origin
    || request.headers.has("Authorization")
    || url.search.length > 0
    || isProtectedPath(url.pathname);
}

function isFieldNavigation(request, url) {
  return request.mode === "navigate"
    && (url.pathname === "/field" || url.pathname.startsWith("/field/"));
}

function isSafeStaticAsset(request, url) {
  if (SAFE_STATIC_URLS.has(url.pathname)) return true;
  return SAFE_STATIC_ROOTS.some((root) => url.pathname.startsWith(root))
    && SAFE_STATIC_DESTINATIONS.has(request.destination)
    && SAFE_STATIC_EXTENSION.test(url.pathname);
}

async function networkFirstFieldNavigation(request) {
  try {
    return await fetch(request);
  } catch (error) {
    const fallback = await caches.match(FIELD_SHELL);
    if (fallback) return fallback;
    throw error;
  }
}

async function cacheFirstStaticAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)),
      self.skipWaiting(),
    ]),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((names) => Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      )),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (shouldBypass(request, url)) return;

  if (isFieldNavigation(request, url)) {
    event.respondWith(networkFirstFieldNavigation(request));
    return;
  }

  if (isSafeStaticAsset(request, url)) {
    event.respondWith(cacheFirstStaticAsset(request));
  }
});

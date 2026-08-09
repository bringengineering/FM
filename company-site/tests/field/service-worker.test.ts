import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import FieldServiceWorker from "../../app/field/components/FieldServiceWorker";

type WorkerListener = (event: Record<string, unknown>) => void;

interface WorkerHarness {
  listeners: Map<string, WorkerListener>;
  fetch: ReturnType<typeof vi.fn>;
  cacheMatch: ReturnType<typeof vi.fn>;
  cachePut: ReturnType<typeof vi.fn>;
  cacheAddAll: ReturnType<typeof vi.fn>;
  cacheDelete: ReturnType<typeof vi.fn>;
}

const originalServiceWorker = Object.getOwnPropertyDescriptor(
  navigator,
  "serviceWorker",
);

afterEach(() => {
  if (originalServiceWorker) {
    Object.defineProperty(navigator, "serviceWorker", originalServiceWorker);
  } else {
    Reflect.deleteProperty(navigator, "serviceWorker");
  }
});

async function workerSource(): Promise<string> {
  return readFile(resolve("public/field-sw.js"), "utf8");
}

async function createWorkerHarness(): Promise<WorkerHarness> {
  const listeners = new Map<string, WorkerListener>();
  const cachePut = vi.fn(async () => undefined);
  const cacheAddAll = vi.fn(async () => undefined);
  const cacheMatch = vi.fn(async (request: string | { url?: string }) => {
    const key = typeof request === "string" ? request : request.url;
    return key === "/field" ? { source: "cached-field-shell" } : undefined;
  });
  const cacheDelete = vi.fn(async () => true);
  const caches = {
    open: vi.fn(async () => ({
      addAll: cacheAddAll,
      match: cacheMatch,
      put: cachePut,
    })),
    match: cacheMatch,
    keys: vi.fn(async () => [
      "bring-field-shell-v0",
      "bring-field-shell-v1",
      "unrelated-cache",
    ]),
    delete: cacheDelete,
  };
  const fetch = vi.fn();
  const worker = {
    location: { origin: "https://bring.test" },
    addEventListener(type: string, listener: WorkerListener) {
      listeners.set(type, listener);
    },
  };

  const evaluate = new Function("self", "caches", "fetch", await workerSource());
  evaluate(worker, caches, fetch);
  return {
    listeners,
    fetch,
    cacheMatch,
    cachePut,
    cacheAddAll,
    cacheDelete,
  };
}

function request(
  url: string,
  overrides: Partial<{
    method: string;
    mode: string;
    destination: string;
    authorization: boolean;
  }> = {},
) {
  return {
    url,
    method: overrides.method ?? "GET",
    mode: overrides.mode ?? "same-origin",
    destination: overrides.destination ?? "",
    headers: {
      has(name: string) {
        return name.toLowerCase() === "authorization"
          && Boolean(overrides.authorization);
      },
    },
  };
}

function dispatchFetch(
  harness: WorkerHarness,
  workerRequest: ReturnType<typeof request>,
): Promise<unknown> | undefined {
  let response: Promise<unknown> | undefined;
  harness.listeners.get("fetch")?.({
    request: workerRequest,
    respondWith(value: Promise<unknown>) {
      response = Promise.resolve(value);
    },
  });
  return response;
}

describe("FieldServiceWorker registration", () => {
  it("registers the field worker once with the narrow /field/ scope", async () => {
    const register = vi.fn(async () => ({ scope: "https://bring.test/field/" }));
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register },
    });

    render(createElement(FieldServiceWorker));

    await waitFor(() => expect(register).toHaveBeenCalledOnce());
    expect(register).toHaveBeenCalledWith("/field-sw.js", { scope: "/field/" });
  });

  it("does nothing when the browser has no service worker support", async () => {
    Reflect.deleteProperty(navigator, "serviceWorker");

    const view = render(createElement(FieldServiceWorker));

    await Promise.resolve();
    expect(view.container).toBeEmptyDOMElement();
  });

  it("is mounted by FieldApp without update or reload loops", async () => {
    const fieldApp = await readFile(resolve("app/field/FieldApp.tsx"), "utf8");
    const registration = await readFile(
      resolve("app/field/components/FieldServiceWorker.tsx"),
      "utf8",
    );

    expect(fieldApp).toContain("<FieldServiceWorker />");
    expect(registration).not.toMatch(/\.update\s*\(|location\.reload\s*\(/u);
  });
});

describe("field service worker cache boundary", () => {
  it("pre-caches only the field shell assets and removes old owned caches", async () => {
    const harness = await createWorkerHarness();
    let installWork: Promise<unknown> | undefined;
    harness.listeners.get("install")?.({
      waitUntil(value: Promise<unknown>) {
        installWork = Promise.resolve(value);
      },
    });
    await installWork;
    expect(harness.cacheAddAll).toHaveBeenCalledWith([
      "/field",
      "/field/manifest.webmanifest",
      "/field-icons/icon-192.png",
      "/field-icons/icon-512.png",
    ]);

    let activateWork: Promise<unknown> | undefined;
    harness.listeners.get("activate")?.({
      waitUntil(value: Promise<unknown>) {
        activateWork = Promise.resolve(value);
      },
    });
    await activateWork;
    expect(harness.cacheDelete).toHaveBeenCalledWith("bring-field-shell-v0");
    expect(harness.cacheDelete).not.toHaveBeenCalledWith("unrelated-cache");
  });

  it("bypasses non-GET, protected, signed, media, and remote Firebase/Google traffic", async () => {
    const harness = await createWorkerHarness();
    const bypassed = [
      request("https://bring.test/field", { method: "POST" }),
      request("https://bring.test/api/private"),
      request("https://bring.test/__/auth/handler"),
      request("https://bring.test/field-media/staff/session/photo.jpg"),
      request("https://bring.test/field-media-finalized/building/photo.jpg"),
      request("https://bring.test/field?token=signed"),
      request("https://bring.test/field", { authorization: true }),
      request("https://firebasestorage.googleapis.com/v0/b/bucket/o/file"),
      request("https://project.firebaseio.com/fieldPlatform.json"),
      request("https://accounts.google.com/o/oauth2/auth"),
    ];

    for (const protectedRequest of bypassed) {
      expect(dispatchFetch(harness, protectedRequest)).toBeUndefined();
    }
    expect(harness.fetch).not.toHaveBeenCalled();
    expect(harness.cachePut).not.toHaveBeenCalled();
  });

  it("uses network-first navigation with the cached /field shell fallback", async () => {
    const harness = await createWorkerHarness();
    harness.fetch.mockRejectedValueOnce(new TypeError("offline"));

    const response = dispatchFetch(harness, request(
      "https://bring.test/field/buildings",
      { mode: "navigate" },
    ));

    await expect(response).resolves.toEqual({ source: "cached-field-shell" });
    expect(harness.fetch).toHaveBeenCalledOnce();
    expect(harness.cacheMatch).toHaveBeenCalledWith("/field");
    expect(harness.cachePut).not.toHaveBeenCalled();
  });

  it("uses cache-first only for allowlisted immutable shell assets", async () => {
    const harness = await createWorkerHarness();
    const networkResponse = {
      ok: true,
      type: "basic",
      clone: vi.fn(() => ({ source: "cloned-static" })),
    };
    harness.fetch.mockResolvedValueOnce(networkResponse);

    const response = dispatchFetch(harness, request(
      "https://bring.test/_next/static/app.abc123.js",
      { destination: "script" },
    ));

    await expect(response).resolves.toBe(networkResponse);
    expect(harness.cacheMatch).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://bring.test/_next/static/app.abc123.js",
    }));
    expect(harness.cachePut).toHaveBeenCalledOnce();

    expect(dispatchFetch(harness, request(
      "https://bring.test/uploads/listing-photo.png",
      { destination: "image" },
    ))).toBeUndefined();
  });
});

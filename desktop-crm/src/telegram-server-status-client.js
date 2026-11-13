"use strict";

const ENDPOINT = "https://bring-crm-ai-gateway.bringengineering1008.workers.dev/health";
const MAX_BYTES = 4096;
const CACHE_MS = 30000;

async function boundedHealth(response) {
  if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    await response.body?.cancel(); throw new Error("SERVER_STATUS_UNAVAILABLE");
  }
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_BYTES) { await response.body?.cancel(); throw new Error("SERVER_STATUS_UNAVAILABLE"); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("SERVER_STATUS_UNAVAILABLE");
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error("SERVER_STATUS_UNAVAILABLE");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function createTelegramServerStatusClient({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  let pending = null, cached = null, expiresAt = 0;
  return async function loadStatus() {
    if (cached && now() < expiresAt) return { ...cached };
    if (pending) return { ...await pending };
    pending = (async () => {
      let connected = false;
      try {
        const response = await fetchImpl(ENDPOINT, {
          method: "GET", redirect: "error", cache: "no-store", credentials: "omit",
          headers: { accept: "application/json" }, signal: AbortSignal.timeout(10000),
        });
        const health = await boundedHealth(response);
        connected = health?.ok === true && health.service === "bring-crm-ai-gateway" && health.morningTelegram === true;
      } catch { /* Only a bounded status leaves this process, never remote errors. */ }
      cached = { connected, status: connected ? "connected" : "unavailable" };
      expiresAt = now() + CACHE_MS;
      return cached;
    })();
    try { return { ...await pending }; }
    finally { pending = null; }
  };
}

module.exports = { createTelegramServerStatusClient };

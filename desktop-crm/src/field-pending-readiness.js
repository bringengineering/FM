"use strict";

function readinessError(code) {
  return Object.assign(new Error(code), { code });
}

function createFieldPendingReadinessCoordinator(options = {}) {
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 10_000;
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const waiters = new Set();
  let contextKey = "";
  let known = false;

  const settle = (waiter, error) => {
    if (!waiters.delete(waiter)) return false;
    clearTimer(waiter.timer);
    if (error) waiter.reject(error);
    else waiter.resolve(true);
    return true;
  };

  const rejectWaiters = code => {
    const error = readinessError(code);
    for (const waiter of [...waiters]) settle(waiter, error);
  };

  return Object.freeze({
    reset(nextContextKey, code = "FIELD_PENDING_UPLOADS_RESET") {
      rejectWaiters(code);
      contextKey = String(nextContextKey || "");
      known = false;
      return contextKey;
    },

    cancelWaiters(code = "FIELD_PENDING_UPLOADS_CANCELLED") {
      rejectWaiters(code);
    },

    markKnown(candidateContextKey) {
      const candidate = String(candidateContextKey || "");
      if (!candidate || candidate !== contextKey) return false;
      known = true;
      for (const waiter of [...waiters]) {
        if (waiter.contextKey === candidate) settle(waiter);
      }
      return true;
    },

    wait(candidateContextKey) {
      const candidate = String(candidateContextKey || "");
      if (!candidate || candidate !== contextKey) {
        return Promise.reject(readinessError("FIELD_PENDING_UPLOADS_CONTEXT_CHANGED"));
      }
      if (known) return Promise.resolve(true);
      return new Promise((resolve, reject) => {
        const waiter = { contextKey: candidate, resolve, reject, timer: null };
        waiter.timer = setTimer(() => {
          settle(waiter, readinessError("FIELD_PENDING_UPLOADS_TIMEOUT"));
        }, timeoutMs);
        waiters.add(waiter);
        // Keep this re-check so a custom scheduler or future refactor cannot
        // strand a waiter when readiness changes during registration.
        if (known && candidate === contextKey) settle(waiter);
      });
    },

    isKnown(candidateContextKey) {
      const candidate = String(candidateContextKey || "");
      return Boolean(candidate && candidate === contextKey && known);
    },

    contextKey() {
      return contextKey;
    },

    pendingCount() {
      return waiters.size;
    },
  });
}

async function requestFreshPendingUploadDecision(options = {}) {
  if (typeof options.requestDecision !== "function" || typeof options.waitUntilKnown !== "function") {
    throw readinessError("FIELD_PENDING_UPLOADS_CHECK_INVALID");
  }
  const retriableCodes = new Set(options.retriableCodes || [
    "FIELD_BRIDGE_TIMEOUT",
    "FIELD_PENDING_UPLOADS_UNKNOWN",
  ]);
  if (options.alreadyKnown === true) {
    try {
      return await options.requestDecision();
    } catch (error) {
      if (!retriableCodes.has(error && error.code)) throw error;
      return await options.requestDecision();
    } finally {
      if (typeof options.cancelWaiters === "function") {
        try { options.cancelWaiters(); } catch (_error) {}
      }
    }
  }
  let directSucceeded = false;
  const directCheck = Promise.resolve().then(options.requestDecision).then(value => {
    directSucceeded = true;
    return value;
  });
  const retryAfterKnown = Promise.resolve().then(options.waitUntilKnown).then(() => {
    if (directSucceeded) return directCheck;
    return options.requestDecision();
  });

  try {
    return await Promise.race([directCheck, retryAfterKnown]);
  } catch (error) {
    if (!retriableCodes.has(error && error.code)) throw error;
    return await retryAfterKnown;
  } finally {
    if (typeof options.cancelWaiters === "function") {
      try { options.cancelWaiters(); } catch (_error) {}
    }
  }
}

module.exports = {
  createFieldPendingReadinessCoordinator,
  requestFreshPendingUploadDecision,
};

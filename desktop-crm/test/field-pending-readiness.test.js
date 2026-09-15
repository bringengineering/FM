const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createFieldPendingReadinessCoordinator,
  requestFreshPendingUploadDecision,
} = require("../src/field-pending-readiness");

function deferredTimers() {
  const active = new Set();
  return {
    setTimer(callback) {
      const timer = { callback };
      active.add(timer);
      return timer;
    },
    clearTimer(timer) {
      active.delete(timer);
    },
    fireAll() {
      for (const timer of [...active]) {
        active.delete(timer);
        timer.callback();
      }
    },
    size() {
      return active.size;
    },
  };
}

test("pending upload readiness waits for the exact renderer/session/navigation context", async () => {
  const timers = deferredTimers();
  const readiness = createFieldPendingReadinessCoordinator({
    timeoutMs: 50,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  readiness.reset("session-a:view-41:navigation-1");
  const waiting = readiness.wait("session-a:view-41:navigation-1");

  assert.equal(readiness.markKnown("session-a:view-42:navigation-1"), false);
  assert.equal(readiness.markKnown("session-b:view-41:navigation-1"), false);
  assert.equal(readiness.pendingCount(), 1);
  assert.equal(readiness.markKnown("session-a:view-41:navigation-1"), true);
  assert.equal(await waiting, true);
  assert.equal(readiness.pendingCount(), 0);
  assert.equal(timers.size(), 0);
});

test("pending upload readiness is race-safe when the validated event arrives before registration", async () => {
  const readiness = createFieldPendingReadinessCoordinator();
  readiness.reset("session-a:view-41:navigation-2");
  readiness.markKnown("session-a:view-41:navigation-2");

  assert.equal(await readiness.wait("session-a:view-41:navigation-2"), true);
  assert.equal(readiness.isKnown("session-a:view-41:navigation-2"), true);
  assert.equal(readiness.pendingCount(), 0);
});

test("navigation or session reset rejects old waiters and refuses stale events", async () => {
  const readiness = createFieldPendingReadinessCoordinator();
  readiness.reset("session-a:view-41:navigation-1");
  const staleWaiter = readiness.wait("session-a:view-41:navigation-1");
  readiness.reset("session-a:view-41:navigation-2", "FIELD_NAVIGATION_CHANGED");

  await assert.rejects(staleWaiter, error => error && error.code === "FIELD_NAVIGATION_CHANGED");
  assert.equal(readiness.markKnown("session-a:view-41:navigation-1"), false);
  assert.equal(readiness.isKnown("session-a:view-41:navigation-2"), false);
  await assert.rejects(
    readiness.wait("session-a:view-41:navigation-1"),
    error => error && error.code === "FIELD_PENDING_UPLOADS_CONTEXT_CHANGED",
  );
});

test("hiding cancels active waiters without invalidating known state for the same live renderer", async () => {
  const readiness = createFieldPendingReadinessCoordinator();
  readiness.reset("session-a:view-41:navigation-1");
  const cancelled = readiness.wait("session-a:view-41:navigation-1");
  readiness.cancelWaiters("FIELD_VIEW_HIDDEN");
  await assert.rejects(cancelled, error => error && error.code === "FIELD_VIEW_HIDDEN");

  readiness.markKnown("session-a:view-41:navigation-1");
  readiness.cancelWaiters("FIELD_VIEW_HIDDEN");
  assert.equal(readiness.isKnown("session-a:view-41:navigation-1"), true);
  assert.equal(await readiness.wait("session-a:view-41:navigation-1"), true);
});

test("pending upload readiness remains fail-safe when no validated event arrives", async () => {
  const timers = deferredTimers();
  const readiness = createFieldPendingReadinessCoordinator({
    timeoutMs: 50,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  readiness.reset("session-a:view-41:navigation-1");
  const waiting = readiness.wait("session-a:view-41:navigation-1");
  timers.fireAll();

  await assert.rejects(waiting, error => error && error.code === "FIELD_PENDING_UPLOADS_TIMEOUT");
  assert.equal(readiness.isKnown("session-a:view-41:navigation-1"), false);
  assert.equal(readiness.pendingCount(), 0);
});

test("typed unknown waits for readiness and then performs a fresh authoritative request", async () => {
  let releaseKnown;
  let rejectKnown;
  let knownReleased = false;
  const known = new Promise((resolve, reject) => { releaseKnown = resolve; rejectKnown = reject; });
  let calls = 0;
  let cancelled = 0;
  let settled = false;
  const resultPromise = requestFreshPendingUploadDecision({
    requestDecision: async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("unknown"), { code: "FIELD_PENDING_UPLOADS_UNKNOWN" });
      return { count: 0, risk: "none", request: calls };
    },
    waitUntilKnown: () => known,
    cancelWaiters: () => {
      cancelled += 1;
      if (!knownReleased) rejectKnown(Object.assign(new Error("cancelled too soon"), { code: "FIELD_PENDING_UPLOADS_CANCELLED" }));
    },
  }).then(result => { settled = true; return result; });

  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(calls, 1);
  assert.equal(cancelled, 0);
  knownReleased = true;
  releaseKnown(true);
  assert.deepEqual(await resultPromise, { count: 0, risk: "none", request: 2 });
  assert.equal(calls, 2);
  assert.equal(cancelled, 1);
});

test("old bridge no-response path retries as soon as the validated readiness push arrives", async () => {
  let releaseKnown;
  const known = new Promise(resolve => { releaseKnown = resolve; });
  let calls = 0;
  const never = new Promise(() => {});
  const resultPromise = requestFreshPendingUploadDecision({
    requestDecision: () => {
      calls += 1;
      return calls === 1 ? never : Promise.resolve({ count: 3, risk: "medium", request: calls });
    },
    waitUntilKnown: () => known,
  });

  await Promise.resolve();
  assert.equal(calls, 1);
  releaseKnown(true);
  assert.deepEqual(await resultPromise, { count: 3, risk: "medium", request: 2 });
  assert.equal(calls, 2);
});

test("fresh direct response wins without waiting for a cache signal, while fatal errors stay fatal", async () => {
  let cancelled = 0;
  let calls = 0;
  const result = await requestFreshPendingUploadDecision({
    requestDecision: async () => { calls += 1; return { count: 0, risk: "none" }; },
    alreadyKnown: true,
    waitUntilKnown: () => new Promise(() => {}),
    cancelWaiters: () => { cancelled += 1; },
  });
  assert.deepEqual(result, { count: 0, risk: "none" });
  assert.equal(calls, 1);
  assert.equal(cancelled, 1);

  await assert.rejects(requestFreshPendingUploadDecision({
    requestDecision: async () => { throw Object.assign(new Error("invalid"), { code: "FIELD_LOGOUT_DECISION_INVALID" }); },
    waitUntilKnown: () => new Promise(() => {}),
  }), error => error && error.code === "FIELD_LOGOUT_DECISION_INVALID");
});

test("already-known readiness avoids duplicate checks but retries one transient authoritative failure", async () => {
  let calls = 0;
  const result = await requestFreshPendingUploadDecision({
    alreadyKnown: true,
    requestDecision: async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("unknown"), { code: "FIELD_PENDING_UPLOADS_UNKNOWN" });
      return { count: 1, risk: "low" };
    },
    waitUntilKnown: () => { throw new Error("must not wait when already known"); },
  });
  assert.deepEqual(result, { count: 1, risk: "low" });
  assert.equal(calls, 2);
});

test("no readiness event and context reset remain fail-closed during a retriable direct failure", async () => {
  let calls = 0;
  await assert.rejects(requestFreshPendingUploadDecision({
    requestDecision: async () => {
      calls += 1;
      throw Object.assign(new Error("unknown"), { code: "FIELD_PENDING_UPLOADS_UNKNOWN" });
    },
    waitUntilKnown: async () => {
      throw Object.assign(new Error("timeout"), { code: "FIELD_PENDING_UPLOADS_TIMEOUT" });
    },
  }), error => error && error.code === "FIELD_PENDING_UPLOADS_TIMEOUT");
  assert.equal(calls, 1);

  const never = new Promise(() => {});
  await assert.rejects(requestFreshPendingUploadDecision({
    requestDecision: () => never,
    waitUntilKnown: async () => {
      throw Object.assign(new Error("navigation changed"), { code: "FIELD_NAVIGATION_CHANGED" });
    },
  }), error => error && error.code === "FIELD_NAVIGATION_CHANGED");
});

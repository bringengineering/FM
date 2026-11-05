'use strict';

function createWallboardRefreshQueue({
  getIdentity,
  refresh,
  onSuccess = () => {},
  onFailure = () => {},
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  retryMs = 10000
}) {
  let owner = '';
  let pending = false;
  let busy = false;
  let timer = null;

  async function run() {
    if (busy || !pending) return;
    const expected = owner;
    if (!expected || getIdentity() !== expected) {
      pending = false;
      return;
    }
    pending = false;
    busy = true;
    let failed = false;
    try {
      const result = await refresh(expected);
      if (getIdentity() === expected && owner === expected) onSuccess(result);
    } catch (error) {
      failed = true;
      if (getIdentity() === expected && owner === expected) {
        pending = true;
        onFailure(error);
      }
    } finally {
      busy = false;
      if (getIdentity() !== expected || owner !== expected) {
        if (pending && owner && getIdentity() === owner) void run();
        return;
      }
      if (failed && pending) {
        timer = setTimeoutFn(() => {
          timer = null;
          return run();
        }, retryMs);
        timer?.unref?.();
      } else if (pending) {
        void run();
      }
    }
  }

  function notify() {
    const identity = getIdentity();
    if (!identity) return Promise.resolve();
    if (owner !== identity) {
      if (timer !== null) clearTimeoutFn(timer);
      timer = null;
      owner = identity;
      pending = false;
    }
    pending = true;
    if (timer !== null) {
      clearTimeoutFn(timer);
      timer = null;
    }
    return run();
  }

  return { notify };
}

module.exports = { createWallboardRefreshQueue };

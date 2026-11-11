(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringCrmAccountSetup = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ALLOWED_HOSTS = new Set([
    "bring-fm.firebaseapp.com",
    "bring-fm.web.app",
  ]);
  const CONTINUE_HOST = "bring-fm.web.app";
  // Firebase Hosting cleanUrls canonicalizes this route without a trailing slash.
  const CONTINUE_PATH = "/crm-account-setup/";
  const CONTINUE_PATH_WITHOUT_SLASH = "/crm-account-setup";

  function isSafeHttpsUrl(parsed) {
    return parsed.protocol === "https:"
      && !parsed.username
      && !parsed.password
      && !parsed.port;
  }

  function readInviteState(parsed) {
    if (parsed.hostname !== CONTINUE_HOST
      || ![CONTINUE_PATH, CONTINUE_PATH_WITHOUT_SLASH].includes(parsed.pathname)) return null;
    const uid = parsed.searchParams.get("uid") || "";
    const setupToken = parsed.searchParams.get("invite") || "";
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(uid)
      || ["__proto__", "prototype", "constructor"].includes(uid)
      || !/^[A-Za-z0-9_-]{43}$/u.test(setupToken)) return null;
    return { uid, setupToken };
  }

  function parseSignInActionLink(value) {
    let candidate = String(value || "");
    let inviteState = null;
    for (let depth = 0; depth < 5 && candidate; depth += 1) {
      let parsed;
      try { parsed = new URL(candidate, "https://bring-fm.web.app"); }
      catch { return null; }
      if (!isSafeHttpsUrl(parsed) || !ALLOWED_HOSTS.has(parsed.hostname)) return null;

      inviteState = inviteState || readInviteState(parsed);
      const mode = parsed.searchParams.get("mode");
      const actionCode = parsed.searchParams.get("oobCode");
      if (mode && actionCode) {
        if (mode !== "signIn" || actionCode.length < 6 || actionCode.length > 4096
          || /[\u0000-\u0020\u007f]/u.test(actionCode)) return null;
        const continueUrl = parsed.searchParams.get("continueUrl");
        if (continueUrl) {
          let continuation;
          try { continuation = new URL(continueUrl); }
          catch { return null; }
          if (!isSafeHttpsUrl(continuation) || !ALLOWED_HOSTS.has(continuation.hostname)) return null;
          inviteState = inviteState || readInviteState(continuation);
        }
        if (!inviteState) return null;
        return Object.freeze({ mode, actionCode, uid: inviteState.uid, setupToken: inviteState.setupToken });
      }

      const inner = parsed.searchParams.get("link")
        || parsed.searchParams.get("deep_link_id")
        || parsed.searchParams.get("continueUrl");
      if (!inner || inner === candidate) return null;
      candidate = inner;
    }
    return null;
  }

  return Object.freeze({ parseSignInActionLink });
});

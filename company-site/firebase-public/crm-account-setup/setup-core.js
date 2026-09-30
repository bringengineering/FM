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

  function parseSignInActionLink(value) {
    let candidate = String(value || "");
    for (let depth = 0; depth < 5 && candidate; depth += 1) {
      let parsed;
      try { parsed = new URL(candidate, "https://bring-fm.web.app"); }
      catch { return null; }
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return null;
      const mode = parsed.searchParams.get("mode");
      const actionCode = parsed.searchParams.get("oobCode");
      if (mode && actionCode) {
        if (mode !== "signIn" || actionCode.length < 6 || actionCode.length > 4096) return null;
        if (!ALLOWED_HOSTS.has(parsed.hostname)) return null;
        return Object.freeze({ mode, actionCode });
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

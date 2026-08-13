const FIELD_ORIGIN = "https://bring-fm.web.app";
const FIELD_SIDEBAR_WIDTH = 232;
const FIELD_HEADER_HEIGHT = 115;

function isAllowedFieldNavigation(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ""));
    return url.origin === FIELD_ORIGIN
      && (url.pathname === "/field" || url.pathname.startsWith("/field/"));
  } catch (_error) {
    return false;
  }
}

function isAllowedFieldAuthPopup(rawUrl) {
  if (rawUrl === "about:blank") return true;
  try {
    const url = new URL(String(rawUrl || ""));
    if (url.origin === "https://accounts.google.com") return true;
    return url.origin === "https://bring-fm.firebaseapp.com"
      && url.pathname === "/__/auth/handler";
  } catch (_error) {
    return false;
  }
}

function fieldBounds(contentBounds) {
  const width = Number(contentBounds && contentBounds.width) || 0;
  const height = Number(contentBounds && contentBounds.height) || 0;
  return {
    x: FIELD_SIDEBAR_WIDTH,
    y: FIELD_HEADER_HEIGHT,
    width: Math.max(0, width - FIELD_SIDEBAR_WIDTH),
    height: Math.max(0, height - FIELD_HEADER_HEIGHT),
  };
}

module.exports = {
  FIELD_ORIGIN,
  fieldBounds,
  isAllowedFieldAuthPopup,
  isAllowedFieldNavigation,
};

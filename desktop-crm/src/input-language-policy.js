(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringInputLanguagePolicy = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const EXCLUDED_INPUT_TYPES = new Set([
    "button", "checkbox", "color", "date", "datetime-local", "email", "file",
    "hidden", "month", "number", "password", "radio", "range", "reset",
    "submit", "tel", "time", "url", "week",
  ]);
  const EXCLUDED_INPUT_MODES = new Set(["decimal", "email", "none", "numeric", "tel", "url"]);

  function lower(value) { return String(value || "").trim().toLowerCase(); }

  function wantsKoreanInput(element) {
    if (!element || typeof element !== "object") return false;
    if (element.disabled || element.readOnly) return false;
    if (lower(element.getAttribute && element.getAttribute("aria-disabled")) === "true") return false;
    if (lower(element.getAttribute && element.getAttribute("data-ime")) === "latin") return false;

    const tag = lower(element.tagName);
    if (tag === "textarea") return true;
    if (element.isContentEditable) return true;
    if (tag !== "input") return false;

    const type = lower(element.type || (element.getAttribute && element.getAttribute("type"))) || "text";
    if (EXCLUDED_INPUT_TYPES.has(type)) return false;
    const inputMode = lower(element.inputMode || (element.getAttribute && element.getAttribute("inputmode")));
    return !EXCLUDED_INPUT_MODES.has(inputMode);
  }

  return Object.freeze({ wantsKoreanInput });
});


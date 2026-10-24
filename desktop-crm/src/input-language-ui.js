(function () {
  "use strict";

  const policy = window.BringInputLanguagePolicy;
  if (!policy || !window.bringCRM || typeof window.bringCRM.requestKoreanInput !== "function") return;

  document.addEventListener("focusin", event => {
    if (!policy.wantsKoreanInput(event.target)) return;
    Promise.resolve(window.bringCRM.requestKoreanInput()).catch(() => undefined);
  }, true);
})();


(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringOfficeFeaturePolicy = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";
  const retiredViews = Object.freeze(["officeMessenger", "growth", "officeApprovals", "officePayroll"]);
  const hiddenViews = Object.freeze(["officeLeave"]);
  const officeViews = Object.freeze(["officeHome", "officeAttendance", "officeRfid", "officeMembers", "officeAdmin", "officeAccountSetup"]);
  function resolveView(view) {
    return retiredViews.includes(view) || hiddenViews.includes(view) ? "officeHome" : view;
  }
  return Object.freeze({ retiredViews, hiddenViews, officeViews, resolveView });
});

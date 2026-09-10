"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, "src", file), "utf8");
const app = read("app.js");
const main = read("main.js");
const preload = read("preload.js");
const remote = read("remote.js");
const between = (start, end) => app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start)));

test("explicit shared saves have a strict server-only transport", () => {
  assert.match(preload, /saveNow: data => ipcRenderer\.invoke\("crm:save-now", data\)/);
  assert.match(main, /secureHandle\("crm:save-now", data => writeStoreNow\(data\)\)/);
  assert.match(remote, /async saveStoreNow\(input\)/);
  const strict = remote.slice(remote.indexOf("async saveStoreNowLocked"), remote.indexOf("async saveStoreLocked", remote.indexOf("async saveStoreNowLocked")));
  assert.match(strict, /pushStoreLocked/);
  assert.doesNotMatch(strict, /writePendingStore/);
  assert.match(strict, /pending: false/);
});

test("customer registration confirms the server and never creates a building implicitly", () => {
  const submit = between('form.id === "customerForm"', 'form.id === "partnerVendorForm"');
  assert.match(app, /async function commitSharedFormMutation/);
  assert.match(submit, /await commitSharedFormMutation/);
  assert.doesNotMatch(submit, /commitCanonicalEntity/);
  assert.doesNotMatch(submit, /자동 생성/);
});

test("every shared-data form waits for confirmed server persistence", () => {
  const submitHandler = app.slice(app.indexOf('document.addEventListener("submit"'), app.indexOf('searchEl.addEventListener("input"'));
  const sharedForms = [
    "messageConsentForm", "salesProspectForm", "salesContactForm", "salesActivityForm",
    "salesEventForm", "salesEventArchiveForm", "salesResumeForm", "salesOpportunityForm",
    "contractForm", "partnerVendorForm", "partnerQuoteForm", "taskForm",
    "relationshipActivityForm", "activityForm", "consultationForm", "relationshipPlanForm",
    "securityReturnForm", "securityDispositionForm", "securityAssetForm", "accessRoleForm",
    "auditForm", "incidentForm", "settingsForm",
  ];
  const allFormMarkers = [...submitHandler.matchAll(/(?:if|else if) \(form\.id === "([^"]+)"\)/g)]
    .map(match => ({ id: match[1], index: match.index }));
  for (const formId of sharedForms) {
    const markerIndex = allFormMarkers.findIndex(marker => marker.id === formId);
    assert.notEqual(markerIndex, -1, `${formId} submit branch must exist`);
    const start = allFormMarkers[markerIndex].index;
    const end = allFormMarkers[markerIndex + 1]?.index || submitHandler.length;
    const submit = submitHandler.slice(start, end);
    assert.match(submit, /const beforeStore = cloneStore\(store\)/, `${formId} must snapshot before mutation`);
    assert.match(submit, /await commitSharedFormMutation/, `${formId} must wait for the server`);
    assert.doesNotMatch(submit, /scheduleSave\(\)/, `${formId} must not queue a background-only save`);
  }
});

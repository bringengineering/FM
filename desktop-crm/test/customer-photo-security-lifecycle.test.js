"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Core = require("../src/core");

const repositoryRoot = path.join(__dirname, "..", "..");
const source = file => fs.readFileSync(path.join(__dirname, "..", "src", file), "utf8");
const appSource = source("app.js");
const coreSource = source("core.js");
const mainSource = source("main.js");
const preloadSource = source("preload.js");
const remoteSource = source("remote.js");
const databaseRules = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "database.rules.json"), "utf8"));

function sourceBetween(value, startMarker, endMarker) {
  const start = value.indexOf(startMarker);
  assert.ok(start >= 0, `${startMarker} should exist`);
  const end = value.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `${endMarker} should follow ${startMarker}`);
  return value.slice(start, end);
}

const companyRules = databaseRules.rules.crmCompany;
const customerRules = companyRules.data.customers.$customerId;
const customerPhotoRules = companyRules.customerPhotos;
const customerPhotoRecordRules = customerPhotoRules.$customerId;

test("inline customer image values never enter the shared customer document", () => {
  const customer = Core.normalizeCustomer({
    id: "cus_photo_contract",
    name: "사진 고객",
    photoDataUrl: "data:image/jpeg;base64,QUJD",
    avatarUrl: "https://example.invalid/customer.jpg",
    localPath: "C:\\Users\\someone\\Pictures\\customer.jpg"
  });

  assert.equal(Object.hasOwn(customer, "photoDataUrl"), false);
  assert.equal(Object.hasOwn(customer, "avatarUrl"), false);
  assert.equal(Object.hasOwn(customer, "localPath"), false);

  const customerFormSave = sourceBetween(appSource, "function customerFromForm", "async function deleteActivityRecord");
  assert.doesNotMatch(customerFormSave, /photoDataUrl|avatarUrl|localPath/);
  assert.match(coreSource, /delete customer\.photoDataUrl/);
  assert.match(coreSource, /delete customer\.avatarUrl/);
  assert.match(coreSource, /delete customer\.localPath/);
});

test("customer photo rules enforce the exact bounded JPEG thumbnail schema", () => {
  const recordValidation = customerPhotoRecordRules[".validate"];

  assert.equal(customerPhotoRules[".write"], false);
  assert.match(customerPhotoRules[".read"], /role['"]?\)\.val\(\) === 'viewer'/);
  assert.match(recordValidation, /data:image\[\/\]jpeg;base64/);
  assert.match(recordValidation, /\[\/\]9j\[\/\]/, "rules must require the JPEG SOI base64 prefix");
  assert.match(recordValidation, /dataUrl['"]?\)\.val\(\)\.length <= 20000/);
  assert.match(recordValidation, /size['"]?\)\.val\(\) <= 20000/);
  assert.match(recordValidation, /updatedBy['"]?\)\.val\(\) === auth\.uid/);
  assert.equal(customerPhotoRecordRules.$other[".validate"], false);
  assert.deepEqual(
    Object.keys(customerPhotoRecordRules).filter(key => !key.startsWith(".") && key !== "$other").sort(),
    ["dataUrl", "size", "updatedAt", "updatedBy"]
  );

  const picker = sourceBetween(mainSource, "async function pickCustomerPhoto", "async function writeStore");
  assert.match(picker, /resize\(\{ width: 96, height: 96/);
  assert.match(picker, /encoded\.length <= 12000/);
  assert.match(picker, /data:image\/jpeg;base64/);
  assert.equal(Core.normalizeCustomerPhotoDataUrl("data:image/jpeg;base64,QUJD"), "", "arbitrary base64 must not pass as a JPEG");
  assert.equal(Core.normalizeCustomerPhotoDataUrl("data:image/jpeg;base64,/9j/2Q=="), "data:image/jpeg;base64,/9j/2Q==");
  assert.match(mainSource, /function sanitizeCustomerPhotoMap[\s\S]*?sanitizeCustomerPhotoDataUrl\(record\.dataUrl\)/, "remote thumbnails must be decoded by Electron before reaching the renderer");
});

test("customer photo writes are bound to a safe, existing customer", () => {
  const writePolicy = `${customerPhotoRecordRules[".write"]}\n${customerPhotoRecordRules[".validate"]}`;

  assert.match(writePolicy, /\$customerId\.matches\(/, "rules must validate the customer id instead of trusting a client path");
  assert.match(writePolicy, /A-Za-z0-9_-/, "rules must use the same direct-id alphabet as the desktop client");
  for (const forbidden of ["__proto__", "prototype", "constructor"]) {
    assert.match(writePolicy, new RegExp(forbidden), `rules must reject ${forbidden} as a customer id`);
  }
  assert.match(
    writePolicy,
    /newData\.parent\(\)\.parent\(\)\.child\('data'\)\.child\('customers'\)\.child\(\$customerId\)\.child\('id'\)\.val\(\) === \$customerId/,
    "a thumbnail may only be written when the post-write customer remains active"
  );

  const savePhoto = sourceBetween(remoteSource, "async saveCustomerPhoto", "async decideDriveImport");
  const customerRead = savePhoto.indexOf("crmShared/data/customers/${customerId}");
  const photoWrite = savePhoto.lastIndexOf("customerPhotos/${customerId}");
  assert.ok(customerRead >= 0, "the desktop must check that the customer exists before upload");
  assert.ok(photoWrite > customerRead, "the existing-customer check must finish before the thumbnail write");
});

test("customer deletion and archival cannot leave a readable photo orphan", () => {
  const deleteCustomer = sourceBetween(appSource, "async function deleteCustomerRecord", "async function deleteBuildingRecord");
  const customerRecordWrite = customerRules[".write"];
  const customerFieldWrite = customerRules.$field[".write"];
  const photoWrite = customerPhotoRecordRules[".write"];

  assert.doesNotMatch(customerRecordWrite, /root\.child\('crmCompany\/customerPhotos'/, "whole-customer lifecycle checks must use post-write state");
  assert.doesNotMatch(customerFieldWrite, /root\.child\('crmCompany\/customerPhotos'/, "archive lifecycle checks must use post-write state");
  assert.match(customerRecordWrite, /newData\.parent\(\)\.parent\(\)\.parent\(\)\.child\('customerPhotos'/);
  assert.match(customerFieldWrite, /newData\.parent\(\)\.parent\(\)\.parent\(\)\.parent\(\)\.child\('customerPhotos'/);
  assert.match(photoWrite, /newData\.parent\(\)\.parent\(\)\.child\('data'\)\.child\('customers'/);

  const deleteFlowRemovesPhoto = /saveCustomerPhoto\(\{[\s\S]*?customerId[\s\S]*?dataUrl:\s*["']{2}/.test(deleteCustomer)
    || /deleteCustomerPhoto|removeCustomerPhoto/.test(deleteCustomer);
  const deleteRuleRequiresNoPhoto = /customerPhotos/.test(customerRecordWrite);
  assert.ok(
    deleteFlowRemovesPhoto || deleteRuleRequiresNoPhoto,
    "hard delete must remove the thumbnail or be rejected while a thumbnail exists"
  );

  const archiveFlowRemovesPhoto = /archiveCustomer[\s\S]*?(?:deleteCustomerPhoto|removeCustomerPhoto|saveCustomerPhoto)/.test(appSource);
  const archiveRuleRequiresNoPhoto = /archivedAt/.test(customerRecordWrite) && /customerPhotos/.test(customerRecordWrite);
  assert.ok(
    archiveFlowRemovesPhoto || archiveRuleRequiresNoPhoto,
    "archiving a customer must remove the thumbnail or be rejected while a thumbnail exists"
  );
});

test("customer photo IPC is restricted to the exact CRM main frame", () => {
  for (const channel of [
    "crm:customer-photos-load",
    "crm:customer-photo-save",
    "crm:customer-photo-pick"
  ]) {
    assert.ok(new RegExp(`secureCanonicalHandle\\(\\"${channel}\\"`).test(mainSource), `${channel} must use the exact-frame IPC guard`);
    assert.ok(!new RegExp(`secureHandle\\(\\"${channel}\\"`).test(mainSource), `${channel} must not use the broad file-origin IPC guard`);
    assert.ok(new RegExp(`ipcRenderer\\.invoke\\(\\"${channel}\\"`).test(preloadSource), `${channel} must be exposed through preload`);
  }
});

test("customer photo changes have a session-scoped multi-PC refresh bridge", () => {
  const startStream = sourceBetween(remoteSource, "  startStream() {", "  stopStream() {");
  const stopStream = sourceBetween(remoteSource, "  stopStream() {", "  handleStreamEvent(");
  const handleStreamEvent = sourceBetween(remoteSource, "  handleStreamEvent(", "  async streamLoop(");

  assert.match(startStream, /streamLoop\("customerPhotos",\s*"customerPhotos"/);
  assert.match(stopStream, /customerPhoto[\w]*Controller[\s\S]*?abort\(\)/);
  assert.match(handleStreamEvent, /customerPhotos[\s\S]*?(?:loadCustomerPhotos|scheduleCustomerPhoto)/);
  assert.ok(/onCustomerPhotos[\s\S]*?sendToRenderer\("crm:customer-photos"/.test(mainSource), "main must forward refreshed photos to the renderer");
  assert.ok(/onCustomerPhotos[\s\S]*?ipcRenderer\.on\("crm:customer-photos"/.test(preloadSource), "preload must expose the photo refresh event");
  assert.ok(/api\.onCustomerPhotos\([\s\S]*?customerPhotos\s*=/.test(appSource), "the renderer must apply photo refresh events");
  assert.ok(/setCurrentAuth[\s\S]*?customerPhotos\s*=\s*\{\}/.test(appSource), "photo memory must be cleared when the authenticated user changes");
});

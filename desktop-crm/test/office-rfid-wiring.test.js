"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const MutationPolicy = require("../src/mutation-policy");
const { officeRfidMutationCommitted } = require("../src/remote");
const Rfid = require("../src/office-rfid-core");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, "src", file), "utf8");

test("employee card registration is an admin-only groupware child view", () => {
  const html = read("index.html");
  const app = read("app.js");
  const officeFolder = html.slice(html.indexOf('data-nav-folder="office"'), html.indexOf('data-nav-folder="company-wallboard"'));
  assert.match(officeFolder, /id="navOfficeRfid"[^>]*data-view="officeRfid"[^>]*hidden/);
  assert.match(officeFolder, />직원 카드 등록</);
  assert.ok(app.includes('document.getElementById("navOfficeRfid").hidden = user.officeAdmin !== true'));
  assert.match(app, /officeRfid: \["직원 카드 등록·교체·해제", "직원 카드 등록"\]/);
  assert.equal((app.match(/\["officeHome",[^\]]*"officeRfid"[^\]]*\]/g) || []).length, 3);
});

test("RFID IPC is narrow, canonical and classified as a mutation", () => {
  const preload = read("preload.js");
  const main = read("main.js");
  assert.ok(preload.includes('saveOfficeRfidCard: input => ipcRenderer.invoke("crm:office-rfid-card-save", input)'));
  assert.ok(preload.includes('removeOfficeRfidCard: input => ipcRenderer.invoke("crm:office-rfid-card-remove", input)'));
  assert.ok(preload.includes('listOfficeRfidPorts: () => ipcRenderer.invoke("crm:office-rfid-ports")'));
  assert.ok(preload.includes('captureOfficeRfidSerial: input => ipcRenderer.invoke("crm:office-rfid-serial-capture", input)'));
  assert.ok(preload.includes('cancelOfficeRfidSerialCapture: () => ipcRenderer.invoke("crm:office-rfid-serial-cancel")'));
  assert.ok(main.includes('secureCanonicalHandle("crm:office-rfid-card-save"'));
  assert.ok(main.includes('secureCanonicalHandle("crm:office-rfid-card-remove"'));
  assert.ok(main.includes('secureCanonicalHandle("crm:office-rfid-ports"'));
  assert.ok(main.includes('secureCanonicalHandle("crm:office-rfid-serial-capture"'));
  assert.ok(main.includes('secureCanonicalHandle("crm:office-rfid-serial-cancel"'));
  assert.equal(MutationPolicy.classification("crm:office-rfid-card-save"), "mutation");
  assert.equal(MutationPolicy.classification("crm:office-rfid-card-remove"), "mutation");
  assert.equal(MutationPolicy.classification("crm:office-rfid-ports"), "control");
  assert.equal(MutationPolicy.classification("crm:office-rfid-serial-capture"), "mutation");
  assert.equal(MutationPolicy.classification("crm:office-rfid-serial-cancel"), "control");
});

test("renderer uses the explicit selected serial port and never receives or renders a raw card buffer", () => {
  const office = read("office.js");
  assert.ok(office.includes('data-rfid-port'));
  assert.ok(office.includes('data-rfid-reader-refresh'));
  assert.ok(office.includes('captureOfficeRfidSerial({ userId: capture.userId, portPath: capture.portPath })'));
  assert.ok(office.includes('9600bps · 8-N-1 · 하드웨어 흐름제어'));
  assert.equal(office.includes("state.rfidCapture.buffer"), false);
  assert.equal(office.includes("${capture.buffer}"), false);
  assert.match(office, /카드번호는 화면이나 로그에 표시되지 않습니다/);
});

test("remote projections expose only masked summaries and mutation verification is exact", () => {
  const remote = read("remote.js");
  assert.match(remote, /rfidCards: rfidAdmin \? OfficeRfidCore\.summaries\(rfidCards\) : \[\]/);
  assert.match(remote, /session\.officeAdmin !== true/);
  const plan = Rfid.replaceCard(null, {
    userId: "member-1",
    cardCode: "0012345678",
    registeredAt: "2026-09-29T01:23:45.000Z",
    registeredBy: "admin-1",
  });
  assert.equal(officeRfidMutationCommitted(plan.map, { action: "save", userId: "member-1", fingerprint: plan.fingerprint }), true);
  assert.equal(officeRfidMutationCommitted(plan.map, { action: "remove", userId: "member-1" }), false);
  assert.equal(officeRfidMutationCommitted({}, { action: "remove", userId: "member-1" }), true);
});

test("database rules keep RFID cards deny-by-default and enforce a closed schema", () => {
  const rules = JSON.parse(fs.readFileSync(path.join(root, "..", "database.rules.json"), "utf8")).rules.crmCompany.officeRfidCards;
  assert.match(rules[".read"], /officeAdmin'\)\.val\(\) === true/);
  assert.match(rules[".read"], /email_verified === true/);
  assert.match(rules[".write"], /officeAdmin'\)\.val\(\) === true/);
  assert.match(rules.$fingerprint[".validate"], /\^\[a-f0-9\]\{64\}\$/);
  assert.match(rules.$fingerprint[".validate"], /crmCompany\/access/);
  assert.equal(rules.$fingerprint.$other[".validate"], false);
  assert.match(rules.$fingerprint.registeredBy[".validate"], /newData\.val\(\) === auth\.uid/);
});

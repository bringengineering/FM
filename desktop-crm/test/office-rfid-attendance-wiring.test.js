const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const MutationPolicy = require("../src/mutation-policy");

const source = fileName => fs.readFileSync(path.join(__dirname, "../src", fileName), "utf8");

test("RFID attendance reader is restricted to the office-admin IPC and has explicit lifecycle cleanup", () => {
  const main = source("main.js");
  const preload = source("preload.js");
  const ui = source("office.js");

  assert.equal(MutationPolicy.classification("crm:office-rfid-attendance-start"), "mutation");
  assert.equal(MutationPolicy.classification("crm:office-rfid-attendance-stop"), "control");
  assert.match(main, /secureCanonicalHandle\("crm:office-rfid-attendance-start", \(\) => startOfficeRfidAttendance\(\)\)/);
  assert.match(main, /secureCanonicalHandle\("crm:office-rfid-attendance-stop"/);
  assert.match(main, /actor\.officeAdmin !== true/);
  assert.match(main, /if \(active && active\.reader\) active\.reader\.stopAttendanceReader\(\)/);
  assert.match(main, /did-start-loading[\s\S]{0,220}stopOfficeRfidAttendance\(\)/);
  assert.match(main, /crm:auth-logout[\s\S]{0,100}stopOfficeRfidAttendance\(\)/);
  assert.match(preload, /startOfficeRfidAttendance: \(\) => ipcRenderer\.invoke\("crm:office-rfid-attendance-start"\)/);
  assert.match(preload, /onOfficeRfidAttendanceEvent: callback/);
  assert.match(ui, /state\.data\.rfidAdmin/);
  assert.match(ui, /api\.startOfficeRfidAttendance\(\)/);
  assert.match(ui, /api\.stopOfficeRfidAttendance\(\)/);
});

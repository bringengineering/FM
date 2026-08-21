const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const Core = require("../src/core");
const appSource = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");

function functionSource(name) {
  const start = appSource.indexOf(`function ${name}`);
  assert.ok(start >= 0, `${name} should exist`);
  const bodyStart = appSource.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < appSource.length; index += 1) {
    if (appSource[index] === "{") depth += 1;
    if (appSource[index] === "}") depth -= 1;
    if (depth === 0) return appSource.slice(start, index + 1);
  }
  assert.fail(`${name} should have a complete body`);
}

function phoneInputHelpers() {
  return new vm.Script(`
    const customerPhoneText = value => Core.formatPhone(value);
    ${functionSource("customerPhoneSearchKey")}
    ${functionSource("customerPhoneCandidateKey")}
    ${functionSource("customerPhoneCaret")}
    ${functionSource("formatCustomerPhoneInput")}
    ${functionSource("deleteCustomerPhoneDigit")}
    ({ customerPhoneSearchKey, customerPhoneCandidateKey, customerPhoneCaret, formatCustomerPhoneInput, deleteCustomerPhoneDigit });
  `).runInNewContext({ Core });
}

test("formats complete Korean customer phone families and explicit country codes", () => {
  const examples = new Map([
    ["01096541232", "010-9654-1232"],
    ["010-9654-1232", "010-9654-1232"],
    ["07012345678", "070-1234-5678"],
    ["02 123 4567", "02-123-4567"],
    ["02.1234.5678", "02-1234-5678"],
    ["0331234567", "033-123-4567"],
    ["03312345678", "033-1234-5678"],
    ["0801234567", "080-123-4567"],
    ["15881234", "1588-1234"],
    ["05071234567", "0507-123-4567"],
    ["050712345678", "0507-1234-5678"],
    ["+82 10 1234 5678", "010-1234-5678"],
    ["0082 10 1234 5678", "010-1234-5678"],
    ["+82 (0)10 1234 5678", "010-1234-5678"],
    ["0082 (0)10 1234 5678", "010-1234-5678"],
    ["+82 1588 1234", "1588-1234"],
    ["0082 1577 1234", "1577-1234"],
    ["０１０９６５４１２３２", "010-9654-1232"],
  ]);
  for (const [input, expected] of examples) {
    assert.equal(Core.formatPhone(input), expected, input);
    assert.equal(Core.formatPhone(expected), expected, `${input} should be idempotent`);
  }
});

test("formats partial typing without deleting unknown or compound legacy values", () => {
  assert.equal(Core.formatPhone(""), "");
  assert.equal(Core.formatPhone("010"), "010");
  assert.equal(Core.formatPhone("0101"), "010-1");
  assert.equal(Core.formatPhone("0101234"), "010-1234");
  assert.equal(Core.formatPhone("01012345"), "010-1234-5");
  assert.equal(Core.formatPhone("+82"), "+82");
  assert.equal(Core.formatPhone("+1 415 555 0100"), "+1 415 555 0100");
  assert.equal(Core.formatPhone("내선 1234"), "내선 1234");
  assert.equal(Core.formatPhone("02-1234-5678 x123"), "02-1234-5678 x123");
  assert.equal(Core.formatPhone("033-123-4567 1"), "033-123-4567 1");
  assert.equal(Core.formatPhone("0331234567 1"), "0331234567 1");
  assert.equal(Core.formatPhone("033-1234567 1"), "033-1234567 1");
  assert.equal(Core.formatPhone("02-123-4567 1"), "02-123-4567 1");
  assert.equal(Core.formatPhone("02 1234567 1"), "02 1234567 1");
  assert.equal(Core.formatPhone("011-123-4567 1"), "011-123-4567 1");
  assert.equal(Core.formatPhone("0101234567 8"), "0101234567 8");
  assert.equal(Core.formatPhone("+82 33 1234567 1"), "+82 33 1234567 1");
  assert.equal(Core.formatPhone("+82 10 1234 5678 1"), "+82 10 1234 5678 1");
  assert.equal(Core.formatPhone("010-1234-5678 / 033-123-4567"), "010-1234-5678 / 033-123-4567");
  assert.equal(Core.formatPhone("내선１２３４"), "내선１２３４");
  assert.equal(Core.formatPhone("0081 90 1234"), "0081 90 1234");
  assert.equal(Core.formatPhone("001 1 212 555"), "001 1 212 555");
  assert.equal(Core.formatPhone("002 44 20 1234"), "002 44 20 1234");
  assert.equal(Core.formatPhone("010123456789"), "010123456789");

  const foreign = "00819012345678";
  for (let length = 1; length <= foreign.length; length += 1) {
    assert.equal(Core.formatPhone(foreign.slice(0, length)), foreign.slice(0, length));
  }
});

test("customer phone input preserves a selection by logical digit position", () => {
  const { formatCustomerPhoneInput } = phoneInputHelpers();
  const ranges = [];
  const input = {
    value: "01096541232",
    selectionStart: 3,
    selectionEnd: 7,
    setSelectionRange(start, end) { ranges.push([start, end]); },
  };
  formatCustomerPhoneInput(input);
  assert.equal(input.value, "010-9654-1232");
  assert.deepEqual(ranges, [[3, 8]]);

  const legacy = {
    value: "010-1234-5678 / 관리실",
    selectionStart: 4,
    selectionEnd: 4,
    setSelectionRange() { assert.fail("an unrecognized legacy value must not move the caret"); },
  };
  formatCustomerPhoneInput(legacy);
  assert.equal(legacy.value, "010-1234-5678 / 관리실");
});

test("backspace and delete at an automatic hyphen remove one adjacent digit", () => {
  const { deleteCustomerPhoneDigit } = phoneInputHelpers();
  const backwardRanges = [];
  const backward = {
    value: "010-1234-5678",
    selectionStart: 4,
    selectionEnd: 4,
    setSelectionRange(start, end) { backwardRanges.push([start, end]); },
  };
  assert.equal(deleteCustomerPhoneDigit(backward, "backward"), true);
  assert.equal(Core.normalizePhone(backward.value), "0112345678");
  assert.deepEqual(backwardRanges.length, 1);

  const forwardRanges = [];
  const forward = {
    value: "010-1234-5678",
    selectionStart: 3,
    selectionEnd: 3,
    setSelectionRange(start, end) { forwardRanges.push([start, end]); },
  };
  assert.equal(deleteCustomerPhoneDigit(forward, "forward"), true);
  assert.equal(Core.normalizePhone(forward.value), "0102345678");
  assert.deepEqual(forwardRanges.length, 1);

  const manualForeign = {
    value: "008-1234-5678",
    selectionStart: 4,
    selectionEnd: 4,
    setSelectionRange() { assert.fail("a preserved foreign separator must use native deletion"); },
  };
  assert.equal(deleteCustomerPhoneDigit(manualForeign, "backward"), false);
  assert.equal(manualForeign.value, "008-1234-5678");
});

test("phone search ignores ordinary text with digits and matches both phone spellings", () => {
  const { customerPhoneSearchKey, customerPhoneCandidateKey } = phoneInputHelpers();
  assert.equal(customerPhoneSearchKey("건물 2"), "");
  assert.equal(customerPhoneSearchKey("user2@example.com"), "");
  assert.equal(customerPhoneSearchKey("2"), "");
  assert.equal(customerPhoneSearchKey("+1 415 555 0100"), "");
  assert.equal(customerPhoneSearchKey("0081 90 1234 5678"), "");
  assert.equal(customerPhoneSearchKey("0109654"), "0109654");
  assert.equal(customerPhoneSearchKey("010-9654"), "0109654");
  assert.equal(customerPhoneSearchKey("+82 10 9654 1232"), "01096541232");
  assert.equal(customerPhoneCandidateKey("010-9654-1232 / 관리실"), "01096541232");
  assert.equal(customerPhoneCandidateKey("+82 10 9654 1232"), "01096541232");
});

test("workflow customer matching canonicalizes country codes and rejects ambiguous phone values", () => {
  const customer = { id: "customer-a", name: "고객 A", phone: "+82 10 1234 5678" };
  assert.equal(Core.canonicalPhoneKey(customer.phone), "01012345678");
  assert.equal(Core.canonicalPhoneKey("001-121-2555"), "");
  assert.equal(Core.matchWorkflowCustomer({ phone: "010-1234-5678" }, [customer]), customer);
  assert.equal(Core.matchWorkflowCustomer({ phone: "0082 10 1234 5678" }, [customer]), customer);
  assert.equal(Core.matchWorkflowCustomer({ phone: "010-1234" }, [customer]), null);
  assert.equal(Core.matchWorkflowCustomer({ phone: "010-1234-5678 / 033-123-4567" }, [customer]), null);
  assert.equal(Core.matchWorkflowCustomer({ phone: "010-1234-5678" }, [customer, { ...customer, id: "customer-b", phone: "01012345678" }]), null);
  const foreign = { id: "customer-foreign", name: "Foreign", phone: "+1 415 555 0100" };
  assert.equal(Core.matchWorkflowCustomer({ phone: "+1 415 555 0100" }, [foreign]), foreign);
  assert.equal(Core.matchWorkflowCustomer({ phone: "+1 415 555 0100 9" }, [foreign]), null);
  const nanp = { id: "customer-nanp", name: "NANP", phone: "1 585 555 0100" };
  assert.equal(Core.matchWorkflowCustomer({ phone: "1 585 555 0100" }, [nanp]), nanp);
  assert.equal(Core.matchWorkflowCustomer({ phone: "1 585 555 0100" }, [nanp, { ...nanp, id: "customer-nanp-2" }]), null);
  const uk = { id: "customer-uk", name: "UK", phone: "44 20 7123 4567" };
  assert.equal(Core.matchWorkflowCustomer({ phone: "44 20 7123 4567" }, [uk]), uk);
  const japan = { id: "customer-japan", name: "Japan", phone: "81 90 1234 5678" };
  assert.equal(Core.matchWorkflowCustomer({ phone: "81 90 1234 5678" }, [japan]), japan);
  assert.equal(Core.matchWorkflowCustomer({ phone: "81 90 1234 5678" }, [japan, { ...japan, id: "customer-japan-2" }]), null);
  const france = { id: "customer-france", name: "France", phone: "+33 1 42 68 53 00" };
  assert.equal(Core.matchWorkflowCustomer({ phone: "+33 1 42 68 53 00" }, [france]), france);
  const spain = { id: "customer-spain", name: "Spain", phone: "+34 91 123 45 67" };
  assert.equal(Core.matchWorkflowCustomer({ phone: "+34 91 123 45 67" }, [spain]), spain);
  const carrier = { id: "customer-carrier", name: "Carrier", phone: "001-81-90-1234-5678" };
  assert.equal(Core.matchWorkflowCustomer({ phone: "001-81-90-1234-5678" }, [carrier]), carrier);
  assert.equal(Core.matchWorkflowCustomer({ phone: "001-81-90-1234-5678-9" }, [carrier]), null);
});

test("customer management alone wires live formatting, safe submit formatting, and legacy display", () => {
  const editor = functionSource("customerEditor");
  const fromForm = functionSource("customerFromForm");
  assert.match(editor, /name="phone" type="tel" inputmode="tel" autocomplete="tel" data-customer-phone/);
  assert.match(editor, /customerPhoneText\(customer\.phone\)/);
  assert.match(fromForm, /phone:\s*customerPhoneText\(raw\.phone\)/);
  assert.match(appSource, /event\.target\.matches\("#customerForm \[data-customer-phone\]"\)/);
  assert.match(appSource, /event\.target\.matches\("#customerForm \[data-customer-phone\]"\).*deleteContentBackward/s);
  assert.match(appSource, /customerPhoneText\(customer\.phone\) \|\| "-"/);
  assert.match(functionSource("filteredCustomers"), /customerPhoneCandidateKey\(customer\.phone\)\.includes\(phoneQuery\)/);
  assert.match(functionSource("renderBuildings"), /customerPhoneCandidateKey\(customer\.phone\)\.includes\(phoneQuery\)/);
  ["renderCustomerDrawer", "renderRelationshipDrawer", "customerPickerSummaryMarkup"].forEach(name => {
    assert.match(functionSource(name), /customerPhoneText\(customer\.phone\)/, `${name} should show the same formatted customer phone`);
  });
  const customerSubmitStart = appSource.indexOf('} else if (form.id === "customerForm")');
  const customerSubmitEnd = appSource.indexOf('} else if (form.id === "partnerVendorForm")', customerSubmitStart);
  const customerSubmit = appSource.slice(customerSubmitStart, customerSubmitEnd);
  assert.ok(customerSubmit.indexOf("form.elements.name") < customerSubmit.indexOf("customerFromForm(form)"), "name validation must happen before customer mutation");
  assert.doesNotMatch(appSource, /input\[type=["']tel["']\].*formatCustomerPhoneInput/);
});

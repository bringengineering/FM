"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Policy = require("../src/input-language-policy");

function element(tagName, values = {}) {
  const attributes = Object.assign({}, values.attributes);
  return {
    tagName,
    type: values.type || "",
    inputMode: values.inputMode || "",
    disabled: Boolean(values.disabled),
    readOnly: Boolean(values.readOnly),
    isContentEditable: Boolean(values.isContentEditable),
    getAttribute(name) { return attributes[name] ?? null; },
  };
}

test("일반 글자·검색·메모 칸은 한글 기본 입력을 요청한다", () => {
  assert.equal(Policy.wantsKoreanInput(element("INPUT", { type: "text" })), true);
  assert.equal(Policy.wantsKoreanInput(element("INPUT", { type: "search" })), true);
  assert.equal(Policy.wantsKoreanInput(element("TEXTAREA")), true);
  assert.equal(Policy.wantsKoreanInput(element("DIV", { isContentEditable: true })), true);
});

test("영문·숫자 전용 칸과 수정할 수 없는 칸은 건드리지 않는다", () => {
  for (const type of ["email", "password", "tel", "number", "date", "time", "datetime-local", "month", "week", "url", "file", "checkbox", "radio"]) {
    assert.equal(Policy.wantsKoreanInput(element("INPUT", { type })), false, type);
  }
  for (const inputMode of ["numeric", "decimal", "tel", "email", "url", "none"]) {
    assert.equal(Policy.wantsKoreanInput(element("INPUT", { type: "text", inputMode })), false, inputMode);
  }
  assert.equal(Policy.wantsKoreanInput(element("INPUT", { type: "text", disabled: true })), false);
  assert.equal(Policy.wantsKoreanInput(element("TEXTAREA", { readOnly: true })), false);
  assert.equal(Policy.wantsKoreanInput(element("INPUT", { type: "text", attributes: { "data-ime": "latin" } })), false);
  assert.equal(Policy.wantsKoreanInput(element("SELECT")), false);
});


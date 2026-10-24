"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const WindowsKoreanInput = require("../src/windows-korean-input");

function windowRef(overrides = {}) {
  return Object.assign({
    isDestroyed: () => false,
    isFocused: () => true,
    getNativeWindowHandle: () => Buffer.from([0x78, 0x56, 0x34, 0x12, 0, 0, 0, 0]),
  }, overrides);
}

test("CRM 창이 포커스일 때만 고정된 PowerShell 인수로 한국어 IME를 요청한다", async () => {
  let call = null;
  let written = "";
  const spawn = (file, args, options) => {
    call = { file, args, options };
    const child = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdin.destroyed = false;
    child.stdin.write = value => { written += value; return true; };
    child.stdin.end = () => { child.stdin.destroyed = true; };
    child.kill = () => true;
    return child;
  };
  const controller = WindowsKoreanInput.createController({
    platform: "win32",
    spawn,
    env: { SystemRoot: "C:\\Windows", PATH: "safe-path" },
  });
  assert.equal(controller.warm(), true);
  const result = await controller.requestKoreanInput(windowRef());

  assert.equal(result.ok, true);
  assert.equal(call.file, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert.deepEqual(call.args.slice(0, 4), ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand"]);
  assert.equal(call.options.shell, false);
  assert.equal(call.options.windowsHide, true);
  assert.deepEqual(call.options.stdio, ["pipe", "ignore", "ignore"]);
  assert.equal(written, `${0x12345678}\n`);
  assert.equal(call.options.env.PATH, "safe-path");
  assert.equal(call.options.env.BRING_CRM_HWND, undefined);
  controller.stop();
});

test("다른 운영체제·닫힌 창·포커스를 잃은 창에서는 외부 명령을 실행하지 않는다", async () => {
  let calls = 0;
  const spawn = () => { calls += 1; throw new Error("unexpected"); };
  const unsupported = WindowsKoreanInput.createController({ platform: "darwin", spawn });
  const windows = WindowsKoreanInput.createController({ platform: "win32", spawn });
  assert.equal((await unsupported.requestKoreanInput(windowRef())).reason, "unsupported");
  assert.equal((await windows.requestKoreanInput(windowRef({ isDestroyed: () => true }))).reason, "window-unavailable");
  assert.equal((await windows.requestKoreanInput(windowRef({ isFocused: () => false }))).reason, "window-unfocused");
  assert.equal(calls, 0);
});

test("Windows 도우미는 설치된 한국어 IME만 찾아 CRM 포커스 창에 요청한다", () => {
  const script = WindowsKoreanInput.POWERSHELL_SCRIPT;
  assert.match(script, /GetKeyboardLayoutList/);
  assert.match(script, /0x0412/);
  assert.match(script, /WM_INPUTLANGCHANGEREQUEST|0x0050/);
  assert.match(script, /ImmSetOpenStatus/);
  assert.doesNotMatch(script, /LoadKeyboardLayout|ActivateKeyboardLayout/);
  assert.match(script, /GetAncestor/);
  assert.match(script, /Console\]::In\.ReadLine/);
});

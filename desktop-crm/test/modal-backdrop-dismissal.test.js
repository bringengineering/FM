const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
const mainSource = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");

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

function smokeActionSource(name) {
  const marker = `BRING_CRM_SCREENSHOT_ACTION === "${name}"`;
  const start = mainSource.indexOf(marker);
  assert.ok(start >= 0, `${name} screenshot action should exist`);
  const end = mainSource.indexOf("} else if (process.env.BRING_CRM_SCREENSHOT_ACTION", start + marker.length);
  return mainSource.slice(start, end >= 0 ? end : mainSource.length);
}

function backdropHelper() {
  return new vm.Script(`
    ${functionSource("bindBackdropDismissal")}
    bindBackdropDismissal;
  `).runInNewContext();
}

function fakeLayer() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) { listeners.set(type, handler); },
    fire(type, overrides = {}) {
      const event = Object.assign({
        target: this,
        pointerId: 1,
        button: 0,
        isPrimary: true,
      }, overrides);
      listeners.get(type)?.(event);
    },
  };
}

test("backdrop dismissal requires the same primary pointer to start and end directly on the layer", () => {
  const bindBackdropDismissal = backdropHelper();
  const layer = fakeLayer();
  const formControl = {};
  let dismissals = 0;
  bindBackdropDismissal(layer, () => { dismissals += 1; });

  layer.fire("pointerdown", { target: formControl, pointerId: 11 });
  layer.fire("pointerup", { target: layer, pointerId: 11 });
  assert.equal(dismissals, 0, "a text-selection drag from a form control must keep the editor open");

  layer.fire("pointerdown", { target: layer, pointerId: 12 });
  layer.fire("pointerup", { target: formControl, pointerId: 12 });
  assert.equal(dismissals, 0, "a drag that ends inside the card must not dismiss it");

  layer.fire("pointerdown", { target: layer, pointerId: 13 });
  layer.fire("pointercancel", { target: layer, pointerId: 13 });
  layer.fire("pointerup", { target: layer, pointerId: 13 });
  assert.equal(dismissals, 0, "a cancelled gesture must not leak into a later pointerup");

  layer.fire("pointerdown", { target: layer, pointerId: 14, button: 2 });
  layer.fire("pointerup", { target: layer, pointerId: 14, button: 2 });
  assert.equal(dismissals, 0, "secondary-button gestures must not dismiss the editor");

  layer.fire("pointerdown", { target: layer, pointerId: 15 });
  layer.fire("pointerup", { target: layer, pointerId: 16 });
  assert.equal(dismissals, 0, "a different pointer must not complete the gesture");

  layer.fire("pointerdown", { target: layer, pointerId: 17 });
  layer.fire("pointerup", { target: layer, pointerId: 17 });
  assert.equal(dismissals, 1, "a direct primary backdrop press and release should still dismiss");
});

test("modal and drawer both use the guarded backdrop helper instead of click-only dismissal", () => {
  const helper = functionSource("bindBackdropDismissal");
  assert.match(helper, /addEventListener\("pointerdown"/);
  assert.match(helper, /addEventListener\("pointerup"/);
  assert.match(helper, /addEventListener\("pointercancel"/);
  assert.match(appSource, /bindBackdropDismissal\(modal,\s*closeModal\)/);
  assert.match(appSource, /bindBackdropDismissal\(drawer,\s*closeDrawer\)/);
  assert.doesNotMatch(appSource, /modal\.addEventListener\("click"[^\n]+event\.target\s*===\s*modal/);
  assert.doesNotMatch(appSource, /drawer\.addEventListener\("click"[^\n]+event\.target\s*===\s*drawer/);
});

test("Electron smoke covers a customer-name drag and a genuine backdrop dismissal", () => {
  const actionName = "customer-modal-drag-dismissal";
  const smoke = smokeActionSource(actionName);
  assert.match(smoke, /customerForm/);
  assert.match(smoke, /elements\.name|\[name=["']name["']\]/);
  assert.match(smoke, /new PointerEvent\(/);
  assert.ok((smoke.match(/["']pointerdown["']/g) || []).length >= 2,
    "the smoke should exercise both the selection drag and a direct backdrop press");
  assert.ok((smoke.match(/["']pointerup["']/g) || []).length >= 2,
    "the smoke should exercise both the selection drag and a direct backdrop release");
  assert.match(smoke, /classList\.contains\(["']open["']\)/);
  assert.match(smoke, /\.value/);
  assert.match(smoke, /pass\s*:/);
  assert.ok((mainSource.match(new RegExp(actionName, "g")) || []).length >= 2,
    "the smoke result should be persisted through the screenshot result allowlist");
});

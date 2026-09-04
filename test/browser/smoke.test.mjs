/**
 * index.html(업무 흐름 빌더) 스모크 테스트.
 * 이 앱은 그동안 자동 테스트가 하나도 없었다. 최소한 "열리고, 그려지고,
 * 저장되고, 실패하면 알린다"는 것만은 회귀 없이 지키기 위한 테스트다.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { openApp } from "./harness.mjs";

test("로컬 모드로 부팅하고 시드 보드를 그린다", async () => {
  const app = await openApp();
  try {
    const state = await app.page.evaluate(() => ({
      configured: isConfigured,
      conn: document.getElementById("conn").textContent.trim(),
      nodeCount: Object.keys(nodes).length,
      rendered: document.querySelectorAll("g.node").length,
    }));

    assert.equal(state.configured, false, "테스트는 반드시 로컬 모드여야 한다(실 DB 접속 금지)");
    assert.match(state.conn, /로컬 모드/);
    assert.ok(state.nodeCount > 0, "시드 노드가 있어야 한다");
    assert.equal(state.rendered, state.nodeCount, "모든 노드가 화면에 그려져야 한다");
    assert.deepEqual(app.pageErrors, [], "부팅 중 자바스크립트 오류가 없어야 한다");
  } finally {
    await app.close();
  }
});

test("APP_VERSION 과 CHANGELOG 최신 항목의 버전이 일치한다", async () => {
  const app = await openApp();
  try {
    const { version, latest } = await app.page.evaluate(() => ({
      version: APP_VERSION,
      latest: CHANGELOG[0].v,
    }));
    assert.equal(
      version,
      latest,
      "APP_VERSION 을 올렸다면 CHANGELOG 맨 위에도 같은 버전을 적어야 한다",
    );
  } finally {
    await app.close();
  }
});

test("노드를 추가하면 화면과 로컬 저장소에 반영된다", async () => {
  const app = await openApp();
  try {
    const before = await app.page.evaluate(() => Object.keys(nodes).length);
    await app.page.evaluate(() => addRoot());
    const after = await app.page.evaluate(() => ({
      count: Object.keys(nodes).length,
      rendered: document.querySelectorAll("g.node").length,
      saved: Object.keys(JSON.parse(localStorage.getItem(graphKey(curBoard))).nodes).length,
    }));

    assert.equal(after.count, before + 1, "노드가 하나 늘어야 한다");
    assert.equal(after.rendered, after.count, "추가한 노드가 화면에 그려져야 한다");
    assert.equal(after.saved, after.count, "로컬 저장소에도 반영돼야 한다");
    assert.deepEqual(app.pageErrors, []);
  } finally {
    await app.close();
  }
});

test("저장 실패는 조용히 넘어가지 않고 화면에 표시된다", async () => {
  const app = await openApp();
  try {
    // 실패한 쓰기를 감시했을 때 알림이 뜨는지
    // 블록 본문 — 거부된 Promise 를 evaluate 밖으로 돌려주지 않는다.
    await app.page.evaluate(() => {
      watchWrite(Promise.reject(new Error("PERMISSION_DENIED")), "케이스");
    });
    await app.page.waitForSelector(".data-alert", { state: "visible", timeout: 5000 });

    const alertText = await app.page.textContent(".data-alert");
    assert.match(alertText, /저장 실패/);
    assert.match(alertText, /케이스/, "무엇이 실패했는지 알려줘야 한다");
    assert.match(alertText, /PERMISSION_DENIED/, "원인을 함께 보여줘야 한다");

    // 닫기 버튼이 동작해야 한다
    await app.page.click(".data-alert button");
    assert.equal(await app.page.isVisible(".data-alert"), false, "닫기를 누르면 사라져야 한다");
  } finally {
    await app.close();
  }
});

test("불러오기 실패는 저장 실패와 다른 안내를 보여준다", async () => {
  const app = await openApp();
  try {
    await app.page.evaluate(() => reportLoadError(new Error("network down")));
    await app.page.waitForSelector(".data-alert", { state: "visible", timeout: 5000 });
    const text = await app.page.textContent(".data-alert");
    assert.match(text, /불러오기 실패/);
    assert.match(text, /새로고침/, "사용자가 할 행동을 알려줘야 한다");
  } finally {
    await app.close();
  }
});

test("정상적으로 저장되면 알림이 뜨지 않는다", async () => {
  const app = await openApp();
  try {
    await app.page.evaluate(() => {
      watchWrite(Promise.resolve("ok"), "케이스");
    });
    await app.page.waitForTimeout(200);
    assert.equal(
      await app.page.isVisible(".data-alert"),
      false,
      "성공한 저장에는 알림이 뜨면 안 된다",
    );
  } finally {
    await app.close();
  }
});

test("손가락 입력에서 조작 핸들의 히트 영역이 넓어진다", async () => {
  const app = await openApp();
  try {
    const pads = await app.page.evaluate(() => {
      const node = document.querySelector("g.node");
      const list = [...node.querySelectorAll(".hitpad")];
      return {
        count: list.length,
        radii: list.map((el) => Number(el.getAttribute("r"))),
        // 히트 영역은 기능 클래스를 함께 가져야 기존 이벤트 처리가 그대로 동작한다
        keepsPortClass: !!node.querySelector(".hitpad.port"),
        keepsSwatchClass: !!node.querySelector(".hitpad.swatch"),
        insideDel: !!node.querySelector("g.del .hitpad"),
        insideNote: !!node.querySelector("g.note .hitpad"),
      };
    });

    assert.equal(pads.count, 4, "연결·색·삭제·상세 네 곳 모두 히트 영역이 있어야 한다");
    assert.ok(pads.radii.every((r) => r >= 16), `히트 반지름이 16 이상이어야 한다: ${pads.radii}`);
    assert.ok(pads.keepsPortClass && pads.keepsSwatchClass, "기능 클래스를 유지해야 한다");
    assert.ok(pads.insideDel && pads.insideNote, "삭제·상세 버튼에도 있어야 한다");
  } finally {
    await app.close();
  }
});

test("마우스 환경에서는 히트 영역이 렌더링되지 않아 동작이 바뀌지 않는다", async () => {
  const app = await openApp();
  try {
    const display = await app.page.evaluate(() =>
      getComputedStyle(document.querySelector(".hitpad")).display,
    );
    assert.equal(display, "none", "fine 포인터에서는 히트 영역이 꺼져 있어야 한다");
  } finally {
    await app.close();
  }
});

test("모바일(터치) 환경에서 히트 영역이 실제로 켜진다", async () => {
  const app = await openApp({ mobile: true });
  try {
    const state = await app.page.evaluate(() => {
      const note = document.querySelector("g.node g.note");
      const pad = note.querySelector(".hitpad");
      const icon = note.querySelector("circle:not(.hitpad)");
      const padStyle = getComputedStyle(pad);
      return {
        coarse: window.matchMedia("(pointer: coarse)").matches,
        display: padStyle.display,
        pointerEvents: padStyle.pointerEvents,
        padWidth: pad.getBoundingClientRect().width,
        iconWidth: icon.getBoundingClientRect().width,
      };
    });

    assert.equal(state.coarse, true, "모바일 에뮬레이션이 coarse 포인터여야 한다");
    assert.equal(state.display, "block", "터치 환경에서는 히트 영역이 켜져야 한다");
    assert.notEqual(state.pointerEvents, "none", "히트 영역이 입력을 받아야 한다");
    assert.ok(
      state.padWidth > state.iconWidth,
      `히트 영역이 보이는 아이콘보다 커야 한다 (pad ${state.padWidth} vs icon ${state.iconWidth})`,
    );
  } finally {
    await app.close();
  }
});

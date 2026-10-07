const assert = require("node:assert/strict");
const test = require("node:test");

const D = require("../src/delivery-core");

const file = (id = "f1") => ({ id, title: "견적서.pdf", driveFileId: `d_${id}`, webViewLink: "https://drive.google.com/x" });
const flow = (patch = {}) => D.normalizeFlow(Object.assign({
  id: "fl1", buildingId: "b1", buildingName: "우산동 빌딩", title: "공용부 청소 위탁",
}, patch));

// 앞 단계를 결과물까지 갖춰 닫아 둔 흐름을 만든다. 순서가 있는 화면이라
// 뒤 단계를 검사하려면 앞을 먼저 지나와야 한다.
function upTo(stopKey) {
  let current = flow();
  for (const key of D.STAGE_KEYS) {
    if (key === stopKey) break;
    const stage = D.stageOf(key);
    for (let index = 0; index < stage.minFiles; index += 1) {
      const added = D.attachFile({ flow: current, stage: key, file: file(`${key}${index}`) });
      assert.equal(added.ok, true, `${key} 결과물 붙이기`);
      current = added.flow;
    }
    const moved = D.moveStage({ flow: current, stage: key, next: "done", actorName: "대표", now: "2026-09-06T00:00:00.000Z" });
    assert.equal(moved.ok, true, `${key} 완료`);
    current = moved.flow;
  }
  return current;
}

test("단계 순서가 대표가 말한 그대로다", () => {
  assert.deepEqual(D.STAGE_KEYS.slice(), ["quote", "photos", "plan", "result", "completion"]);
  assert.deepEqual(D.STAGES.map(item => item.label), [
    "견적서", "현장 사진", "위탁 계획서", "단건 계약 결과보고서", "개발 완료 보고서",
  ]);
});

test("건물과 제목이 없으면 진행을 만들 수 없다", () => {
  assert.equal(D.validateFlow({ id: "fl1", title: "x" }).code, "BUILDING_REQUIRED");
  assert.equal(D.validateFlow({ id: "fl1", buildingId: "b1" }).code, "TITLE_REQUIRED");
  assert.equal(D.validateFlow({ buildingId: "b1", title: "x" }).code, "VALIDATION_ERROR");
  assert.equal(D.validateFlow({ id: "fl1", buildingId: "b1", title: "x" }).ok, true);
});

test("앞 단계가 안 끝나면 다음이 안 열린다", () => {
  const fresh = flow();
  assert.equal(D.blockedBy(fresh, "quote"), null, "첫 단계는 늘 열려 있다");
  assert.equal(D.blockedBy(fresh, "photos"), "quote");
  assert.equal(D.isOpen(fresh, "plan"), false);
  const blocked = D.moveStage({ flow: fresh, stage: "photos", next: "doing" });
  assert.equal(blocked.code, "STAGE_BLOCKED");
  assert.match(blocked.error, /견적서/u);
  // 붙이는 것도 막는다. 붙일 수 있으면 순서가 없는 것과 같다.
  assert.equal(D.attachFile({ flow: fresh, stage: "plan", file: file() }).code, "STAGE_BLOCKED");
});

test("결과물 없이 완료할 수 없다", () => {
  // 결과물 없는 '완료' 는 말뿐이다.
  const fresh = flow();
  assert.equal(D.moveStage({ flow: fresh, stage: "quote", next: "done" }).code, "FILE_REQUIRED");
  const withFile = D.attachFile({ flow: fresh, stage: "quote", file: file() }).flow;
  assert.equal(D.moveStage({ flow: withFile, stage: "quote", next: "done" }).ok, true);
});

test("현장 사진은 한 장으로 끝낼 수 없다", () => {
  // 한 장짜리 '현장 사진' 은 사진이 아니다. 분쟁 때 각도 하나로는 아무것도 못 한다.
  let current = upTo("photos");
  assert.equal(D.stageOf("photos").minFiles, 3);
  current = D.attachFile({ flow: current, stage: "photos", file: file("p1") }).flow;
  current = D.attachFile({ flow: current, stage: "photos", file: file("p2") }).flow;
  const short = D.moveStage({ flow: current, stage: "photos", next: "done" });
  assert.equal(short.code, "FILE_REQUIRED");
  assert.match(short.error, /3장/u);
  current = D.attachFile({ flow: current, stage: "photos", file: file("p3") }).flow;
  assert.equal(D.moveStage({ flow: current, stage: "photos", next: "done" }).ok, true);
});

test("건너뛰려면 이유가 있어야 한다", () => {
  const fresh = flow();
  assert.equal(D.moveStage({ flow: fresh, stage: "quote", next: "skipped" }).code, "SKIP_REASON_REQUIRED");
  const skipped = D.moveStage({ flow: fresh, stage: "quote", next: "skipped", skipReason: "구두로 합의함" });
  assert.equal(skipped.ok, true);
  assert.equal(skipped.flow.stages.quote.skipReason, "구두로 합의함");
  // 건너뛴 것도 닫힌 것이라 다음이 열린다. 현장은 순서대로 안 굴러간다.
  assert.equal(D.blockedBy(skipped.flow, "photos"), null);
});

test("끝난 단계는 되돌리지 못한다", () => {
  const done = upTo("photos");
  const back = D.moveStage({ flow: done, stage: "quote", next: "doing" });
  assert.equal(back.code, "STAGE_CLOSED");
  // 다시 해야 하면 결과물을 하나 더 붙인다.
  const added = D.attachFile({ flow: done, stage: "quote", file: file("again") });
  assert.equal(added.ok, true);
  assert.equal(added.flow.stages.quote.files.length, 2);
  assert.equal(added.flow.stages.quote.status, "done", "붙였다고 완료가 풀리지는 않는다");
});

test("결과물을 붙이면 대기에서 진행 중으로 저절로 넘어간다", () => {
  // 상태를 따로 눌러야 하면 그 단추를 안 누르고 파일만 올린다.
  const fresh = flow();
  assert.equal(fresh.stages.quote.status, "waiting");
  const added = D.attachFile({ flow: fresh, stage: "quote", file: file() });
  assert.equal(added.flow.stages.quote.status, "doing");
});

test("같은 결과물을 두 번 붙이면 하나로 남는다", () => {
  let current = D.attachFile({ flow: flow(), stage: "quote", file: file("f1") }).flow;
  current = D.attachFile({ flow: current, stage: "quote", file: Object.assign(file("f1"), { title: "견적서_수정.pdf" }) }).flow;
  assert.equal(current.stages.quote.files.length, 1);
  assert.equal(current.stages.quote.files[0].title, "견적서_수정.pdf");
});

test("Drive 밖 링크는 안 받는다", () => {
  // 사내 파일 경로가 들어오면 다른 사람 화면에서는 열리지 않는다.
  assert.equal(D.normalizeFile({ id: "f", driveFileId: "d", webViewLink: "http://x.test/a" }).webViewLink, "");
  assert.equal(D.normalizeFile({ id: "f", driveFileId: "d", webViewLink: "C:\\\\문서\\\\견적.pdf" }).webViewLink, "");
  assert.equal(D.normalizeFile({ id: "f", driveFileId: "d", webViewLink: "https://x.test/a" }).webViewLink, "https://x.test/a");
});

test("Drive 에 없는 파일은 못 붙인다", () => {
  assert.equal(D.attachFile({ flow: flow(), stage: "quote", file: { id: "f1" } }).code, "FILE_REQUIRED");
});

test("지금 해야 할 일 한 줄을 준다", () => {
  assert.equal(D.currentStage(flow()), "quote");
  assert.equal(D.nextAction(flow()).label, "견적서");
  assert.match(D.nextAction(flow()).text, /건물주에게 견적서를 보내고/u);
  const finished = upTo("__none");
  assert.equal(D.currentStage(finished), null);
  assert.equal(D.nextAction(finished).done, true);
  assert.match(D.nextAction(finished).text, /입금만 남았습니다/u);
});

test("진행률은 닫힌 단계로 센다", () => {
  assert.equal(D.progress(flow()), 0);
  assert.equal(D.progress(upTo("photos")), 20);
  assert.equal(D.progress(upTo("result")), 60);
  assert.equal(D.progress(upTo("__none")), 100);
});

test("요약은 어느 단계에 몇 건이 걸려 있는지 센다", () => {
  const sum = D.summarize([flow({ id: "a" }), upTo("plan"), upTo("__none")]);
  assert.equal(sum.total, 3);
  assert.equal(sum.finished, 1);
  assert.equal(sum.running, 2);
  assert.equal(sum.counts.quote, 1);
  assert.equal(sum.counts.plan, 1);
  assert.equal(sum.counts.completion, 0);
});

test("손이 가야 하는 것부터 보여 준다", () => {
  const list = D.sortFlows([
    Object.assign(upTo("__none"), { id: "done", buildingName: "가" }),
    Object.assign(upTo("result"), { id: "late", buildingName: "나" }),
    Object.assign(flow({ id: "new", buildingName: "다" })),
  ]);
  assert.deepEqual(list.map(item => item.id), ["new", "late", "done"]);
});

test("모르는 단계·상태는 받지 않는다", () => {
  assert.equal(D.moveStage({ flow: flow(), stage: "결제", next: "done" }).code, "STAGE_UNKNOWN");
  assert.equal(D.moveStage({ flow: flow(), stage: "quote", next: "취소" }).code, "STATUS_UNKNOWN");
  assert.equal(D.normalizeStage({ status: "아무거나" }).status, "waiting");
});

test("진행을 찾을 수 있다", () => {
  assert.equal(D.findFlow([flow()], "fl1").buildingName, "우산동 빌딩");
  assert.equal(D.findFlow([flow()], "없음"), null);
  assert.equal(D.findFlow([flow()], ""), null);
});

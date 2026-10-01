"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Automation = require("../src/monthly-report-automation");
const Drive = require("../src/building-monthly-report-drive");
const AI = require("../src/building-monthly-report-ai");
const { createMonthlyPhotoSourceStore, normalizeFolder } = require("../src/monthly-photo-source");

const folder = (id, name) => ({ id: id.padEnd(12, "0"), name, kind: "folder" });
const root = folder("root", "07. 건물 임대차 & 활동 사진");
const photos = Array.from({ length: 53 }, (_, n) => ({ id: `photo_${n}`, date: `2026-09-${String(n % 26 + 1).padStart(2, "0")}`, activityName: "청소" }));
const goodDraft = { ok: true, narrative: { summary: "확인된 관리 기록 요약" } };

test("한 번의 실행으로 검색 → 24장 단위 검토 → 12장 이하 초안을 순서대로 만든다", async () => {
  const events = [];
  const result = await Automation.run({
    isCurrent: () => true,
    find: async () => { events.push("find"); return { ok: true, photos }; },
    select: async batch => { events.push(batch.length); return { ok: true, selected: batch.map(p => ({ id: p.id, caption: "바닥 상태 확인" })) }; },
    draft: async selected => { events.push("draft"); assert.equal(selected.length, 12); assert.equal(new Set(selected.map(p => p.date)).size, 12); return goodDraft; },
  });
  assert.deepEqual(events, ["find", 24, 24, 5, "draft"]);
  assert.equal(result.candidates.length, 53);
  assert.equal(result.warning, "");
});

test("사진이 없는 달도 명확한 경고와 함께 CRM 초안을 작성한다", async () => {
  const result = await Automation.run({ isCurrent: () => true, find: async () => ({ ok: true, photos: [] }), select: () => assert.fail(), draft: async selected => { assert.deepEqual(selected, []); return goodDraft; } });
  assert.match(result.warning, /일치하는 사진이 없습니다/u);
});

test("검색 제한·누락 경고를 사진 선택 이후에도 유지한다", async () => {
  const result = await Automation.run({ isCurrent: () => true, find: async () => ({ ok: true, photos: photos.slice(0, 1), truncated: true }), select: async () => ({ ok: true, selected: [], warnings: ["변환 실패"] }), draft: async () => goodDraft });
  assert.match(result.warning, /일부만/u);
  assert.match(result.warning, /변환 실패/u);
});

test("선택 건물·월·계정 변경 후에는 다음 AI 호출을 하지 않는다", async () => {
  let current = true;
  await assert.rejects(Automation.run({ isCurrent: () => current, find: async () => { current = false; return { ok: true, photos }; }, select: () => assert.fail(), draft: () => assert.fail() }), { code: "REPORT_CHANGED" });
});

test("부분 실패와 후보에 없는 Gemini ID는 보고서 생성까지 진행하지 않는다", async () => {
  for (const select of [async () => { throw new Error("일시 오류"); }, async () => ({ ok: true, selected: [{ id: "not-listed" }] })]) {
    await assert.rejects(Automation.run({ isCurrent: () => true, find: async () => ({ ok: true, photos }), select, draft: () => assert.fail() }));
  }
});

test("폴더명은 날짜와 건물을 정확하게 맞추며 비슷한 다른 건물은 제외한다", () => {
  assert.equal(Drive.parseActivityFolderName("260915_햇빛빌라2(청소)", "2026-09", "햇빛빌라", ""), null);
  assert.equal(Drive.parseActivityFolderName("20260915_햇빛 빌라(청소)", "2026-09", "햇빛빌라", "").date, "2026-09-15");
  assert.equal(Drive.parseActivityFolderName("260931_햇빛빌라(청소)", "2026-09", "햇빛빌라", ""), null);
});

test("지정한 폴더 아래 그룹을 찾되 다른 건물·다른 월 폴더 안은 탐색하지 않는다", async () => {
  const group = folder("group", "활동 사진");
  const wanted = folder("wanted", "260915_햇빛빌라(청소)");
  const excluded = [folder("other", "260915_다른빌라(청소)"), folder("august", "260815_햇빛빌라(청소)")];
  const visited = [];
  const result = await Drive.findActivityFolders({ root, month: "2026-09", buildingName: "햇빛빌라", list: async f => {
    visited.push(f.id);
    return { folders: f.id === root.id ? [group, ...excluded] : [wanted], truncated: false };
  } });
  assert.deepEqual(visited, [root.id, group.id]);
  assert.equal(result.folders[0].item.id, wanted.id);
  assert.equal(result.truncated, false);
});

test("중첩·순환·대량 폴더는 제한 안에서 종료하고 누락을 알린다", async () => {
  let calls = 0;
  const result = await Drive.findActivityFolders({ root, month: "2026-09", buildingName: "빌라", list: async () => { calls++; return { folders: [root, ...Array.from({ length: 180 }, (_, n) => folder(`child${n}`, "자료"))] }; } });
  assert.ok(calls <= 60);
  assert.equal(result.truncated, true);
});

test("과거 날짜 폴더가 많아도 해당 월 폴더가 탐색 큐에서 밀려나지 않는다", async () => {
  const wanted = folder("wanted", "260915_햇빛빌라(청소)");
  const result = await Drive.findActivityFolders({ root, month: "2026-09", buildingName: "햇빛빌라", list: async () => ({ folders: [...Array.from({ length: 220 }, (_, n) => folder(`old${n}`, "250101_햇빛빌라(청소)")), folder("year", "2025년"), wanted] }) });
  assert.equal(result.folders.length, 1);
  assert.equal(result.folders[0].item.id, wanted.id);
  assert.equal(result.truncated, false);
});

test("사진 관찰은 CRM 완료 건수를 바꾸지 않으며 캐시 자료에도 포함된다", () => {
  const report = { month: "2026-09", works: [], summary: { workCount: 0, doneCount: 0 }, photoEvidence: [{ date: "2026-09-15", kind: "청소", caption: "계단 바닥 상태", secret: "do-not-send" }] };
  const source = AI.publicReportSource(report, "");
  assert.equal(source.metrics.doneCount, 0);
  assert.equal(source.photoEvidence[0].observation, "계단 바닥 상태");
  assert.doesNotMatch(JSON.stringify(source), /do-not-send/u);
  assert.match(AI.promptForBuildingMonthlyNarrative(source), /사진만으로/u);
  assert.notEqual(AI.prepareBuildingMonthlyNarrative(report).fingerprint, AI.prepareBuildingMonthlyNarrative({ ...report, photoEvidence: [] }).fingerprint);
});

test("활동사진 폴더 기억은 암호화·CRM 계정·Google 계정별로 격리된다", async () => {
  const files = new Map();
  const fs = { stat: async p => { if (!files.has(p)) throw Object.assign(new Error(), { code: "ENOENT" }); return { size: files.get(p).length }; }, readFile: async p => files.get(p), mkdir: async () => {}, writeFile: async (p, v) => files.set(p, v), rename: async (a, b) => { files.set(b, files.get(a)); files.delete(a); }, unlink: async p => files.delete(p) };
  const options = { fs, directory: "test-source", safeStorage: {}, encode: (_, value) => JSON.stringify({ encrypted: true, value }), decode: (_, value) => JSON.parse(value) };
  const store = createMonthlyPhotoSourceStore(options);
  assert.equal(await store.load("user-a", "a@example.test"), null);
  await store.save("user-a", "a@example.test", root);
  assert.equal((await createMonthlyPhotoSourceStore(options).load("user-a", "a@example.test")).id, root.id);
  assert.equal(await store.load("user-b", "a@example.test"), null);
  assert.equal(await store.load("user-a", "b@example.test"), null);
  assert.equal(normalizeFolder({ id: "../../unsafe", name: "unsafe" }), null);
  assert.equal(normalizeFolder({ id: "root", name: "내 드라이브" }), null);
  for (const key of files.keys()) assert.doesNotMatch(key, /user-a|example/u);
});

test("암호화되지 않는 저장소에서는 폴더 설정도 평문으로 저장하지 않는다", async () => {
  const store = createMonthlyPhotoSourceStore({ fs: { writeFile: () => assert.fail() }, directory: "test", encode: () => "{}", decode: () => ({ encrypted: false }) });
  await assert.rejects(store.save("a", "account", root), /안전한/u);
});

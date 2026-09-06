const assert = require("node:assert/strict");
const test = require("node:test");

const Docs = require("../src/building-docs-core");

const throwsCode = (fn, code) => {
  assert.throws(fn, error => {
    assert.equal(error.code, code, `기대한 코드 ${code}, 실제 ${error && error.code}`);
    return true;
  });
};

const documents = [
  { id: "doc_a1", buildingId: "b1", driveFileId: "a1AbCdef123", docType: "management_contract",
    title: "우산동 위탁계약서", modifiedAt: "2026-08-01T00:00:00.000Z" },
  { id: "doc_a2", buildingId: "b1", driveFileId: "a2AbCdef123", docType: "handover",
    title: "열쇠·비밀번호 인수인계 확인서", modifiedAt: "2026-08-05T00:00:00.000Z" },
  { id: "doc_a3", buildingId: "b1", driveFileId: "a3AbCdef123", docType: "inspection",
    title: "8월 점검", modifiedAt: "2026-08-20T00:00:00.000Z" },
  { id: "doc_a4", buildingId: "b1", driveFileId: "a4AbCdef123", docType: "inspection",
    title: "7월 점검", modifiedAt: "2026-07-20T00:00:00.000Z" },
  { id: "doc_a5", buildingId: "b1", driveFileId: "a5AbCdef123", docType: "photo",
    title: "지난 사진", archivedAt: "2026-08-30T00:00:00.000Z" },
  // b2 는 위탁계약서만 있고 인수인계 확인서가 없다.
  { id: "doc_b1", buildingId: "b2", driveFileId: "b1AbCdef123", docType: "management_contract",
    title: "단계동 위탁계약서", modifiedAt: "2026-08-10T00:00:00.000Z" },
];

test("건물 하나의 문서함을 종류별로 묶는다", () => {
  const box = Docs.buildBuildingBox(documents, "b1");
  assert.equal(box.buildingId, "b1");
  assert.equal(box.total, 4, "보관한 것은 빼고 센다");
  assert.equal(box.archivedCount, 1);
  const inspection = box.byType.find(group => group.key === "inspection");
  assert.equal(inspection.documents.length, 2);
  assert.equal(inspection.documents[0].title, "8월 점검", "최근 것이 먼저 온다");
});

test("빠진 필수 서류를 짚는다", () => {
  assert.deepEqual(Docs.buildBuildingBox(documents, "b1").missingRequired, []);
  const b2 = Docs.buildBuildingBox(documents, "b2");
  assert.equal(b2.missingRequired.length, 1);
  assert.equal(b2.missingRequired[0].key, "handover");
  assert.equal(b2.missingRequired[0].label, "열쇠·비밀번호 인수인계 확인서");
});

test("서류가 하나도 없는 건물도 빈 함으로 나온다", () => {
  // 0건인 건물과 아직 정리 안 한 건물을 구분할 수 있어야 한다.
  const empty = Docs.buildBuildingBox(documents, "b9");
  assert.equal(empty.total, 0);
  assert.equal(empty.missingRequired.length, 2, "필수 두 가지가 다 빠진 것으로 나온다");
  assert.equal(Docs.buildBuildingBox([], "b1").total, 0);
});

test("건물 목록 요약은 빠진 게 많은 건물을 앞에 둔다", () => {
  const summary = Docs.summarize(documents, [
    { id: "b1", name: "우산동 다가구" },
    { id: "b2", name: "단계동 원룸" },
    { id: "b3", name: "무실동 상가" },
  ]);
  assert.equal(summary[0].buildingId, "b3", "하나도 없는 건물이 가장 앞");
  assert.equal(summary[0].missingRequired.length, 2);
  assert.equal(summary[1].buildingId, "b2");
  assert.equal(summary[2].buildingId, "b1");
  assert.equal(summary[2].missingRequired.length, 0);
  assert.equal(summary[2].total, 4);
});

test("메모에 출입 비밀번호를 적으면 등록을 막는다", () => {
  // 여기서 막지 않으면 출입 수단이 백업·화면·보고서 곳곳으로 퍼진다.
  for (const memo of [
    "현관 비밀번호 1234*",
    "도어락 9812#",
    "출입 비번 4455",
    "key code 7788",
    "열쇠 보관함 0000",
  ]) {
    throwsCode(
      () => Docs.validateRegisterRequest({ buildingId: "b1", driveFileId: "a1AbCdef123", memo }),
      "ACCESS_SECRET_FORBIDDEN",
    );
  }
});

test("서류 이름에 열쇠가 들어가는 것은 막지 않는다", () => {
  // "열쇠·비밀번호 인수인계 확인서" 는 실제로 있는 서류 이름이다.
  // 번호가 같이 붙었을 때만 잡아야 한다.
  assert.equal(Docs.findsAccessSecret("열쇠·비밀번호 인수인계 확인서"), false);
  assert.equal(Docs.findsAccessSecret("도어락 교체 작업 완료"), false);
  assert.equal(Docs.findsAccessSecret("현관 청소 사진"), false);
  assert.equal(Docs.findsAccessSecret(""), false);
  const record = Docs.validateRegisterRequest({
    buildingId: "b1", driveFileId: "a1AbCdef123",
    docType: "handover", memo: "열쇠·비밀번호 인수인계 확인서 원본 보관",
  });
  assert.equal(record.docType, "handover");
});

test("건물과 Drive 파일이 있어야 등록한다", () => {
  throwsCode(() => Docs.validateRegisterRequest({ driveFileId: "a1AbCdef123" }), "BUILDING_REQUIRED");
  throwsCode(() => Docs.validateRegisterRequest({ buildingId: "b1", driveFileId: "짧음" }), "DRIVE_FILE_ID_INVALID");
  throwsCode(() => Docs.validateRegisterRequest({ buildingId: "b1" }), "DRIVE_FILE_ID_INVALID");
  throwsCode(() => Docs.validateRegisterRequest(null), "BUILDING_REQUIRED");
});

test("Drive 주소를 붙여넣어도 파일 ID 를 뽑는다", () => {
  const id = "1AbC_def-123456";
  assert.equal(Docs.extractDriveFileId(`https://drive.google.com/file/d/${id}/view?usp=sharing`), id);
  assert.equal(Docs.extractDriveFileId(`https://docs.google.com/document/d/${id}/edit`), id);
  assert.equal(Docs.extractDriveFileId(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`), id);
  assert.equal(Docs.extractDriveFileId(`https://drive.google.com/open?id=${id}`), id);
  assert.equal(Docs.extractDriveFileId(id), id);
  assert.equal(Docs.extractDriveFileId("https://example.com/파일"), "");
  assert.equal(Docs.extractDriveFileId(""), "");
});

test("모르는 종류는 기타로 떨어뜨린다", () => {
  const record = Docs.normalizeDocument({ buildingId: "b1", driveFileId: "a1AbCdef123", docType: "없는종류" });
  assert.equal(record.docType, "etc");
  assert.equal(Docs.typeLabel("없는종류"), "기타");
  assert.equal(Docs.typeLabel("management_contract"), "건물관리 위탁계약서");
});

test("필수 서류는 위탁계약서와 인수인계 확인서 둘이다", () => {
  const required = Docs.DOC_TYPES.filter(item => item.required).map(item => item.key);
  assert.deepEqual(required, ["management_contract", "handover"]);
});

test("결과는 얼려서 돌려준다", () => {
  const box = Docs.buildBuildingBox(documents, "b1");
  assert.ok(Object.isFrozen(box));
  assert.ok(Object.isFrozen(box.byType));
  assert.ok(Object.isFrozen(box.missingRequired));
  assert.ok(Object.isFrozen(Docs.DOC_TYPES));
});

const assert = require("node:assert/strict");
const test = require("node:test");

const F = require("../src/form-core");

const field = (patch = {}) => Object.assign({ key: "fabc12", order: 0, type: "check", label: "소화기 상태", required: true }, patch);
const template = (patch = {}) => Object.assign({ id: "t1", title: "점검 체크리스트", status: "active", fields: [field()] }, patch);

test("이름 없는 항목이나 빈 서식은 저장하지 않는다", () => {
  assert.equal(F.validateTemplate(template({ fields: [] })).code, "FIELDS_REQUIRED");
  assert.equal(F.validateTemplate(template({ fields: [field({ label: "" })] })).code, "FIELD_LABEL_REQUIRED");
  assert.equal(F.validateTemplate(template({ title: "" })).code, "TITLE_REQUIRED");
});

test("같은 항목이 두 번 들어가면 막는다", () => {
  // 열쇠가 겹치면 값이 서로를 덮어쓴다.
  const twice = template({ fields: [field(), field({ order: 1, label: "다른 이름" })] });
  assert.equal(F.validateTemplate(twice).code, "FIELD_KEY_DUPLICATE");
});

test("고르기 항목은 고를 것이 있어야 한다", () => {
  assert.equal(F.validateTemplate(template({ fields: [field({ type: "choice", choices: [] })] })).code, "CHOICES_REQUIRED");
  assert.equal(F.validateTemplate(template({ fields: [field({ type: "choice", choices: ["양호", "불량"] })] })).ok, true);
  // 고르기가 아닌 항목의 선택지는 조용히 버린다.
  assert.deepEqual(F.normalizeField({ key: "fabc12", type: "text", label: "x", choices: ["a"] }, 0).choices, []);
});

test("열쇠·출입 비밀번호는 어디에도 적지 못한다", () => {
  // 판정 기준은 문서함과 같다. 한쪽에서만 막으면 다른 쪽으로 들어온다.
  assert.equal(F.validateTemplate(template({ title: "현관 비밀번호 1234" })).code, "ACCESS_SECRET_FORBIDDEN");
  assert.equal(F.validateTemplate(template({ description: "도어락 9876#" })).code, "ACCESS_SECRET_FORBIDDEN");
  assert.equal(F.validateTemplate(template({ fields: [field({ label: "출입 비번 0417" })] })).code, "ACCESS_SECRET_FORBIDDEN");
  // 힌트 낱말만 있고 숫자가 없으면 막지 않는다. 둘 중 하나로 막으면 멀쩡한 문장이 걸린다.
  assert.equal(F.validateTemplate(template({ title: "열쇠 인수인계 확인서" })).ok, true);
});

test("항목을 바꾸면 판이 오르고, 이름만 바꾸면 그대로다", () => {
  // 이미 채운 문서가 어떤 판으로 채워졌는지 알아야 나중에 그대로 읽는다.
  const before = template();
  assert.equal(F.bumpVersion(null, before).version, 1);
  assert.equal(F.bumpVersion(before, template({ title: "이름만 바꿈" })).version, 1);
  assert.equal(F.bumpVersion(before, template({ description: "설명만" })).version, 1);
  assert.equal(F.bumpVersion(before, template({ fields: [field(), field({ key: "fzz999", order: 1, label: "비고" })] })).version, 2);
  assert.equal(F.bumpVersion(before, template({ fields: [field({ label: "소화기" })] })).version, 2);
  assert.equal(F.bumpVersion(before, template({ fields: [field({ required: false })] })).version, 2);
});

test("채운 문서는 그때 항목 이름을 함께 들고 있다", () => {
  // 이 한 줄 때문에 서식이 바뀌어도 옛 문서가 그대로 읽힌다.
  const entry = F.blankEntry(template(), { id: "e1", workDate: "2026-09-06" });
  assert.deepEqual(entry.answers, [{ key: "fabc12", label: "소화기 상태", value: "" }]);
  assert.equal(entry.templateVersion, 1);
  assert.equal(entry.templateTitle, "점검 체크리스트");
});

test("서식이 바뀌어도 옛 문서는 그때 이름대로 읽힌다", () => {
  const old = F.normalizeEntry({
    id: "e1", templateId: "t1", templateVersion: 1, templateTitle: "점검 체크리스트",
    workDate: "2026-01-05", status: "done",
    answers: [{ key: "fabc12", label: "소화기 상태", value: "이상 없음" }],
  });
  const read = F.readEntry(old);
  assert.equal(read.version, 1);
  assert.deepEqual(read.lines, [{ label: "소화기 상태", value: "이상 없음" }]);
});

test("필수를 안 채우면 완료로 못 두지만 임시 저장은 된다", () => {
  // 현장에서 반쯤 채우고 나오는 일이 잦다.
  const entry = F.blankEntry(template(), { id: "e1", workDate: "2026-09-06" });
  assert.equal(F.validateEntry(entry, template()).ok, true);
  const done = F.validateEntry(Object.assign({}, entry, { status: "done" }), template());
  assert.equal(done.code, "REQUIRED_MISSING");
  assert.match(done.error, /소화기 상태/u);
  const filled = Object.assign({}, entry, {
    status: "done", answers: [{ key: "fabc12", label: "소화기 상태", value: "예" }],
  });
  assert.equal(F.validateEntry(filled, template()).ok, true);
});

test("채운 값에도 열쇠·비밀번호는 적지 못한다", () => {
  const entry = F.blankEntry(template(), { id: "e1", workDate: "2026-09-06" });
  const bad = Object.assign({}, entry, {
    answers: [{ key: "fabc12", label: "특이사항", value: "현관 비밀번호 8214 로 변경" }],
  });
  assert.equal(F.validateEntry(bad, template()).code, "ACCESS_SECRET_FORBIDDEN");
});

test("작성일이 없으면 저장하지 않는다", () => {
  const entry = F.blankEntry(template(), { id: "e1" });
  assert.equal(F.validateEntry(entry, template()).code, "DATE_REQUIRED");
});

test("쓸 수 있는 서식은 사용 중인 것만이다", () => {
  const list = [template(), template({ id: "t2", status: "draft" }), template({ id: "t3", status: "retired" })];
  assert.deepEqual(F.usable(list).map(item => item.id), ["t1"]);
});

test("모르는 칸과 모르는 종류는 조용히 버린다", () => {
  const item = F.normalizeTemplate(template({ status: "published", formula: "a+b" }));
  assert.equal(item.status, "draft");
  assert.ok(!("formula" in item));
  assert.equal(F.normalizeField({ key: "fabc12", type: "signature", label: "x" }, 0).type, "text");
  // 사람이 지은 열쇠는 버린다. 한글 이름을 그대로 쓰면 이름을 고치는 순간 값과 끊긴다.
  assert.equal(F.normalizeField({ key: "소화기", type: "text", label: "x" }, 0).key, "");
});

test("항목 열쇠는 겹치지 않는 모양으로 짓는다", () => {
  const keys = new Set(Array.from({ length: 200 }, () => F.newFieldKey()));
  assert.ok(keys.size > 190, "열쇠가 너무 자주 겹친다");
  for (const key of keys) assert.match(key, /^f[0-9a-z]{4,16}$/u);
});

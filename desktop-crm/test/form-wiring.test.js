const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const MutationPolicy = require("../src/mutation-policy");
const FormCore = require("../src/form-core");
const BuildingDocs = require("../src/building-docs-core");
const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const mainSource = read("main.js");
const preloadSource = read("preload.js");
const remoteSource = read("remote.js");
const appSource = read("app.js");
const indexSource = read("index.html");
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "../../database.rules.json"), "utf8")).rules.crmCompany;
const tpl = rules.formTemplates.$templateId;
const entry = rules.formEntries.$entryId;

test("서식 채널이 세 곳에 다 등록돼 있다", () => {
  for (const channel of ["crm:form-template-save", "crm:form-entry-save"]) {
    assert.doesNotThrow(() => MutationPolicy.assertRegistered(channel), channel);
    assert.ok(mainSource.includes(`secureCanonicalHandle("${channel}"`), channel);
    assert.ok(preloadSource.includes(`"${channel}"`), channel);
    assert.equal(MutationPolicy.classification(channel), "mutation", channel);
  }
  assert.ok(mainSource.includes('secureHandle("crm:forms-load"'));
  assert.equal(MutationPolicy.classification("crm:forms-load"), "control");
});

test("마케팅 전용 계정은 서식을 만지지 못한다", () => {
  for (const channel of ["crm:form-template-save", "crm:form-entry-save"]) {
    assert.throws(
      () => MutationPolicy.assertChannelAllowed(channel, { accessRole: "member", marketingRole: "marketing" }),
      error => error.code === "MARKETING_ONLY_FORBIDDEN",
      channel,
    );
  }
});

test("서식은 관리자만 만들고, 조회 전용은 채우지 못한다", () => {
  const block = remoteSource.slice(
    remoteSource.indexOf("async saveFormTemplate"),
    remoteSource.indexOf("async loadVendorDirectory"),
  );
  assert.ok(block.length > 0);
  assert.match(block, /session\.role !== "admin"/u);
  assert.match(block, /FORM_TEMPLATE_FORBIDDEN/u);
  assert.match(block, /session\.role !== "admin" && session\.role !== "member"/u);
  assert.match(block, /FORM_ENTRY_FORBIDDEN/u);
  // 완료로 둔 작성은 다시 쓰지 못한다.
  assert.match(block, /FORM_ENTRY_DONE/u);
});

test("판은 서버에 있는 것을 다시 읽고 정한다", () => {
  // 화면이 오래됐으면 판이 뒤로 돌아가서, 이미 채운 문서가 어떤 판인지
  // 알 수 없게 된다.
  const saver = remoteSource.slice(
    remoteSource.indexOf("async saveFormTemplate"),
    remoteSource.indexOf("async saveFormEntry"),
  );
  assert.match(saver, /const existing = await this\.dbRequest\(location, \{ method: "GET" \}\)/u);
  assert.match(saver, /FormCore\.bumpVersion\(existing, checked\.template\)/u);
});

test("작성은 서버에 있는 서식으로 검사한다", () => {
  // 화면이 보낸 서식을 믿으면 필수 항목을 지운 채 완료로 둘 수 있다.
  const saver = remoteSource.slice(
    remoteSource.indexOf("async saveFormEntry"),
    remoteSource.indexOf("async loadVendorDirectory"),
  );
  assert.match(saver, /const template = await this\.dbRequest\(`formTemplates\/\$\{entry\.templateId\}`/u);
  assert.match(saver, /FormCore\.validateEntry\(entry, template\)/u);
});

test("규칙이 서식은 관리자만, 작성은 팀원까지 쓰게 한다", () => {
  assert.match(rules.formTemplates[".read"], /'member'/u);
  assert.equal(rules.formTemplates[".write"], false);
  assert.match(tpl[".write"], /role'\)\.val\(\) === 'admin'/u);
  assert.ok(!tpl[".write"].includes("'member'"), "팀원이 서식을 만들 수 있으면 안 된다");
  assert.match(entry[".write"], /'admin' \|\| root[^|]*'member'/u);
  assert.ok(!entry[".write"].includes("'viewer'"), "조회 전용이 채울 수 있으면 안 된다");
  // 지우면 그 서식으로 채운 문서를 못 읽는다.
  assert.match(tpl[".write"], /newData\.exists\(\)/u);
  assert.match(entry[".write"], /newData\.exists\(\)/u);
  // 확인서가 나중에 바뀌면 확인한 의미가 없다.
  assert.match(entry[".validate"], /data\.child\('status'\)\.val\(\) !== 'done'/u);
});

test("규칙이 열쇠·비밀번호를 서식과 작성 양쪽에서 막는다", () => {
  const guarded = [
    tpl.title[".validate"],
    tpl.description[".validate"],
    tpl.fields.$index.label[".validate"],
    tpl.fields.$index.hint[".validate"],
    tpl.fields.$index.choices.$choice[".validate"],
    entry.answers.$index.value[".validate"],
  ];
  for (const rule of guarded) {
    assert.match(rule, /비밀번호\|비번\|도어락/u);
    assert.match(rule, /\[0-9\]\[0-9 \*#-\]\{3,\}/u);
    // Firebase 규칙 정규식은 \s 를 모른다. 넣으면 규칙 자체가 안 실린다.
    assert.ok(!rule.includes("\\s"), "규칙 정규식에 \\s 가 들어갔다");
  }
});

test("화면과 서버가 같은 것을 열쇠·비밀번호로 본다", () => {
  // 한쪽에서만 막으면 다른 쪽으로 들어온다.
  for (const value of ["현관 비밀번호 1234", "도어락 9876#", "출입 비번 0417"]) {
    assert.equal(FormCore.findsAccessSecret(value), true, value);
    assert.equal(BuildingDocs.findsAccessSecret(value), true, value);
  }
  for (const value of ["열쇠 인수인계 확인서", "소화기 상태 양호"]) {
    assert.equal(FormCore.findsAccessSecret(value), false, value);
  }
});

test("규칙이 모르는 칸을 막는다", () => {
  assert.equal(tpl.$other[".validate"], false);
  assert.equal(tpl.fields.$index.$other[".validate"], false);
  assert.equal(entry.$other[".validate"], false);
  assert.equal(entry.answers.$index.$other[".validate"], false);
  for (const field of Object.keys(FormCore.normalizeTemplate({ id: "t" }))) {
    assert.ok(tpl[field] || field === "fields", `규칙에 없는 칸: ${field}`);
  }
  for (const field of Object.keys(FormCore.normalizeEntry({ id: "e" }))) {
    assert.ok(entry[field] || field === "answers", `규칙에 없는 칸: ${field}`);
  }
});

test("화면이 사이드바에서 열리고 form-core 가 app 보다 먼저 실린다", () => {
  const nav = indexSource.slice(indexSource.indexOf("<nav"), indexSource.indexOf("</nav>"));
  assert.equal((nav.match(/data-view="forms"/g) || []).length, 1);
  // 서식은 문서관리 폴더 — 건물 문서함 옆이 제자리다.
  assert.match(nav, /data-view="buildingDocuments"[\s\S]*?data-view="forms"/u);
  const coreAt = indexSource.indexOf('src="./form-core.js"');
  const docsAt = indexSource.indexOf('src="./building-docs-core.js"');
  const appAt = indexSource.indexOf('src="./app.js"');
  assert.ok(coreAt > 0 && coreAt < appAt);
  // form-core 가 building-docs-core 의 판정을 빌려 쓴다.
  assert.ok(docsAt > 0 && docsAt < coreAt, "building-docs-core 가 form-core 뒤에 있다");
  assert.match(appSource, /currentView === "forms"[\s\S]{0,40}renderForms\(\)/u);
});

test("고치던 항목을 잃지 않는다", () => {
  // 항목을 더하거나 뺄 때 화면에 적힌 것을 먼저 거두지 않으면, 방금 친
  // 글자가 다시 그려지면서 날아간다.
  const handler = appSource.slice(
    appSource.indexOf('if (event.target.closest("[data-form-field-add]"))'),
    appSource.indexOf('const messageMode = event.target.closest("[data-message-mode]")'),
  );
  assert.equal((handler.match(/readTemplateFromDom\(F\)/g) || []).length, 2, "추가와 빼기 양쪽에서 거둬야 한다");
});

// 서식. 점검 체크리스트·확인서 같은 것을 CRM 안에서 만들고, 그 서식으로
// 현장에서 채운다.
//
// 서식을 만드는 사람과 채우는 사람이 다르다. 관리자가 틀을 만들고, 현장이
// 채운다. 그래서 이 파일은 두 가지를 다룬다 — **서식(틀)** 과 **작성(채운
// 것)**.
//
// 여기서 제일 조심한 것
//
// **서식을 고쳐도 이미 채운 것이 흔들리지 않아야 한다.** 항목 하나를 지우면
// 작년에 채운 점검표에서 그 칸이 사라진다. 그러면 그 문서는 무엇을 확인한
// 것인지 알 수 없게 된다. 그래서 채운 문서는 값만 담지 않고 **그때 쓰인
// 항목 이름과 서식 판(version)을 함께 박아 둔다.** 서식이 바뀌어도 옛
// 문서는 그대로 읽힌다.
//
// **서식을 지우지 않는다.** 지우면 그 서식으로 채운 문서를 못 읽는다.
// 안 쓸 서식은 폐기로 두면 새로 고를 때 안 나온다.
//
// **열쇠와 출입 비밀번호는 적지 못하게 한다.** 항목 이름에도, 채운 값에도
// 마찬가지다. 판정 기준은 building-docs-core 와 같은 것을 쓴다 — 한쪽에서만
// 막으면 다른 쪽으로 들어온다.
//
// 하지 않는 것
//
// 1. 서식으로 PDF 를 만들지 않는다. 작업완료 확인서·월간 보고서는 각자
//    전용 출력이 이미 있다.
// 2. 계산식을 넣지 않는다. 서식이 스프레드시트가 되기 시작하면 끝이 없다.
// 3. 전자서명을 하지 않는다.
// 4. 항목 이름을 자동으로 옮기지 않는다. 서식을 고칠 때 옛 항목과 새 항목을
//    이어 붙이는 것은 사람이 판단할 일이다.
(function attachFormCore(root, factory) {
  const api = factory(
    typeof require === "function" ? require("./building-docs-core") : root.BringBuildingDocsCore,
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringFormCore = api;
})(typeof globalThis === "object" ? globalThis : this, function createFormCore(BuildingDocs) {
  "use strict";

  const text = (value, limit = 200) => String(value == null ? "" : value).trim().slice(0, limit);
  const rows = value => (Array.isArray(value) ? value.filter(Boolean) : []);
  const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(text(value, 10));

  // 열쇠·비밀번호 판정은 문서함과 같은 기준을 쓴다. 한쪽에서만 막으면
  // 다른 쪽으로 들어온다.
  const findsAccessSecret = value =>
    Boolean(BuildingDocs && typeof BuildingDocs.findsAccessSecret === "function"
      && BuildingDocs.findsAccessSecret(String(value == null ? "" : value)));

  const FIELD_TYPES = Object.freeze([
    { key: "text", label: "한 줄", hasChoices: false },
    { key: "longtext", label: "여러 줄", hasChoices: false },
    { key: "number", label: "숫자", hasChoices: false },
    { key: "date", label: "날짜", hasChoices: false },
    { key: "check", label: "예·아니오", hasChoices: false },
    { key: "choice", label: "고르기", hasChoices: true },
  ]);

  const STATUSES = Object.freeze([
    { key: "draft", label: "작성 중" },
    { key: "active", label: "사용 중" },
    { key: "retired", label: "폐기" },
  ]);

  const ENTRY_STATUSES = Object.freeze([
    { key: "draft", label: "임시 저장" },
    { key: "done", label: "작성 완료" },
  ]);

  const typeOf = key => FIELD_TYPES.find(item => item.key === text(key, 20)) || null;
  const statusLabel = key => (STATUSES.find(item => item.key === key) || {}).label || key;

  // 항목 열쇠는 사람이 짓지 않는다. 한글 이름을 그대로 쓰면 이름을 고치는
  // 순간 이미 채운 값과 이어지지 않는다.
  const FIELD_KEY = /^f[0-9a-z]{4,16}$/;

  function normalizeField(value, index) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const type = typeOf(source.type) ? text(source.type, 20) : "text";
    const key = FIELD_KEY.test(text(source.key, 20)) ? text(source.key, 20) : "";
    return {
      key,
      order: Number.isInteger(source.order) ? source.order : index,
      type,
      label: text(source.label, 120),
      hint: text(source.hint, 200),
      required: source.required === true,
      choices: (typeOf(type) || {}).hasChoices
        ? rows(source.choices).map(item => text(item, 60)).filter(Boolean).slice(0, 20)
        : [],
    };
  }

  function normalizeTemplate(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const status = STATUSES.some(item => item.key === source.status) ? source.status : "draft";
    const fields = rows(source.fields).map(normalizeField)
      .sort((a, b) => a.order - b.order)
      .map((field, index) => Object.assign({}, field, { order: index }));
    return {
      id: text(source.id, 80),
      title: text(source.title, 120),
      docType: text(source.docType, 40) || "etc",
      description: text(source.description, 500),
      status,
      version: Number.isInteger(source.version) && source.version >= 1 ? source.version : 1,
      fields,
      createdAt: text(source.createdAt, 40),
      updatedAt: text(source.updatedAt, 40),
      updatedBy: text(source.updatedBy, 128),
    };
  }

  function validateTemplate(input) {
    const template = normalizeTemplate(input);
    if (!template.id) return { ok: false, code: "ID_REQUIRED", error: "서식 번호가 없습니다." };
    if (!template.title) return { ok: false, code: "TITLE_REQUIRED", error: "서식 이름을 적어 주세요." };
    if (findsAccessSecret(`${template.title} ${template.description}`)) {
      return { ok: false, code: "ACCESS_SECRET_FORBIDDEN", error: "열쇠·출입 비밀번호는 서식에 적을 수 없습니다." };
    }
    if (!template.fields.length) {
      return { ok: false, code: "FIELDS_REQUIRED", error: "항목을 하나 이상 넣어 주세요." };
    }
    if (template.fields.length > 60) {
      return { ok: false, code: "TOO_MANY_FIELDS", error: "항목은 60개까지만 넣을 수 있습니다." };
    }
    const seen = new Set();
    for (const field of template.fields) {
      if (!field.key) return { ok: false, code: "FIELD_KEY_REQUIRED", error: "항목 열쇠가 없습니다. 항목을 다시 넣어 주세요." };
      // 열쇠가 겹치면 값이 서로를 덮어쓴다.
      if (seen.has(field.key)) return { ok: false, code: "FIELD_KEY_DUPLICATE", error: "같은 항목이 두 번 들어 있습니다." };
      seen.add(field.key);
      if (!field.label) return { ok: false, code: "FIELD_LABEL_REQUIRED", error: "이름이 비어 있는 항목이 있습니다." };
      if (findsAccessSecret(`${field.label} ${field.hint}`)) {
        return { ok: false, code: "ACCESS_SECRET_FORBIDDEN", error: `"${field.label}" 에 열쇠·출입 비밀번호로 보이는 값이 있습니다.` };
      }
      if ((typeOf(field.type) || {}).hasChoices && !field.choices.length) {
        return { ok: false, code: "CHOICES_REQUIRED", error: `"${field.label}" 은 고를 것을 적어야 합니다.` };
      }
    }
    return { ok: true, template };
  }

  // 서식을 고치면 판을 올린다. 이미 채운 문서가 어떤 판으로 채워졌는지
  // 알아야 나중에 그대로 읽을 수 있다. 이름·설명만 고친 것은 판을 올리지
  // 않는다 — 채운 값이 달라지지 않기 때문이다.
  function bumpVersion(before, after) {
    const previous = normalizeTemplate(before);
    const next = normalizeTemplate(after);
    if (!before) return Object.assign({}, next, { version: 1 });
    const shape = template => JSON.stringify(template.fields.map(field =>
      [field.key, field.type, field.label, field.required, field.choices.join("|")]));
    const changed = shape(previous) !== shape(next);
    return Object.assign({}, next, { version: changed ? previous.version + 1 : previous.version });
  }

  function newFieldKey() {
    return `f${Math.random().toString(36).slice(2, 8)}`;
  }

  // --- 작성 ---

  function normalizeEntry(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const status = ENTRY_STATUSES.some(item => item.key === source.status) ? source.status : "draft";
    const answers = rows(source.answers).map(item => {
      const answer = item && typeof item === "object" ? item : {};
      return {
        key: text(answer.key, 20),
        // 그때 쓰인 이름을 함께 박아 둔다. 서식이 바뀌어도 옛 문서가 그대로
        // 읽히게 하는 것이 이 한 줄이다.
        label: text(answer.label, 120),
        value: text(answer.value, 2000),
      };
    }).filter(answer => answer.key && answer.label);
    return {
      id: text(source.id, 80),
      templateId: text(source.templateId, 80),
      templateVersion: Number.isInteger(source.templateVersion) && source.templateVersion >= 1 ? source.templateVersion : 1,
      templateTitle: text(source.templateTitle, 120),
      buildingId: text(source.buildingId, 80),
      workDate: isDate(source.workDate) ? text(source.workDate, 10) : "",
      status,
      answers,
      createdAt: text(source.createdAt, 40),
      updatedAt: text(source.updatedAt, 40),
      updatedBy: text(source.updatedBy, 128),
    };
  }

  function validateEntry(input, template) {
    const entry = normalizeEntry(input);
    const form = template ? normalizeTemplate(template) : null;
    if (!entry.id) return { ok: false, code: "ID_REQUIRED", error: "작성 번호가 없습니다." };
    if (!entry.templateId) return { ok: false, code: "TEMPLATE_REQUIRED", error: "어떤 서식으로 쓸지 골라 주세요." };
    if (!entry.workDate) return { ok: false, code: "DATE_REQUIRED", error: "작성일을 적어 주세요." };
    for (const answer of entry.answers) {
      if (findsAccessSecret(answer.value)) {
        return {
          ok: false,
          code: "ACCESS_SECRET_FORBIDDEN",
          error: `"${answer.label}" 에 열쇠·출입 비밀번호로 보이는 값이 있습니다. 서류에는 적지 않습니다.`,
        };
      }
    }
    // 임시 저장은 비어 있어도 된다. 현장에서 반쯤 채우고 나오는 일이 잦다.
    if (entry.status === "done") {
      if (!form) return { ok: false, code: "TEMPLATE_MISSING", error: "서식을 찾지 못해 완료로 둘 수 없습니다." };
      const filled = new Map(entry.answers.map(answer => [answer.key, answer.value]));
      const missing = form.fields.filter(field => field.required && !text(filled.get(field.key), 2000));
      if (missing.length) {
        return {
          ok: false,
          code: "REQUIRED_MISSING",
          error: `${missing.map(field => field.label).join(", ")} 을(를) 채워야 완료로 둘 수 있습니다.`,
        };
      }
    }
    return { ok: true, entry };
  }

  // 서식으로 빈 작성지를 만든다. 이때 항목 이름을 값과 함께 박는다.
  function blankEntry(template, extra) {
    const form = normalizeTemplate(template);
    const more = extra && typeof extra === "object" ? extra : {};
    return normalizeEntry(Object.assign({
      templateId: form.id,
      templateVersion: form.version,
      templateTitle: form.title,
      status: "draft",
      answers: form.fields.map(field => ({ key: field.key, label: field.label, value: "" })),
    }, more));
  }

  // 채운 문서를 읽을 때 쓴다. 지금 서식이 아니라 그때 서식대로 보여 준다.
  function readEntry(entry) {
    const item = normalizeEntry(entry);
    return {
      id: item.id,
      title: item.templateTitle,
      version: item.templateVersion,
      workDate: item.workDate,
      status: item.status,
      lines: item.answers.map(answer => ({ label: answer.label, value: answer.value })),
    };
  }

  function usable(templates) {
    return rows(templates).map(normalizeTemplate)
      .filter(item => item.id && item.status === "active")
      .sort((a, b) => a.title.localeCompare(b.title, "ko"));
  }

  return Object.freeze({
    FIELD_TYPES,
    STATUSES,
    ENTRY_STATUSES,
    typeOf,
    statusLabel,
    newFieldKey,
    normalizeField,
    normalizeTemplate,
    validateTemplate,
    bumpVersion,
    normalizeEntry,
    validateEntry,
    blankEntry,
    readEntry,
    usable,
    findsAccessSecret,
    text,
    rows,
  });
});

// 수주 진행. 견적서를 낸 순간부터 입금까지 한 줄로 따라간다.
//
// 이 화면이 있는 이유는 서류를 모아 두는 것이 아니다. 서류는 이미 건물
// 문서함이 들고 있다. 여기가 다루는 것은 **지금 이 건물이 어디까지 왔는지,
// 그래서 다음에 무엇을 해야 하는지**다.
//
// 그게 없으면 이런 일이 난다. 견적서를 보내고 잊는다. 사진은 찍었는데 계획서를
// 안 썼다. 공사는 끝났는데 결과보고서를 안 보내서 입금이 안 들어온다.
// 어느 것도 "누가 게을러서"가 아니라 **어디까지 왔는지 아무도 안 보고 있어서**다.
//
// 단계는 다섯이고 순서가 있다
//
//   1. 견적서            무엇을 얼마에 할지 건물주에게 낸다
//   2. 현장 사진         하기 전 상태를 남긴다. 나중에 분쟁의 유일한 근거다
//   3. 위탁 계획서       무엇을 언제 어떻게 할지 문서로 맞춘다
//   4. 단건 계약 결과보고서  한 건이 끝났음을 보고한다
//   5. 개발 완료 보고서  전체가 끝났음을 보고한다 → 여기서 입금 이야기가 나온다
//
// **앞 단계가 안 끝나면 다음이 안 열린다.** 순서를 건너뛸 수 있게 두면 순서가
// 없는 것과 같다. 사진 없이 계획서를 쓰면 그 계획서는 짐작으로 쓴 것이고,
// 결과보고서를 계획서 없이 쓰면 무엇과 비교해 끝났다는 것인지 알 수 없다.
//
// 다만 **건너뛴 이유를 적으면 건너뛸 수 있다.** 현장은 순서대로 안 굴러간다.
// 막아 두기만 하면 사람은 이 화면을 안 쓰고 옆길로 간다. 대신 왜 건너뛰었는지가
// 남는다 — 그게 나중에 물어볼 수 있는 유일한 것이다.
//
// 하지 않는 것
//
// 1. 파일을 여기 담지 않는다. Drive 에 올리고 링크만 들고 있다.
// 2. 금액을 여기 두지 않는다. 견적 금액은 견적서가, 입금은 입금캘린더가 안다.
// 3. 자동으로 다음 단계를 끝내지 않는다. 끝났다고 말하는 것은 사람이 한다.
// 4. 단계를 되돌리지 않는다. 끝난 것을 안 끝난 것으로 바꾸면 기록이 아니다.
//    다시 해야 하면 그 단계에 결과물을 하나 더 붙인다.
(function attachDeliveryCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringDeliveryCore = api;
})(typeof globalThis === "object" ? globalThis : this, function createDeliveryCore() {
  "use strict";

  const text = (value, limit = 500) => String(value == null ? "" : value).trim().slice(0, limit);
  const rows = value => (Array.isArray(value) ? value.filter(Boolean) : []);
  const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(text(value, 10));

  // needsFile 은 "결과물 없이 끝냈다고 할 수 없다" 는 뜻이다. 사진은 여러 장이
  // 되므로 minFiles 로 따로 센다 — 한 장만 있는 '현장 사진'은 사진이 아니다.
  const STAGES = Object.freeze([
    {
      key: "quote", label: "견적서", minFiles: 1,
      why: "무엇을 얼마에 할지 먼저 맞춰야 나머지가 굴러갑니다.",
      next: "건물주에게 견적서를 보내고, 받았다는 답을 확인하세요.",
    },
    {
      key: "photos", label: "현장 사진", minFiles: 3,
      why: "하기 전 상태는 나중에 분쟁이 났을 때 유일한 근거입니다.",
      next: "작업 전 상태를 여러 각도로 찍어 올리세요. 최소 3장입니다.",
    },
    {
      key: "plan", label: "위탁 계획서", minFiles: 1,
      why: "무엇을 언제 어떻게 할지 문서로 맞춰야 나중에 말이 갈리지 않습니다.",
      next: "사진에서 본 상태를 근거로 계획서를 쓰고 건물주와 맞추세요.",
    },
    {
      key: "result", label: "단건 계약 결과보고서", minFiles: 1,
      why: "한 건이 끝났음을 글로 남겨야 다음 건과 섞이지 않습니다.",
      next: "계획서와 대조해 무엇을 했는지 적고 사진을 붙이세요.",
    },
    {
      key: "completion", label: "개발 완료 보고서", minFiles: 1,
      why: "전체가 끝났다는 이 문서가 입금을 요청할 근거입니다.",
      next: "완료 보고서를 보내고 입금 예정일을 잡으세요.",
    },
  ]);

  const STAGE_KEYS = Object.freeze(STAGES.map(item => item.key));

  // 한 단계가 가질 수 있는 상태. 되돌아가는 길은 없다.
  const STAGE_STATUSES = Object.freeze([
    { key: "waiting", label: "대기" },
    { key: "doing", label: "진행 중" },
    { key: "done", label: "완료" },
    { key: "skipped", label: "건너뜀" },
  ]);

  const CLOSED = Object.freeze(["done", "skipped"]);

  function stageOf(key) {
    return STAGES.find(item => item.key === text(key, 20)) || null;
  }

  function stageLabel(key) {
    const found = stageOf(key);
    return found ? found.label : text(key, 20);
  }

  function statusLabel(key) {
    const found = STAGE_STATUSES.find(item => item.key === text(key, 20));
    return found ? found.label : text(key, 20);
  }

  function isStage(key) {
    return STAGE_KEYS.indexOf(text(key, 20)) >= 0;
  }

  function isStatus(key) {
    return STAGE_STATUSES.some(item => item.key === text(key, 20));
  }

  // 결과물. 파일 자체가 아니라 Drive 에 있는 것을 가리키는 표다.
  function normalizeFile(source) {
    const value = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    const link = text(value.webViewLink, 500);
    return {
      id: text(value.id, 80),
      title: text(value.title, 200),
      driveFileId: text(value.driveFileId, 120),
      // https 가 아닌 링크는 안 받는다. 사내 파일 경로가 들어오면 다른
      // 사람 화면에서는 열리지 않는다.
      webViewLink: link.indexOf("https://") === 0 ? link : "",
      uploadedAt: text(value.uploadedAt, 40),
      uploadedBy: text(value.uploadedBy, 80),
    };
  }

  function normalizeStage(source) {
    const value = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    const status = text(value.status, 20);
    return {
      status: isStatus(status) ? status : "waiting",
      note: text(value.note, 1000),
      skipReason: text(value.skipReason, 500),
      files: rows(value.files).map(normalizeFile).filter(file => file.id && file.driveFileId),
      doneAt: text(value.doneAt, 40),
      doneBy: text(value.doneBy, 80),
    };
  }

  function normalizeFlow(source) {
    const value = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    const stages = {};
    STAGE_KEYS.forEach(key => { stages[key] = normalizeStage(value.stages && value.stages[key]); });
    return {
      id: text(value.id, 80),
      buildingId: text(value.buildingId, 80),
      buildingName: text(value.buildingName, 200),
      customerId: text(value.customerId, 80),
      ownerName: text(value.ownerName, 80),
      ownerContact: text(value.ownerContact, 80),
      title: text(value.title, 200),
      startedOn: isDate(value.startedOn) ? text(value.startedOn, 10) : "",
      stages,
      createdAt: text(value.createdAt, 40),
      updatedAt: text(value.updatedAt, 40),
      updatedBy: text(value.updatedBy, 80),
    };
  }

  function validateFlow(source) {
    const flow = normalizeFlow(source);
    if (!flow.id) return { ok: false, error: "진행 번호가 없습니다.", code: "VALIDATION_ERROR" };
    if (!flow.buildingId) return { ok: false, error: "어느 건물인지 정해 주세요.", code: "BUILDING_REQUIRED" };
    if (!flow.title) return { ok: false, error: "무슨 일인지 한 줄로 적어 주세요.", code: "TITLE_REQUIRED" };
    return { ok: true, flow };
  }

  // 앞 단계가 닫히지 않았으면 이 단계는 아직 열 수 없다.
  function blockedBy(flow, stageKey) {
    const item = normalizeFlow(flow);
    const index = STAGE_KEYS.indexOf(text(stageKey, 20));
    if (index <= 0) return null;
    const previous = STAGE_KEYS[index - 1];
    return CLOSED.includes(item.stages[previous].status) ? null : previous;
  }

  function isOpen(flow, stageKey) {
    return isStage(stageKey) && blockedBy(flow, stageKey) === null;
  }

  // 지금 손대야 할 단계. 다 끝났으면 null 이다.
  function currentStage(flow) {
    const item = normalizeFlow(flow);
    return STAGE_KEYS.find(key => !CLOSED.includes(item.stages[key].status)) || null;
  }

  function progress(flow) {
    const item = normalizeFlow(flow);
    const closed = STAGE_KEYS.filter(key => CLOSED.includes(item.stages[key].status)).length;
    return Math.round((closed / STAGE_KEYS.length) * 100);
  }

  // 단계를 옮긴다. 규칙은 셋뿐이다.
  //
  //   1. 앞 단계가 안 닫혔으면 못 연다.
  //   2. 완료로 두려면 결과물이 있어야 한다 — 없으면 "끝났다"가 말뿐이다.
  //   3. 건너뛰려면 이유가 있어야 한다.
  //
  // 되돌리는 길은 없다. 끝난 것을 안 끝난 것으로 바꾸면 기록이 아니다.
  function moveStage(input) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const flow = normalizeFlow(source.flow);
    const stageKey = text(source.stage, 20);
    const next = text(source.next, 20);
    const stage = stageOf(stageKey);
    if (!stage) return { ok: false, error: "없는 단계입니다.", code: "STAGE_UNKNOWN" };
    if (!isStatus(next)) return { ok: false, error: "없는 상태입니다.", code: "STATUS_UNKNOWN" };

    const current = flow.stages[stageKey];
    if (CLOSED.includes(current.status)) {
      return { ok: false, error: `${stage.label}은(는) 이미 끝났습니다. 다시 해야 하면 결과물을 하나 더 붙이세요.`, code: "STAGE_CLOSED" };
    }
    const blocker = blockedBy(flow, stageKey);
    if (blocker) {
      return { ok: false, error: `${stageLabel(blocker)}이(가) 끝나야 ${stage.label}을(를) 시작할 수 있습니다.`, code: "STAGE_BLOCKED" };
    }
    if (next === "done" && current.files.length < stage.minFiles) {
      return {
        ok: false,
        error: stage.minFiles > 1
          ? `${stage.label}은(는) ${stage.minFiles}장 이상 올려야 완료할 수 있습니다.`
          : `${stage.label}을(를) 올려야 완료할 수 있습니다.`,
        code: "FILE_REQUIRED",
      };
    }
    const skipReason = text(source.skipReason, 500);
    if (next === "skipped" && !skipReason) {
      return { ok: false, error: "건너뛰는 이유를 적어 주세요. 나중에 물어볼 수 있는 것은 이것뿐입니다.", code: "SKIP_REASON_REQUIRED" };
    }

    const actor = text(source.actorName, 80);
    const now = text(source.now, 40) || new Date().toISOString();
    const moved = Object.assign({}, current, {
      status: next,
      skipReason: next === "skipped" ? skipReason : current.skipReason,
      note: Object.prototype.hasOwnProperty.call(source, "note") ? text(source.note, 1000) : current.note,
      doneAt: CLOSED.includes(next) ? now : current.doneAt,
      doneBy: CLOSED.includes(next) ? actor : current.doneBy,
    });
    const stages = Object.assign({}, flow.stages, { [stageKey]: moved });
    return { ok: true, flow: normalizeFlow(Object.assign({}, flow, { stages })) };
  }

  // 결과물을 붙인다. 아직 안 연 단계에는 못 붙인다 — 붙일 수 있으면
  // 순서가 없는 것과 같다.
  function attachFile(input) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const flow = normalizeFlow(source.flow);
    const stageKey = text(source.stage, 20);
    const stage = stageOf(stageKey);
    if (!stage) return { ok: false, error: "없는 단계입니다.", code: "STAGE_UNKNOWN" };
    const blocker = blockedBy(flow, stageKey);
    if (blocker) {
      return { ok: false, error: `${stageLabel(blocker)}이(가) 끝나야 ${stage.label}에 올릴 수 있습니다.`, code: "STAGE_BLOCKED" };
    }
    const file = normalizeFile(source.file);
    if (!file.id || !file.driveFileId) {
      return { ok: false, error: "Drive 에 올라간 파일만 붙일 수 있습니다.", code: "FILE_REQUIRED" };
    }
    const current = flow.stages[stageKey];
    const files = [...current.files.filter(item => item.id !== file.id), file];
    // 결과물이 붙으면 대기에서 진행 중으로 저절로 넘어간다. 사람이 상태를
    // 따로 눌러야 하면 그 단추를 안 누르고 파일만 올린다.
    const status = current.status === "waiting" ? "doing" : current.status;
    const stages = Object.assign({}, flow.stages, {
      [stageKey]: Object.assign({}, current, { files, status }),
    });
    return { ok: true, flow: normalizeFlow(Object.assign({}, flow, { stages })) };
  }

  // 이 건물에서 지금 해야 할 일 한 줄. 목록에서 이것만 읽어도 움직일 수 있어야 한다.
  function nextAction(flow) {
    const key = currentStage(flow);
    if (!key) return { done: true, stage: "", label: "", text: "다 끝났습니다. 입금만 남았습니다." };
    const stage = stageOf(key);
    return { done: false, stage: key, label: stage.label, text: stage.next };
  }

  function summarize(flows) {
    const list = rows(flows).map(normalizeFlow).filter(item => item.id);
    const counts = {};
    STAGE_KEYS.forEach(key => { counts[key] = 0; });
    let finished = 0;
    list.forEach(item => {
      const key = currentStage(item);
      if (key) counts[key] += 1;
      else finished += 1;
    });
    return {
      total: list.length,
      running: list.length - finished,
      finished,
      counts,
      progress: list.length ? Math.round(list.reduce((sum, item) => sum + progress(item), 0) / list.length) : 0,
    };
  }

  // 손이 가야 하는 것부터. 다 끝난 것은 맨 아래로 내린다.
  function sortFlows(flows) {
    return rows(flows).map(normalizeFlow).filter(item => item.id).sort((a, b) => {
      const aKey = currentStage(a);
      const bKey = currentStage(b);
      if (!aKey !== !bKey) return aKey ? -1 : 1;
      if (aKey && bKey && aKey !== bKey) return STAGE_KEYS.indexOf(aKey) - STAGE_KEYS.indexOf(bKey);
      return String(a.buildingName || a.title).localeCompare(String(b.buildingName || b.title), "ko");
    });
  }

  function findFlow(flows, flowId) {
    const id = text(flowId, 80);
    if (!id) return null;
    return rows(flows).map(normalizeFlow).find(item => item.id === id) || null;
  }

  return Object.freeze({
    STAGES,
    STAGE_KEYS,
    STAGE_STATUSES,
    CLOSED,
    stageOf,
    stageLabel,
    statusLabel,
    isStage,
    isStatus,
    normalizeFile,
    normalizeStage,
    normalizeFlow,
    validateFlow,
    blockedBy,
    isOpen,
    currentStage,
    progress,
    moveStage,
    attachFile,
    nextAction,
    summarize,
    sortFlows,
    findFlow,
    text,
    rows,
  });
});

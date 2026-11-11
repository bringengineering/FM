(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringOwnerNoticeCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // 건물주 안내 알림톡. 본문은 NCP에 등록한 템플릿과 글자 하나까지 같아야
  // 한다. 원본은 crm-ai-worker/templates/<code>.json 이고, Apps Script 쪽
  // 사본(OWNER_NOTICE_TEMPLATES_)과 함께 테스트가 세 곳의 일치를 확인한다.
  const CONTACT = "문의: 1551-3873";
  const TEMPLATES = Object.freeze({
    owner_cleaning_schedule: Object.freeze({
      id: "owner_cleaning_schedule", code: "BRINGCLEANSCHEDULEV1", label: "청소 일정 안내", delivery: "auto",
      variables: ["건물주소", "작업명", "작업일", "예정시간"],
      body: "[BRING CARE 청소 일정 안내]\n#{건물주소} 건물주님, 오늘 예정된 청소 일정을 안내드립니다.\n\n작업명: #{작업명}\n작업일: #{작업일}\n예정시간: #{예정시간}\n\n작업이 끝나면 결과보고서를 보내드리겠습니다.\n\n※ 이 메시지는 고객님께서 BRING CARE와 체결하신 건물관리 계약에 따라 계약 건물의 관리 및 이용 내역을 안내드리는 메시지입니다.\n" + CONTACT,
    }),
    owner_move_out: Object.freeze({
      id: "owner_move_out", code: "BRINGMOVEOUTNOTICEV1", label: "퇴실 일정 안내", delivery: "turnover", stage: 1,
      variables: ["건물주소", "호실", "퇴실일"],
      body: "[BRING CARE 퇴실 일정 안내]\n#{건물주소} 건물주님, #{호실}호 세입자 퇴실 일정을 안내드립니다.\n\n퇴실예정일: #{퇴실일}\n\n퇴실 전 공실 준비(중개 접수·입주청소)를 순서대로 진행하고 단계마다 안내드리겠습니다.\n\n※ 이 메시지는 고객님께서 BRING CARE와 체결하신 건물관리 계약에 따라 계약 건물의 관리 및 이용 내역을 안내드리는 메시지입니다.\n" + CONTACT,
    }),
    owner_broker_listed: Object.freeze({
      id: "owner_broker_listed", code: "BRINGBROKERLISTEDV1", label: "중개 접수 안내", delivery: "turnover", stage: 2,
      variables: ["건물주소", "호실", "중개사무소", "접수일"],
      body: "[BRING CARE 중개 접수 안내]\n#{건물주소} 건물주님, #{호실}호 공실을 중개사무소에 접수했습니다.\n\n중개사무소: #{중개사무소}\n접수일: #{접수일}\n\n방 보기 일정이 잡히면 다시 안내드리겠습니다.\n\n※ 이 메시지는 고객님께서 BRING CARE와 체결하신 건물관리 계약에 따라 계약 건물의 관리 및 이용 내역을 안내드리는 메시지입니다.\n" + CONTACT,
    }),
    owner_room_viewing: Object.freeze({
      id: "owner_room_viewing", code: "BRINGROOMVIEWINGV1", label: "방 보기 안내", delivery: "turnover", stage: 3, repeatable: true,
      variables: ["건물주소", "호실", "방문일시", "중개사무소"],
      body: "[BRING CARE 방 보기 안내]\n#{건물주소} 건물주님, #{호실}호 방 보기 일정을 안내드립니다.\n\n방문일시: #{방문일시}\n방문: #{중개사무소} 및 입주희망자\n\n방문 결과는 확인되는 대로 안내드리겠습니다.\n\n※ 이 메시지는 고객님께서 BRING CARE와 체결하신 건물관리 계약에 따라 계약 건물의 관리 및 이용 내역을 안내드리는 메시지입니다.\n" + CONTACT,
    }),
    owner_lease_contract: Object.freeze({
      id: "owner_lease_contract", code: "BRINGLEASECONTRACTV1", label: "신규 계약 안내", delivery: "turnover", stage: 4,
      variables: ["건물주소", "호실", "계약일", "입주일", "계약조건"],
      body: "[BRING CARE 신규 계약 안내]\n#{건물주소} 건물주님, #{호실}호 신규 계약 일정을 안내드립니다.\n\n계약일: #{계약일}\n입주예정일: #{입주일}\n계약조건: #{계약조건}\n\n입주 전 입주청소 일정도 이어서 안내드리겠습니다.\n\n※ 이 메시지는 고객님께서 BRING CARE와 체결하신 건물관리 계약에 따라 계약 건물의 관리 및 이용 내역을 안내드리는 메시지입니다.\n" + CONTACT,
    }),
    owner_move_in_cleaning: Object.freeze({
      id: "owner_move_in_cleaning", code: "BRINGMOVEINCLEANV1", label: "입주청소 안내", delivery: "turnover", stage: 5,
      variables: ["건물주소", "호실", "작업일", "예정시간", "입주일"],
      body: "[BRING CARE 입주청소 안내]\n#{건물주소} 건물주님, #{호실}호 입주청소 일정을 안내드립니다.\n\n청소일: #{작업일}\n예정시간: #{예정시간}\n입주예정일: #{입주일}\n\n청소가 끝나면 결과보고서를 보내드리겠습니다.\n\n※ 이 메시지는 고객님께서 BRING CARE와 체결하신 건물관리 계약에 따라 계약 건물의 관리 및 이용 내역을 안내드리는 메시지입니다.\n" + CONTACT,
    }),
    owner_subscription_due: Object.freeze({
      id: "owner_subscription_due", code: "BRINGSUBSCRIPTIONDUEV1", label: "구독료 결제일 안내", delivery: "auto",
      variables: ["건물주소", "상품명", "결제금액", "결제일"],
      body: "[BRING CARE 결제일 안내]\n#{건물주소} 건물주님, 오늘은 브링케어 구독료 결제일입니다.\n\n상품명: #{상품명}\n결제금액: #{결제금액}원\n결제일: #{결제일}\n\n이미 결제하셨다면 이 안내는 넘기셔도 됩니다.\n" + CONTACT,
    }),
    owner_subscription_paid: Object.freeze({
      id: "owner_subscription_paid", code: "BRINGSUBSCRIPTIONPAIDV1", label: "구독료 결제 확인 안내", delivery: "auto",
      variables: ["건물주소", "상품명", "결제금액", "결제일"],
      body: "[BRING CARE 결제 확인 안내]\n#{건물주소} 건물주님, 브링케어 구독료 결제가 확인되었습니다.\n\n상품명: #{상품명}\n결제금액: #{결제금액}원\n결제확인일: #{결제일}\n\n영수증이 필요하시면 아래 번호로 말씀해 주세요.\n" + CONTACT,
    }),
  });

  // 퇴실 → 입주까지 담당자가 단계마다 입력하는 칸. 건물주소·호실은 서버가
  // 호실 기록에서 다시 채우므로 여기 없다(화면에서 바꿔 보낼 수 없게).
  const TURNOVER_FIELDS = Object.freeze({
    owner_move_out: [{ key: "퇴실일", label: "퇴실 예정일", type: "date" }],
    owner_broker_listed: [{ key: "중개사무소", label: "중개사무소", type: "text", placeholder: "예: 단계공인중개사" }, { key: "접수일", label: "접수일", type: "date" }],
    owner_room_viewing: [{ key: "방문일시", label: "방문 일시", type: "datetime-local" }, { key: "중개사무소", label: "중개사무소", type: "text", placeholder: "예: 단계공인중개사" }],
    owner_lease_contract: [{ key: "계약일", label: "계약일", type: "date" }, { key: "입주일", label: "입주 예정일", type: "date" }, { key: "계약조건", label: "계약조건", type: "text", placeholder: "예: 보증금 500 / 월세 45" }],
    owner_move_in_cleaning: [{ key: "작업일", label: "청소일", type: "date" }, { key: "예정시간", label: "예정 시각", type: "time" }, { key: "입주일", label: "입주 예정일", type: "date" }],
  });
  const TURNOVER_STAGES = Object.freeze(Object.values(TEMPLATES).filter(item => item.delivery === "turnover").sort((a, b) => a.stage - b.stage));
  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

  const line = value => String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();

  function isDateKey(value) {
    if (!/^[1-9]\d{3}-\d{2}-\d{2}$/u.test(String(value || ""))) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  // 2026-11-02 → "11월 2일(월)"
  function dateLabel(value) {
    const key = String(value || "").slice(0, 10);
    if (!isDateKey(key)) return "";
    const date = new Date(`${key}T00:00:00Z`);
    return `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일(${WEEKDAYS[date.getUTCDay()]})`;
  }

  // "14:30" → "오후 2:30"
  function timeLabel(value) {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/u.exec(String(value || "").trim());
    if (!match) return "";
    const hour = Number(match[1]);
    const shown = hour % 12 === 0 ? 12 : hour % 12;
    return `${hour < 12 ? "오전" : "오후"} ${shown}:${match[2]}`;
  }

  function dateTimeLabel(value) {
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/u.exec(String(value || ""));
    if (!match || !dateLabel(match[1]) || !timeLabel(match[2])) return "";
    return `${dateLabel(match[1])} ${timeLabel(match[2])}`;
  }

  // work-report-message.js 와 같은 규칙: 시·군·구 + 도로명/지번 + 번호.
  function shortAddress(value) {
    const raw = line(value);
    if (!raw || raw.length > 300) return "";
    const base = raw.replace(/\([^)]*\)/gu, " ").split(",")[0].trim();
    const words = base.split(/\s+/u);
    const road = words.findIndex((word, index) => /(?:대로|로|길)$/u.test(word) && /^\d+(?:-\d+)?$/u.test(words[index + 1] || ""));
    const lot = road < 0 ? words.findIndex((word, index) => /[^\d](?:동|읍|면|리)$/u.test(word)
      && (/^(?:산)?\d+(?:-\d+)?(?:번지)?$/u.test(words[index + 1] || "") || words[index + 1] === "산" && /^\d+(?:-\d+)?$/u.test(words[index + 2] || ""))) : -1;
    const index = road >= 0 ? road : lot;
    let result = base;
    if (index >= 0) {
      const admin = words.slice(0, index).filter(word => /(?:시|군|구|읍|면)$/u.test(word) && !/^\d/u.test(word)
        || /^(?:서울|부산|대구|인천|광주|대전|울산|세종)$/u.test(word))
        .map(word => word.replace(/특별자치시$/u, "시").replace(/(?:특별시|광역시)$/u, ""));
      const end = index + (words[index + 1] === "산" ? 3 : 2);
      result = [...admin, ...words.slice(index, end)].join(" ");
    }
    result = line(result);
    return result.length > 80 ? "" : result;
  }

  function buildingAddress(building) {
    const item = building || {};
    return shortAddress(item.roadAddress || item.address || item.jibunAddress) || line(item.name).slice(0, 80);
  }

  function unitLabel(unit) {
    return line(unit && (unit.label || unit.unitLabel)).replace(/호$/u, "").slice(0, 30);
  }

  // 화면 입력값(날짜·시각)을 알림톡에 들어갈 글자로 바꾼다.
  function formatTurnoverValues(templateId, input) {
    const fields = TURNOVER_FIELDS[templateId];
    if (!fields) return {};
    const source = input || {};
    return Object.fromEntries(fields.map(field => {
      const raw = String(source[field.key] == null ? "" : source[field.key]).trim();
      const value = field.type === "date" ? dateLabel(raw)
        : field.type === "time" ? timeLabel(raw)
        : field.type === "datetime-local" ? dateTimeLabel(raw)
        : line(raw).slice(0, 60);
      return [field.key, value];
    }));
  }

  function render(templateId, values) {
    const template = TEMPLATES[templateId];
    if (!template) throw new Error("허용되지 않은 건물주 안내입니다.");
    const source = values || {};
    return template.body.replace(/#\{([^}]+)\}/gu, (_all, key) => line(source[key]) || `#{${key}}`);
  }

  function missingVariables(templateId, values) {
    const template = TEMPLATES[templateId];
    if (!template) return [];
    const source = values || {};
    return template.variables.filter(key => !line(source[key]));
  }

  // 건물주 = 건물에 지정된 소유 고객. 없으면 건물에 연결된 '건물주' 유형 고객이
  // 정확히 한 명일 때만 고른다(여럿이면 잘못 보낼 수 있으니 고르지 않는다).
  function ownerForBuilding(building, customers) {
    if (!building) return null;
    const live = (Array.isArray(customers) ? customers : []).filter(item => item && item.id && !item.archivedAt && !item.deletedAt && item.deleted !== true);
    const assigned = live.find(item => String(item.id) === String(building.ownerCustomerId || ""));
    if (assigned) return assigned;
    const linked = live.filter(item => item.type === "건물주" && (
      (item.buildingIdLinks && item.buildingIdLinks[building.id] === true)
      || (Array.isArray(item.buildingIds) && item.buildingIds.includes(building.id))));
    return linked.length === 1 ? linked[0] : null;
  }

  // 발송 이력(messageDeliveries)에서 이 호실의 단계별 마지막 발송을 뽑는다.
  function turnoverProgress(deliveries, unitId) {
    const rows = (Array.isArray(deliveries) ? deliveries : []).filter(item => item
      && item.sourceType === "buildingUnit" && String(item.sourceId || "") === String(unitId || "")
      && TEMPLATES[item.category] && TEMPLATES[item.category].delivery === "turnover"
      && item.status !== "failed");
    return TURNOVER_STAGES.map(stage => {
      const sent = rows.filter(item => item.category === stage.id).sort((a, b) => String(b.requestedAt || "").localeCompare(String(a.requestedAt || "")));
      return { id: stage.id, label: stage.label, stage: stage.stage, count: sent.length, lastSentAt: sent[0] ? String(sent[0].requestedAt || "") : "" };
    });
  }

  function nextTurnoverStage(progress) {
    const list = Array.isArray(progress) ? progress : [];
    const next = list.find(item => !item.count);
    return next ? next.id : "owner_room_viewing";
  }

  return Object.freeze({
    TEMPLATES, TURNOVER_FIELDS, TURNOVER_STAGES,
    dateLabel, timeLabel, dateTimeLabel, shortAddress, buildingAddress, unitLabel,
    formatTurnoverValues, render, missingVariables, ownerForBuilding, turnoverProgress, nextTurnoverStage,
  });
});

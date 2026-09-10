// 인사기록. 입사일·계약형태·근로계약서 보관 위치를 다룬다.
//
// 이건 화면 하나가 아니라 **다른 것들의 재료**다. 연차 발생일수, 근로계약서
// 보관 의무, 나중에 붙을 급여가 전부 입사일과 계약형태 위에 선다. 그래서
// 여기서 값을 느슨하게 받으면 그 위에 얹는 것이 전부 흔들린다.
//
// 여기서 제일 조심한 것
//
// **주민등록번호를 담지 않는다.** 개인정보보호법 24조의2 는 법령에 근거가
// 없으면 주민번호 처리 자체를 막는다. 4대보험 신고는 그 근거가 되지만, 그
// 신고는 노무사·건강보험 EDI 에서 하지 이 CRM 에서 하지 않는다. 즉 여기에
// 주민번호를 담을 근거가 없다. 담을 근거가 없는데 담아 두면 유출됐을 때
// 변명이 없다. 그래서 칸을 안 만드는 데서 그치지 않고, 자유 입력칸에
// 주민번호처럼 생긴 값이 들어오면 **저장을 거부한다** — 칸이 없으면
// 사람은 비고란에 적는다.
//
// **계좌번호와 급여액도 담지 않는다.** 급여는 별도이고 대표만 본다.
//
// **퇴사해도 기록을 지우지 않는다.** 근로계약서는 3년 보관 의무가 있다.
// 퇴사일을 적을 뿐, 지우는 길은 만들지 않는다.
//
// 하지 않는 것
//
// 1. 4대보험 자격 취득·상실을 신고하지 않는다. 취득일을 적어 둘 뿐이다.
// 2. 계약 갱신을 자동으로 하지 않는다. 만료가 다가오면 알릴 뿐이다.
// 3. 수습기간 만료를 판정하지 않는다. 회사 규정이 정해져 있지 않다.
(function attachHrCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringHrCore = api;
})(typeof globalThis === "object" ? globalThis : this, function createHrCore() {
  "use strict";

  const text = (value, limit = 200) => String(value == null ? "" : value).trim().slice(0, limit);
  const rows = value => (Array.isArray(value) ? value.filter(Boolean) : []);
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const isDate = value => DATE.test(text(value, 10)) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

  const EMPLOYMENT_TYPES = Object.freeze([
    { key: "regular", label: "정규직", needsEndDate: false },
    { key: "contract", label: "계약직", needsEndDate: true },
    { key: "parttime", label: "단시간", needsEndDate: false },
    { key: "daily", label: "일용", needsEndDate: false },
  ]);

  const typeOf = key => EMPLOYMENT_TYPES.find(entry => entry.key === text(key, 20)) || null;

  // 주민등록번호·계좌번호처럼 생긴 값.
  //
  // 서버 규칙과 **글자 하나까지 같은 기준**이어야 한다. 화면이 통과시킨 값을
  // 서버가 막으면 사람은 이유 없는 권한 오류만 본다. 그래서 여기 두 정규식은
  // database.rules.json 의 free-text 규칙을 그대로 옮긴 것이다. 한쪽을 고치면
  // 다른 쪽도 고쳐야 하고, hr-wiring 검사가 그 짝을 지킨다.
  //
  // 900101-1234567 / 900101 1234567 은 앞 규칙이, 9001011234567 과 13자리
  // 이상 연속 숫자(계좌·카드번호)는 뒤 규칙이 잡는다. 전화번호(010-1234-5678)
  // 와 사업자번호(123-45-67890)는 연속 자릿수가 모자라 걸리지 않는다.
  const RESIDENT_LIKE = /[0-9]{6}[-. ]?[1-4][0-9]{6}/;
  const LONG_DIGITS = /[0-9]{13}/;

  function looksLikeResidentNumber(value) {
    const raw = String(value == null ? "" : value);
    return RESIDENT_LIKE.test(raw) || LONG_DIGITS.test(raw);
  }

  function normalizeRecord(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const employmentType = typeOf(source.employmentType) ? text(source.employmentType, 20) : "";
    return {
      userId: text(source.userId || source.user_id, 128),
      hireDate: isDate(source.hireDate) ? text(source.hireDate, 10) : "",
      employmentType,
      contractEndDate: isDate(source.contractEndDate) ? text(source.contractEndDate, 10) : "",
      resignedDate: isDate(source.resignedDate) ? text(source.resignedDate, 10) : "",
      department: text(source.department, 60),
      position: text(source.position, 60),
      phone: text(source.phone, 40),
      emergencyContact: text(source.emergencyContact, 120),
      contractSignedDate: isDate(source.contractSignedDate) ? text(source.contractSignedDate, 10) : "",
      contractFileUrl: text(source.contractFileUrl, 500),
      insuranceStartDate: isDate(source.insuranceStartDate) ? text(source.insuranceStartDate, 10) : "",
      note: text(source.note, 500),
      updatedAt: text(source.updatedAt, 40),
      updatedBy: text(source.updatedBy, 128),
    };
  }

  // 자유 입력칸 전부를 훑는다. 칸을 안 만들어도 사람은 어딘가에 적는다.
  const FREE_TEXT = ["phone", "emergencyContact", "note", "department", "position"];

  function validateRecord(input) {
    const record = normalizeRecord(input);
    if (!record.userId) return { ok: false, code: "USER_REQUIRED", error: "누구의 기록인지 정하고 저장해 주세요." };

    for (const field of FREE_TEXT) {
      if (looksLikeResidentNumber(record[field])) {
        return {
          ok: false,
          code: "RESIDENT_NUMBER_FORBIDDEN",
          error: "주민등록번호·계좌번호로 보이는 값은 저장할 수 없습니다. 4대보험 신고는 노무사·EDI 에서 하시고, 여기에는 적지 말아 주세요.",
        };
      }
    }

    if (record.contractFileUrl && !/^https:\/\//i.test(record.contractFileUrl)) {
      return { ok: false, code: "CONTRACT_URL_INVALID", error: "근로계약서 보관 위치는 https:// 로 시작하는 주소여야 합니다." };
    }
    if (record.employmentType && !typeOf(record.employmentType)) {
      return { ok: false, code: "TYPE_INVALID", error: "계약형태를 다시 선택해 주세요." };
    }
    if (record.contractEndDate && record.hireDate && record.contractEndDate < record.hireDate) {
      return { ok: false, code: "CONTRACT_END_BEFORE_HIRE", error: "계약 종료일이 입사일보다 앞섭니다." };
    }
    if (record.resignedDate && record.hireDate && record.resignedDate < record.hireDate) {
      return { ok: false, code: "RESIGNED_BEFORE_HIRE", error: "퇴사일이 입사일보다 앞섭니다." };
    }
    if (record.insuranceStartDate && record.hireDate && record.insuranceStartDate < record.hireDate) {
      return { ok: false, code: "INSURANCE_BEFORE_HIRE", error: "4대보험 취득일이 입사일보다 앞섭니다." };
    }
    return { ok: true, record };
  }

  function statusOf(record, asOf) {
    const item = normalizeRecord(record);
    const today = isDate(asOf) ? text(asOf, 10) : "";
    if (item.resignedDate && today && item.resignedDate <= today) return "resigned";
    if (item.resignedDate && !today) return "resigned";
    if (!item.hireDate) return "unknown";
    if (today && item.hireDate > today) return "scheduled";
    return "active";
  }

  function daysBetween(from, to) {
    if (!isDate(from) || !isDate(to)) return null;
    return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
  }

  // 법으로 걸리는 것과 그냥 비어 있는 것을 갈라 준다. 다 똑같이 빨갛게
  // 칠하면 무엇부터 채워야 하는지 알 수 없다.
  function checklist(record, asOf) {
    const item = normalizeRecord(record);
    const today = isDate(asOf) ? text(asOf, 10) : "";
    const out = [];
    const status = statusOf(item, today);

    if (!item.hireDate) out.push({ key: "hireDate", level: "required", label: "입사일이 없습니다", why: "연차 발생일수를 계산할 수 없습니다." });
    if (!item.contractFileUrl) out.push({ key: "contractFileUrl", level: "required", label: "근로계약서 보관 위치가 없습니다", why: "서면 교부와 3년 보관이 의무입니다." });
    if (!item.employmentType) out.push({ key: "employmentType", level: "required", label: "계약형태가 없습니다", why: "" });
    if (typeOf(item.employmentType) && typeOf(item.employmentType).needsEndDate && !item.contractEndDate) {
      out.push({ key: "contractEndDate", level: "required", label: "계약 종료일이 없습니다", why: "계약직은 기간을 명시해야 합니다." });
    }
    if (!item.insuranceStartDate) out.push({ key: "insuranceStartDate", level: "warn", label: "4대보험 취득일이 없습니다", why: "" });

    if (status !== "resigned" && item.contractEndDate && today) {
      const left = daysBetween(today, item.contractEndDate);
      if (left !== null && left < 0) out.push({ key: "contractExpired", level: "required", label: `계약이 ${-left}일 전에 끝났습니다`, why: "갱신했다면 종료일을 고쳐 주세요." });
      else if (left !== null && left <= 30) out.push({ key: "contractEnding", level: "warn", label: `계약 종료 ${left}일 전입니다`, why: "" });
    }
    return out;
  }

  // 회사 전체에서 지금 손봐야 할 것만 추린다.
  function alerts(records, asOf) {
    const out = [];
    rows(records).forEach(row => {
      const item = normalizeRecord(row);
      if (!item.userId) return;
      if (statusOf(item, asOf) === "resigned") return;
      checklist(item, asOf)
        .filter(entry => entry.level === "required")
        .forEach(entry => out.push(Object.assign({ userId: item.userId }, entry)));
    });
    return out;
  }

  function findRecord(records, userId) {
    const uid = text(userId, 128);
    if (!uid) return null;
    const hit = rows(records).find(row => row && text(row.userId, 128) === uid);
    return hit ? normalizeRecord(hit) : null;
  }

  return Object.freeze({
    EMPLOYMENT_TYPES,
    typeOf,
    looksLikeResidentNumber,
    normalizeRecord,
    validateRecord,
    statusOf,
    checklist,
    alerts,
    findRecord,
    daysBetween,
    isDate,
    text,
    rows,
  });
});

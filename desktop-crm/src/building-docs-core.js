// 건물별 문서함. 건물 하나에 어떤 서류가 있고 무엇이 비었는지 본다.
//
// 이 문서함이 하지 않는 것부터 적는다.
//
// 1. 파일을 올리지 않는다. 회사 Drive 접근 권한이 읽기 전용(drive.readonly)
//    이라 CRM 이 Drive 에 쓸 수 없다. 파일은 사람이 Drive 에 두고, 여기에는
//    그 파일을 가리키는 표를 만든다. 표에는 제목·종류·최근 확인 시각이 남는다.
//
// 2. 건물주에게 보내지 않는다. 사내 전용이다. 여기 담긴 링크는 회사 Drive 를
//    가리키고, 그 권한은 회사 계정에 묶여 있다. 건물주에게 나가는 월간
//    보고서(building-report-core)는 이 자료를 쓰지 않는다.
//
// 3. 열쇠 번호·출입 비밀번호를 담지 않는다. "열쇠·비밀번호 인수인계 확인서"
//    라는 서류를 가리키는 것은 되지만, 그 번호 자체를 메모에 적는 것은 막는다.
//    출입 수단은 보안(securityAssets) 쪽에서 따로 관리한다.
(function attachBuildingDocsCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringBuildingDocsCore = api;
})(typeof globalThis === "object" ? globalThis : this, function createBuildingDocsCore() {
  "use strict";

  // 건물 하나를 맡으면 보통 있어야 하는 서류. 없으면 "빠졌다" 로 표시한다.
  // 있으면 좋은 것과 없으면 곤란한 것을 나눠 둔다.
  const DOC_TYPES = Object.freeze([
    { key: "management_contract", label: "건물관리 위탁계약서", required: true },
    { key: "handover", label: "열쇠·비밀번호 인수인계 확인서", required: true },
    { key: "inspection", label: "점검 체크리스트", required: false },
    { key: "work_completion", label: "작업완료 확인서", required: false },
    { key: "vendor_contract", label: "협력업체 용역계약서", required: false },
    { key: "photo", label: "현장 사진", required: false },
    { key: "etc", label: "기타", required: false },
  ]);

  const TYPE_KEYS = new Set(DOC_TYPES.map(item => item.key));
  const REQUIRED_KEYS = DOC_TYPES.filter(item => item.required).map(item => item.key);

  // Drive 파일 ID 모양. contract-drive 쪽과 같은 기준을 쓴다.
  const DRIVE_FILE_ID = /^[A-Za-z0-9_-]{6,200}$/;

  // 번호처럼 보이는 것을 메모에 적었는지 본다. 열쇠·도어락·현관 같은 말 옆에
  // 숫자 네 자리 이상이 붙으면 출입 수단을 적은 것으로 본다.
  const ACCESS_HINT = /(비밀번호|비번|도어락|현관|출입|열쇠|key\s*code|passcode|password)/iu;
  const NUMBER_RUN = /\d[\d\s\-*#]{3,}/u;

  function text(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function rows(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
  }

  function fail(message, code) {
    return Object.assign(new Error(message), { code });
  }

  function typeLabel(key) {
    const found = DOC_TYPES.find(item => item.key === key);
    return found ? found.label : "기타";
  }

  /**
   * 메모에 출입 수단이 적혔는지 본다.
   * 서류 "이름" 에 열쇠가 들어가는 건 정상이다(인수인계 확인서). 번호가 같이
   * 붙었을 때만 잡는다.
   */
  function findsAccessSecret(value) {
    const memo = text(value);
    if (!memo) return false;
    return ACCESS_HINT.test(memo) && NUMBER_RUN.test(memo);
  }

  function normalizeDocument(input) {
    const source = input && typeof input === "object" ? input : {};
    const driveFileId = text(source.driveFileId);
    const buildingId = text(source.buildingId || source.crmBuildingId);
    const docType = TYPE_KEYS.has(text(source.docType)) ? text(source.docType) : "etc";
    return {
      id: text(source.id) || (driveFileId ? `doc_${driveFileId}` : ""),
      buildingId,
      driveFileId,
      docType,
      title: text(source.title).slice(0, 300),
      memo: text(source.memo).slice(0, 1000),
      webViewLink: text(source.webViewLink).slice(0, 500),
      revisionId: text(source.revisionId).slice(0, 200),
      modifiedAt: text(source.modifiedAt).slice(0, 40),
      lastCheckedAt: text(source.lastCheckedAt).slice(0, 40),
      archivedAt: text(source.archivedAt).slice(0, 40),
      updatedAt: text(source.updatedAt).slice(0, 40),
      updatedBy: text(source.updatedBy).slice(0, 120),
    };
  }

  /** 등록 요청을 받을 수 있는 모양인지 본다. 못 받으면 이유를 붙여 던진다. */
  function validateRegisterRequest(input) {
    const record = normalizeDocument(input);
    if (!record.buildingId) throw fail("어느 건물의 서류인지 골라 주세요.", "BUILDING_REQUIRED");
    if (!DRIVE_FILE_ID.test(record.driveFileId)) {
      throw fail("Drive 파일 ID 를 확인해 주세요.", "DRIVE_FILE_ID_INVALID");
    }
    if (findsAccessSecret(record.memo)) {
      // 여기서 막지 않으면 출입 수단이 백업·보고서·화면 곳곳으로 퍼진다.
      throw fail(
        "메모에 출입 비밀번호로 보이는 내용이 있습니다. 번호는 여기 적지 말고 보안 메뉴에서 관리해 주세요.",
        "ACCESS_SECRET_FORBIDDEN",
      );
    }
    return record;
  }

  /** Drive 주소를 붙여넣어도 파일 ID 를 뽑아낸다. */
  function extractDriveFileId(value) {
    const raw = text(value);
    if (!raw) return "";
    if (DRIVE_FILE_ID.test(raw) && !raw.includes("/")) return raw;
    const patterns = [/\/file\/d\/([A-Za-z0-9_-]{6,200})/, /\/document\/d\/([A-Za-z0-9_-]{6,200})/,
      /\/spreadsheets\/d\/([A-Za-z0-9_-]{6,200})/, /[?&]id=([A-Za-z0-9_-]{6,200})/];
    for (const pattern of patterns) {
      const match = pattern.exec(raw);
      if (match) return match[1];
    }
    return "";
  }

  /**
   * 한 건물의 문서함을 만든다.
   * 보관(archived)한 것은 목록에서 빼고, 빠진 필수 서류를 따로 낸다.
   */
  function buildBuildingBox(documents, buildingId) {
    const wanted = text(buildingId);
    const all = rows(documents).map(normalizeDocument).filter(item => item.buildingId === wanted);
    const active = all.filter(item => !item.archivedAt);
    const byType = DOC_TYPES.map(type => ({
      key: type.key,
      label: type.label,
      required: type.required,
      documents: active
        .filter(item => item.docType === type.key)
        .sort((a, b) => text(b.modifiedAt || b.updatedAt).localeCompare(text(a.modifiedAt || a.updatedAt))),
    }));
    const missingRequired = REQUIRED_KEYS
      .filter(key => !active.some(item => item.docType === key))
      .map(key => ({ key, label: typeLabel(key) }));
    return Object.freeze({
      buildingId: wanted,
      // 표본 수를 남긴다. 0건인 건물과 아직 정리 안 한 건물은 다른 상황이다.
      total: active.length,
      archivedCount: all.length - active.length,
      byType: Object.freeze(byType.map(Object.freeze)),
      missingRequired: Object.freeze(missingRequired.map(Object.freeze)),
    });
  }

  /** 건물 목록 옆에 붙일 요약. 어느 건물이 비었는지 한눈에 본다. */
  function summarize(documents, buildings) {
    return rows(buildings).map(building => {
      const box = buildBuildingBox(documents, building && building.id);
      return Object.freeze({
        buildingId: text(building && building.id),
        buildingName: text(building && building.name) || "건물명 미입력",
        total: box.total,
        missingRequired: box.missingRequired,
      });
    }).sort((a, b) =>
      b.missingRequired.length - a.missingRequired.length
      || a.buildingName.localeCompare(b.buildingName, "ko"));
  }

  return Object.freeze({
    DOC_TYPES,
    typeLabel,
    normalizeDocument,
    validateRegisterRequest,
    extractDriveFileId,
    findsAccessSecret,
    buildBuildingBox,
    summarize,
  });
});

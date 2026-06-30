/**
 * BRING Care 민원접수 자동 분석 -> FM GitHub.io 케이스 등록
 *
 * 설치 위치: Google Sheets 응답 시트의 확장 프로그램 > Apps Script
 * 최초 1회 실행: setupComplaintAutomation()
 */

const COMPLAINT_CONFIG = {
  SPREADSHEET_ID: "1HI6KzIMomL6vOUPs8zZDhXHktL1cWRDcg93lflsuojA",
  SHEET_NAME: "설문지 응답 시트1",
  CONTRACT_INDEX_SHEET_NAME: "계약 건물 인덱스",
  CONTRACT_DRIVE_FOLDER_ID: "1818MusPDfVV6znALkWDMGK99NXAlAj8g",
  FIREBASE_DATABASE_URL: "https://bring-fm-default-rtdb.asia-southeast1.firebasedatabase.app",
  FIREBASE_CASES_PATH: "cases",
  RESPONSE_SHEET_URL: "https://docs.google.com/spreadsheets/d/1HI6KzIMomL6vOUPs8zZDhXHktL1cWRDcg93lflsuojA/edit"
};

const OUTPUT_HEADERS = [
  "접수번호",
  "긴급도",
  "민원 요약",
  "업체 분류",
  "상태값",
  "계약 매칭 상태",
  "계약 건물주",
  "계약 파일명",
  "계약 확인 메모",
  "Firebase Case ID",
  "분석 처리일시"
];

const CONTRACT_INDEX_HEADERS = [
  "계약상태",
  "건물명",
  "주소",
  "건물주명",
  "건물주연락처",
  "등급",
  "계약파일명",
  "계약파일URL",
  "Drive File ID",
  "비고",
  "업데이트일시"
];

function setupComplaintAutomation() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === "onComplaintFormSubmit") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger("onComplaintFormSubmit")
    .forSpreadsheet(COMPLAINT_CONFIG.SPREADSHEET_ID)
    .onFormSubmit()
    .create();

  ensureFormAddressQuestion_();
  ensureContractIndexSheet_();
  syncContractIndexFromDrive();
  processExistingResponses();
}

function onComplaintFormSubmit(e) {
  const sheet = e && e.range ? e.range.getSheet() : getResponseSheet_();
  const row = e && e.range ? e.range.getRow() : sheet.getLastRow();
  processResponseRow_(sheet, row);
}

function processExistingResponses() {
  const sheet = getResponseSheet_();
  ensureOutputHeaders_(sheet);
  ensureContractIndexSheet_();

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  for (let row = 2; row <= lastRow; row++) {
    processResponseRow_(sheet, row);
  }
}

function getResponseSheet_() {
  const ss = SpreadsheetApp.openById(COMPLAINT_CONFIG.SPREADSHEET_ID);
  return ss.getSheetByName(COMPLAINT_CONFIG.SHEET_NAME) || ss.getSheets()[0];
}

function getLinkedForm_() {
  const ss = SpreadsheetApp.openById(COMPLAINT_CONFIG.SPREADSHEET_ID);
  const formUrl = ss.getFormUrl();
  return formUrl ? FormApp.openByUrl(formUrl) : null;
}

function ensureFormAddressQuestion_() {
  const form = getLinkedForm_();
  if (!form) return;

  const items = form.getItems();
  const existing = items.find(item => isAddressQuestionTitle_(item.getTitle()));
  if (existing) {
    try {
      existing.asTextItem().setRequired(true);
    } catch (err) {}
    return;
  }

  const addressItem = form.addTextItem()
    .setTitle("건물 주소")
    .setHelpText("계약 건물 확인을 위해 도로명 또는 지번 주소를 입력해주세요.")
    .setRequired(true);

  const refreshed = form.getItems();
  const buildingItem = refreshed.find(item => String(item.getTitle() || "").trim() === "건물명");
  if (buildingItem) {
    try {
      form.moveItem(addressItem.getIndex(), buildingItem.getIndex() + 1);
    } catch (err) {}
  }
}

function isAddressQuestionTitle_(title) {
  const key = normalizeText_(title);
  return key === "건물주소" || key === "주소";
}

function ensureContractIndexSheet_() {
  const ss = SpreadsheetApp.openById(COMPLAINT_CONFIG.SPREADSHEET_ID);
  let sheet = ss.getSheetByName(COMPLAINT_CONFIG.CONTRACT_INDEX_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(COMPLAINT_CONFIG.CONTRACT_INDEX_SHEET_NAME);
  }

  const lastCol = Math.max(sheet.getLastColumn(), 1);
  let headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(v => String(v || "").trim());
  if (headers.every(header => !header)) headers = [];

  CONTRACT_INDEX_HEADERS.forEach(header => {
    if (!headers.includes(header)) {
      headers.push(header);
      sheet.getRange(1, headers.length).setValue(header);
    }
  });

  sheet.setFrozenRows(1);
  return sheet;
}

function syncContractIndexFromDrive() {
  const sheet = ensureContractIndexSheet_();
  const folderId = extractDriveId_(COMPLAINT_CONFIG.CONTRACT_DRIVE_FOLDER_ID);
  if (!folderId) return;

  let folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (err) {
    writeContractSyncNotice_(sheet, "Drive 폴더 접근 실패: 폴더 공유 권한 또는 폴더 ID를 확인하세요. " + err.message);
    Logger.log("Drive 폴더 동기화 건너뜀: " + err.message);
    return;
  }

  const headerMap = getHeaderMap_(sheet);
  const existingRows = getContractRowsByDriveId_(sheet, headerMap);
  const files = folder.getFiles();

  while (files.hasNext()) {
    const file = files.next();
    const fileName = file.getName();
    if (!isContractFile_(fileName)) continue;

    const fileId = file.getId();
    const row = existingRows[fileId] || sheet.getLastRow() + 1;
    if (!existingRows[fileId]) {
      setCellByHeader_(sheet, row, headerMap, "계약상태", "확인필요");
    }

    setCellByHeader_(sheet, row, headerMap, "계약파일명", fileName);
    setCellByHeader_(sheet, row, headerMap, "계약파일URL", file.getUrl());
    setCellByHeader_(sheet, row, headerMap, "Drive File ID", fileId);
    setCellByHeader_(sheet, row, headerMap, "업데이트일시", Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss"));
  }
}

function writeContractSyncNotice_(sheet, message) {
  const headerMap = getHeaderMap_(sheet);
  const row = Math.max(sheet.getLastRow() + 1, 2);
  setCellByHeader_(sheet, row, headerMap, "계약상태", "Drive확인필요");
  setCellByHeader_(sheet, row, headerMap, "비고", message);
  setCellByHeader_(sheet, row, headerMap, "업데이트일시", Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss"));
}

function extractDriveId_(value) {
  const v = String(value || "").trim();
  if (!v) return "";

  const folderMatch = v.match(/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) return folderMatch[1];

  const idMatch = v.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch) return idMatch[1];

  return v;
}

function isContractFile_(fileName) {
  return /\.(hwp|hwpx|doc|docx|pdf)$/i.test(String(fileName || ""));
}

function getHeaderMap_(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(v => String(v || "").trim());
  const map = {};
  headers.forEach((header, index) => {
    if (header) map[header] = index + 1;
  });
  return map;
}

function getContractRowsByDriveId_(sheet, headerMap) {
  const rows = {};
  const idCol = headerMap["Drive File ID"];
  if (!idCol) return rows;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return rows;

  const values = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
  values.forEach((row, index) => {
    const id = String(row[0] || "").trim();
    if (id) rows[id] = index + 2;
  });
  return rows;
}

function processResponseRow_(sheet, row) {
  if (row < 2) return;

  const headers = ensureOutputHeaders_(sheet);
  const values = sheet.getRange(row, 1, 1, headers.length).getValues()[0];
  const record = recordFromRow_(headers, values);

  if (!readField_(record, ["건물명", "건물"]) && !readField_(record, ["증상 설명", "민원 내용", "내용"])) {
    return;
  }

  const ticketNo = readField_(record, ["접수번호"]) || makeTicketNo_(row, record);
  const analysis = analyzeComplaint_(record);
  const contractMatch = matchContractIndex_(record);
  const casePayload = buildCasePayload_(ticketNo, record, analysis, contractMatch, row, sheet);

  writeAnalysisToSheet_(sheet, row, headers, ticketNo, analysis, casePayload, contractMatch);
  writeCaseToFirebase_(ticketNo, casePayload);
}

function ensureOutputHeaders_(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  let headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(v => String(v || "").trim());

  OUTPUT_HEADERS.forEach(header => {
    if (!headers.includes(header)) {
      headers.push(header);
      sheet.getRange(1, headers.length).setValue(header);
    }
  });

  return headers;
}

function recordFromRow_(headers, values) {
  const record = {};
  headers.forEach((header, index) => {
    if (header) record[header] = values[index];
  });
  return record;
}

function readField_(record, names) {
  for (const name of names) {
    if (record[name] !== undefined && record[name] !== null && String(record[name]).trim() !== "") {
      return String(record[name]).trim();
    }
  }
  return "";
}

function readRawField_(record, names) {
  for (const name of names) {
    if (record[name] !== undefined && record[name] !== null && String(record[name]).trim() !== "") {
      return record[name];
    }
  }
  return "";
}

function dateFromValue_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;

  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

function normalizeText_(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/강원특별자치도/g, "강원")
    .replace(/강원도/g, "강원")
    .replace(/\s+/g, "")
    .replace(/[()\[\]{}.,·ㆍ-]/g, "")
    .trim();
}

function normalizeAddress_(value) {
  return normalizeText_(value)
    .replace(/번지/g, "")
    .replace(/층/g, "f");
}

function getContractIndexRecords_() {
  const sheet = ensureContractIndexSheet_();
  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  if (lastRow < 2) return [];

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(v => String(v || "").trim());
  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  return values.map((row, index) => {
    const record = recordFromRow_(headers, row);
    record.__row = index + 2;
    return record;
  }).filter(record => readField_(record, ["건물명"]) || readField_(record, ["주소"]) || readField_(record, ["Drive File ID"]));
}

function matchContractIndex_(record) {
  const inputBuilding = readField_(record, ["건물명", "건물"]);
  const inputAddress = readField_(record, ["건물 주소", "주소"]);
  const buildingKey = normalizeText_(inputBuilding);
  const addressKey = normalizeAddress_(inputAddress);

  const base = {
    inputBuilding: inputBuilding,
    inputAddress: inputAddress,
    matchKey: buildingKey + "|" + addressKey,
    status: "address_missing",
    statusText: "건물 주소가 없어 계약 매칭을 건너뛰었습니다.",
    candidateCount: 0,
    contract: null
  };

  if (!addressKey) return base;

  const records = getContractIndexRecords_();
  const activeRecords = records.filter(item => !/해지|종료|만료/.test(readField_(item, ["계약상태"])));
  const matches = activeRecords.filter(item =>
    normalizeText_(readField_(item, ["건물명"])) === buildingKey &&
    normalizeAddress_(readField_(item, ["주소"])) === addressKey
  );

  if (matches.length === 1) {
    return {
      inputBuilding: inputBuilding,
      inputAddress: inputAddress,
      matchKey: buildingKey + "|" + addressKey,
      status: "matched",
      statusText: "계약 건물 인덱스와 정확히 매칭되었습니다.",
      candidateCount: 1,
      contract: makeContractPayload_(matches[0])
    };
  }

  const sameBuilding = activeRecords.filter(item => normalizeText_(readField_(item, ["건물명"])) === buildingKey);
  if (matches.length > 1) {
    return {
      inputBuilding: inputBuilding,
      inputAddress: inputAddress,
      matchKey: buildingKey + "|" + addressKey,
      status: "multiple",
      statusText: "복수 계약 후보가 있어 관리자 확인이 필요합니다.",
      candidateCount: matches.length,
      candidates: matches.slice(0, 5).map(makeContractCandidate_),
      contract: null
    };
  }

  return {
    inputBuilding: inputBuilding,
    inputAddress: inputAddress,
    matchKey: buildingKey + "|" + addressKey,
    status: "unmatched",
    statusText: sameBuilding.length ? "건물명 후보는 있으나 주소가 일치하지 않습니다." : "계약 건물 인덱스에서 일치하는 건물을 찾지 못했습니다.",
    candidateCount: sameBuilding.length,
    candidates: sameBuilding.slice(0, 5).map(makeContractCandidate_),
    contract: null
  };
}

function makeContractPayload_(record) {
  return {
    contractStatus: readField_(record, ["계약상태"]),
    building: readField_(record, ["건물명"]),
    address: readField_(record, ["주소"]),
    ownerName: maskName_(readField_(record, ["건물주명"])),
    ownerPhone: maskPhone_(readField_(record, ["건물주연락처"])),
    grade: readField_(record, ["등급"]),
    contractFileName: readField_(record, ["계약파일명"]),
    contractFileUrl: readField_(record, ["계약파일URL"]),
    driveFileId: readField_(record, ["Drive File ID"]),
    note: readField_(record, ["비고"]),
    indexRow: record.__row || ""
  };
}

function makeContractCandidate_(record) {
  return {
    building: readField_(record, ["건물명"]),
    address: readField_(record, ["주소"]),
    contractFileName: readField_(record, ["계약파일명"]),
    indexRow: record.__row || ""
  };
}

function makeTicketNo_(row, record) {
  const ts = readRawField_(record, ["타임스탬프", "Timestamp"]) || new Date();
  const year = Utilities.formatDate(dateFromValue_(ts), "Asia/Seoul", "yyyy");
  return "BR-" + year + "-" + String(row - 1).padStart(4, "0");
}

function analyzeComplaint_(record) {
  const issueType = readField_(record, ["문제 유형"]);
  const description = readField_(record, ["증상 설명", "민원 내용", "내용"]);
  const photo = readField_(record, ["사진 첨부"]);
  const extra = readField_(record, ["추가 요청사항"]);
  const haystack = [issueType, description, extra].join(" ").toLowerCase();

  const urgentKeywords = [
    "누수", "물샘", "물 샘", "물이 떨어", "물이 샘", "천장 물", "천장에서 물",
    "침수", "역류", "스파크", "탄 냄새", "타는 냄새", "차단기", "정전",
    "감전", "화재", "문이 안 열", "출입 불가", "갇힘", "가스", "동파"
  ];
  const reviewKeywords = ["기타", "모르겠", "확인 필요", "애매", "불명", "소리", "냄새"];

  const isUrgentType = ["누수", "전기", "도어락", "보일러"].includes(issueType);
  const hasUrgentKeyword = urgentKeywords.some(keyword => haystack.includes(keyword));
  const needsReview = issueType === "기타" || !photo || description.replace(/\s/g, "").length < 12 ||
    reviewKeywords.some(keyword => haystack.includes(keyword));

  let urgency = "보통";
  let reason = "즉시 위험 신호는 확인되지 않았습니다.";

  if (hasUrgentKeyword || (isUrgentType && /안 ?됨|고장|멈춤|불가|누수|물|스파크|냄새|차단기/.test(haystack))) {
    urgency = "긴급";
    reason = "누수/전기/출입불가 등 즉시 확인이 필요한 표현이 감지되었습니다.";
  } else if (needsReview) {
    urgency = "확인필요";
    reason = "사진 누락, 짧은 설명, 기타/애매한 표현으로 관리자 확인이 필요합니다.";
  }

  const vendorType = classifyVendor_(issueType, haystack);
  const summary = makeSummary_(record, issueType, description);
  const statusValue = urgency === "긴급" ? "긴급확인필요" : urgency === "확인필요" ? "관리자확인중" : "접수완료";

  return { urgency, reason, vendorType, summary, statusValue };
}

function classifyVendor_(issueType, haystack) {
  const typeMap = {
    "배관": "배관",
    "누수": "누수·방수",
    "전기": "전기",
    "도어락": "도어락·출입",
    "보일러": "보일러·난방",
    "에어컨": "에어컨·냉난방",
    "창문·문": "창호·문",
    "청소·방역": "청소·방역",
    "공용부 문제": "공용부 관리"
  };
  if (typeMap[issueType]) return typeMap[issueType];
  if (/누수|방수|물|천장|배수|역류/.test(haystack)) return "누수·배관";
  if (/전기|차단기|스파크|정전|조명/.test(haystack)) return "전기";
  if (/보일러|난방|온수/.test(haystack)) return "보일러·난방";
  if (/에어컨|냉방|실외기/.test(haystack)) return "에어컨·냉난방";
  if (/문|창문|도어락|잠금|출입/.test(haystack)) return "창호·출입";
  if (/청소|방역|벌레|곰팡이/.test(haystack)) return "청소·방역";
  return "관리자 확인";
}

function makeSummary_(record, issueType, description) {
  const building = readField_(record, ["건물명", "건물"]);
  const room = readField_(record, ["호실"]);
  const cleanDescription = String(description || "").replace(/\s+/g, " ").trim();
  const preview = cleanDescription ? cleanDescription.slice(0, 70) : "상세 설명 확인 필요";
  return [building, room, issueType].filter(Boolean).join(" / ") + " - " + preview;
}

function buildCasePayload_(ticketNo, record, analysis, contractMatch, row, sheet) {
  const timestamp = readRawField_(record, ["타임스탬프", "Timestamp"]);
  const receivedAt = dateFromValue_(timestamp).toISOString();
  const building = readField_(record, ["건물명", "건물"]);
  const address = readField_(record, ["건물 주소", "주소"]);
  const room = readField_(record, ["호실"]);
  const name = readField_(record, ["이름", "성명"]);
  const phone = readField_(record, ["연락처", "전화번호", "휴대폰"]);
  const issueType = readField_(record, ["문제 유형"]);
  const visitTime = readField_(record, ["방문 가능 시간"]);
  const isContractHold = contractMatch && (contractMatch.status === "unmatched" || contractMatch.status === "multiple");
  const statusValue = isContractHold ? "계약확인보류" : analysis.statusValue;
  const status = isContractHold ? { c1: "doing" } : { c1: "done", c3: "done", c4: "done" };
  const c1Note = contractMatch && contractMatch.status === "matched"
    ? "구글폼 자동 접수. 계약 건물 인덱스와 매칭되었습니다. 개인정보/사진 원본은 응답 시트에서 확인하세요."
    : isContractHold
      ? "계약 정보 미확인. 계약 건물 인덱스에서 건물명/주소를 확인한 뒤 진행하세요."
      : "구글폼 자동 접수. 개인정보/사진 원본은 응답 시트에서 확인하세요.";

  return {
    id: ticketNo,
    ticketNo: ticketNo,
    source: "google_form",
    createdAt: new Date().toISOString(),
    receivedAt: receivedAt,
    sheetUrl: COMPLAINT_CONFIG.RESPONSE_SHEET_URL + "#gid=" + sheet.getSheetId(),
    sheetRow: row,
    name: maskName_(name) || "세입자",
    phone: maskPhone_(phone),
    email: "",
    building: building,
    address: address,
    room: maskRoom_(room),
    grade: contractMatch && contractMatch.contract && contractMatch.contract.grade ? contractMatch.contract.grade : "스탠다드",
    issueType: issueType,
    urgency: analysis.urgency,
    vendorType: analysis.vendorType,
    summary: analysis.summary,
    analysisReason: analysis.reason,
    visitTime: visitTime,
    statusValue: statusValue,
    contractMatch: contractMatch,
    status: status,
    note: {
      c1: c1Note,
      c3: analysis.summary,
      c4: "긴급도: " + analysis.urgency + "\n업체 분류: " + analysis.vendorType + "\n판단 근거: " + analysis.reason,
      c11: visitTime ? "방문 가능 시간: " + visitTime : ""
    },
    log: [
      Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm") + " 구글폼 자동 접수",
      "긴급도 " + analysis.urgency + " / 업체분류 " + analysis.vendorType,
      contractMatch ? "계약매칭 " + contractMatch.status + " / " + contractMatch.statusText : "계약매칭 미확인"
    ]
  };
}

function writeAnalysisToSheet_(sheet, row, headers, ticketNo, analysis, casePayload, contractMatch) {
  const headerMap = {};
  headers.forEach((header, index) => headerMap[header] = index + 1);
  const contract = contractMatch && contractMatch.contract ? contractMatch.contract : {};

  setCellByHeader_(sheet, row, headerMap, "접수번호", ticketNo);
  setCellByHeader_(sheet, row, headerMap, "긴급도", analysis.urgency);
  setCellByHeader_(sheet, row, headerMap, "민원 요약", analysis.summary);
  setCellByHeader_(sheet, row, headerMap, "업체 분류", analysis.vendorType);
  setCellByHeader_(sheet, row, headerMap, "상태값", casePayload.statusValue);
  setCellByHeader_(sheet, row, headerMap, "계약 매칭 상태", contractMatch ? contractMatch.status : "미확인");
  setCellByHeader_(sheet, row, headerMap, "계약 건물주", contract.ownerName || "");
  setCellByHeader_(sheet, row, headerMap, "계약 파일명", contract.contractFileName || "");
  setCellByHeader_(sheet, row, headerMap, "계약 확인 메모", contractMatch ? contractMatch.statusText : "");
  setCellByHeader_(sheet, row, headerMap, "Firebase Case ID", casePayload.id);
  setCellByHeader_(sheet, row, headerMap, "분석 처리일시", Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss"));
}

function setCellByHeader_(sheet, row, headerMap, header, value) {
  if (headerMap[header]) sheet.getRange(row, headerMap[header]).setValue(value);
}

function writeCaseToFirebase_(caseId, payload) {
  const base = COMPLAINT_CONFIG.FIREBASE_DATABASE_URL.replace(/\/$/, "");
  const path = COMPLAINT_CONFIG.FIREBASE_CASES_PATH.replace(/^\/|\/$/g, "");
  const url = base + "/" + path + "/" + encodeURIComponent(caseId) + ".json";
  const response = UrlFetchApp.fetch(url, {
    method: "put",
    contentType: "application/json; charset=utf-8",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error("Firebase 저장 실패: HTTP " + code + " / " + response.getContentText());
  }
}

function maskName_(name) {
  const v = String(name || "").trim();
  if (!v) return "";
  if (v.length <= 1) return v;
  if (v.length === 2) return v[0] + "*";
  return v[0] + "*".repeat(v.length - 2) + v[v.length - 1];
}

function maskPhone_(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 7) return phone ? "***" : "";
  return digits.slice(0, 3) + "-****-" + digits.slice(-4);
}

function maskRoom_(room) {
  const v = String(room || "").trim();
  if (!v) return "";
  const digits = v.replace(/\D/g, "");
  if (digits.length >= 3) return digits[0] + "**호";
  return "호실 비공개";
}

function testAnalyzeSample() {
  const sample = {
    "건물명": "테스트빌딩",
    "건물 주소": "강원 원주시 테스트로 1",
    "호실": "302",
    "이름": "홍길동",
    "연락처": "010-1234-5678",
    "문제 유형": "누수",
    "증상 설명": "화장실 천장에서 물이 떨어지고 있습니다.",
    "사진 첨부": "https://example.com/photo",
    "방문 가능 시간": "오늘 오후 가능"
  };
  const analysis = analyzeComplaint_(sample);
  const contractMatch = matchContractIndex_(sample);
  Logger.log(JSON.stringify(buildCasePayload_("BR-TEST-0001", sample, analysis, contractMatch, 2, getResponseSheet_()), null, 2));
}

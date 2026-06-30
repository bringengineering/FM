/**
 * BRING Care 민원접수 자동 분석 -> FM GitHub.io 케이스 등록
 *
 * 설치 위치: Google Sheets 응답 시트의 확장 프로그램 > Apps Script
 * 최초 1회 실행: setupComplaintAutomation()
 */

const COMPLAINT_CONFIG = {
  SPREADSHEET_ID: "1HI6KzIMomL6vOUPs8zZDhXHktL1cWRDcg93lflsuojA",
  SHEET_NAME: "설문지 응답 시트1",
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
  "온보딩 매칭 상태",
  "온보딩 파일명",
  "온보딩 확인 메모",
  "Firebase Case ID",
  "분석 처리일시"
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
  processExistingResponses();
}

function authorizeDriveAccess() {
  const folderId = extractDriveId_(COMPLAINT_CONFIG.CONTRACT_DRIVE_FOLDER_ID);
  if (!folderId) throw new Error("CONTRACT_DRIVE_FOLDER_ID가 비어 있습니다.");

  const folder = DriveApp.getFolderById(folderId);
  Logger.log("Drive 권한 확인 대상 폴더: " + folder.getName() + " / https://drive.google.com/drive/folders/" + folderId);

  const directFiles = folder.getFiles();
  const fileLogs = [];
  while (directFiles.hasNext() && fileLogs.length < 20) {
    const file = directFiles.next();
    fileLogs.push(file.getName() + " / " + file.getMimeType());
  }
  Logger.log(fileLogs.length
    ? "폴더 직접 파일 목록: " + fileLogs.join(" | ")
    : "폴더 직접 파일 목록: 비어 있음");

  const query = [
    "'" + escapeDriveQueryValue_(folderId) + "' in parents",
    "trashed = false",
    "mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'"
  ].join(" and ");
  const files = DriveApp.searchFiles(query);
  Logger.log(files.hasNext()
    ? "Drive 권한 확인 완료: " + files.next().getName()
    : "Drive 권한 확인 완료: 폴더 안에 DOCX 파일이 아직 없습니다.");
}

function onComplaintFormSubmit(e) {
  const sheet = e && e.range ? e.range.getSheet() : getResponseSheet_();
  const row = e && e.range ? e.range.getRow() : sheet.getLastRow();
  processResponseRow_(sheet, row);
}

function processExistingResponses() {
  const sheet = getResponseSheet_();
  ensureOutputHeaders_(sheet);

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

function extractDriveId_(value) {
  const v = String(value || "").trim();
  if (!v) return "";

  const folderMatch = v.match(/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) return folderMatch[1];

  const idMatch = v.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch) return idMatch[1];

  return v;
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
  const contractMatch = matchDriveOnboardingFile_(record);
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

function matchDriveOnboardingFile_(record) {
  const inputBuilding = readField_(record, ["건물명", "건물"]);
  const inputAddress = readField_(record, ["건물 주소", "주소"]);
  const buildingKey = normalizeText_(inputBuilding);
  const addressKey = normalizeAddress_(inputAddress);
  const base = {
    inputBuilding: inputBuilding,
    inputAddress: inputAddress,
    matchKey: buildingKey + "|" + addressKey,
    source: "drive_fulltext",
    status: "unmatched",
    statusText: "Drive 온보딩 수집서 매칭을 확인하지 못했습니다.",
    candidateCount: 0,
    contract: null
  };

  if (!buildingKey) {
    return Object.assign(base, {
      statusText: "건물명이 없어 Drive 온보딩 수집서를 검색하지 못했습니다."
    });
  }

  const buildingTerms = makeDriveSearchTerms_(inputBuilding);
  const buildingResult = searchDriveOnboardingFiles_(buildingTerms);
  if (!buildingResult.ok) {
    return Object.assign(base, {
      statusText: buildingResult.error || "Drive 폴더 접근 실패: 폴더 공유 권한 또는 폴더 ID를 확인하세요."
    });
  }

  const buildingCandidates = buildingResult.files;
  if (buildingCandidates.length === 1) {
    return makeDriveMatchPayload_(buildingCandidates[0], inputBuilding, inputAddress, {
      matchKey: buildingKey + "|" + addressKey,
      candidateCount: 1,
      statusText: "Drive DOCX 본문에서 건물명이 정확히 1건 매칭되었습니다."
    });
  }

  if (buildingCandidates.length === 0) {
    return Object.assign(base, {
      statusText: "Drive 폴더에서 건물명이 포함된 DOCX 온보딩 수집서를 찾지 못했습니다."
    });
  }

  if (!addressKey) {
    return Object.assign(base, {
      status: "address_missing",
      statusText: "건물명 후보가 여러 개지만 건물 주소가 없어 수동 확인이 필요합니다.",
      candidateCount: buildingCandidates.length,
      candidates: buildingCandidates.slice(0, 5).map(makeDriveCandidate_)
    });
  }

  const addressTerms = makeDriveSearchTerms_(inputAddress);
  const narrowedResult = searchDriveOnboardingFiles_(buildingTerms.concat(addressTerms));
  if (!narrowedResult.ok) {
    return Object.assign(base, {
      status: "multiple",
      statusText: narrowedResult.error || "건물명 후보는 여러 개이나 주소 검색 중 Drive 오류가 발생했습니다.",
      candidateCount: buildingCandidates.length,
      candidates: buildingCandidates.slice(0, 5).map(makeDriveCandidate_)
    });
  }

  const narrowedCandidates = narrowedResult.files;
  if (narrowedCandidates.length === 1) {
    return makeDriveMatchPayload_(narrowedCandidates[0], inputBuilding, inputAddress, {
      matchKey: buildingKey + "|" + addressKey,
      candidateCount: 1,
      statusText: "Drive DOCX 본문에서 건물명 후보를 주소로 좁혀 1건 매칭되었습니다."
    });
  }

  return Object.assign(base, {
    status: narrowedCandidates.length === 0 ? "unmatched" : "multiple",
    statusText: narrowedCandidates.length === 0
      ? "건물명 후보는 여러 개였지만 주소까지 포함된 DOCX 온보딩 수집서를 찾지 못했습니다."
      : "건물명과 주소를 함께 검색해도 복수 후보가 남아 수동 확인이 필요합니다.",
    candidateCount: narrowedCandidates.length,
    candidates: (narrowedCandidates.length ? narrowedCandidates : buildingCandidates).slice(0, 5).map(makeDriveCandidate_)
  });
}

function makeDriveSearchTerms_(value) {
  const text = String(value || "")
    .replace(/[(){}\[\],·ㆍ/|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return [];

  const terms = text.split(" ")
    .map(item => item.trim())
    .filter(item => item && (item.length >= 2 || /\d/.test(item)));
  return terms.length ? Array.from(new Set(terms)) : [text];
}

function searchDriveOnboardingFiles_(terms) {
  const folderId = extractDriveId_(COMPLAINT_CONFIG.CONTRACT_DRIVE_FOLDER_ID);
  const cleanTerms = (terms || []).map(term => String(term || "").trim()).filter(Boolean);
  if (!folderId) {
    return { ok: false, files: [], error: "Drive 폴더 ID가 설정되지 않았습니다." };
  }
  if (!cleanTerms.length) {
    return { ok: true, files: [] };
  }

  const queryParts = [
    "'" + escapeDriveQueryValue_(folderId) + "' in parents",
    "trashed = false",
    "mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'"
  ];
  cleanTerms.forEach(term => {
    queryParts.push("fullText contains '" + escapeDriveQueryValue_(term) + "'");
  });

  const files = [];
  try {
    const iterator = DriveApp.searchFiles(queryParts.join(" and "));
    while (iterator.hasNext()) {
      files.push(iterator.next());
      if (files.length >= 50) break;
    }
    return { ok: true, files: files };
  } catch (err) {
    Logger.log("Drive 온보딩 검색 실패: " + err.message);
    return {
      ok: false,
      files: [],
      error: "Drive 온보딩 검색 실패: 폴더 공유 권한 또는 DOCX 본문 검색 가능 여부를 확인하세요. " + err.message
    };
  }
}

function escapeDriveQueryValue_(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function makeDriveMatchPayload_(file, inputBuilding, inputAddress, options) {
  const fileName = file.getName();
  const fileUrl = file.getUrl();
  const driveFileId = file.getId();
  return {
    inputBuilding: inputBuilding,
    inputAddress: inputAddress,
    matchKey: options.matchKey,
    source: "drive_fulltext",
    status: "matched",
    statusText: options.statusText,
    fileName: fileName,
    fileUrl: fileUrl,
    driveFileId: driveFileId,
    candidateCount: options.candidateCount,
    contract: {
      building: inputBuilding,
      address: inputAddress,
      contractFileName: fileName,
      contractFileUrl: fileUrl,
      driveFileId: driveFileId
    }
  };
}

function makeDriveCandidate_(file) {
  return {
    fileName: file.getName(),
    fileUrl: file.getUrl(),
    driveFileId: file.getId()
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
  const isContractHold = contractMatch && (contractMatch.status === "unmatched" || contractMatch.status === "multiple" || contractMatch.status === "address_missing");
  const statusValue = isContractHold ? "계약확인보류" : analysis.statusValue;
  const status = isContractHold ? { c1: "doing" } : { c1: "done", c3: "done", c4: "done" };
  const c1Note = contractMatch && contractMatch.status === "matched"
    ? "구글폼 자동 접수. Drive 온보딩 수집서와 연결되었습니다. 개인정보/사진 원본은 응답 시트에서 확인하세요."
    : isContractHold
      ? "온보딩 파일 미매칭. Drive 폴더의 DOCX 본문에 건물명/주소가 있는지 확인한 뒤 진행하세요."
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
      contractMatch ? "온보딩매칭 " + contractMatch.status + " / " + contractMatch.statusText : "온보딩매칭 미확인"
    ]
  };
}

function writeAnalysisToSheet_(sheet, row, headers, ticketNo, analysis, casePayload, contractMatch) {
  const headerMap = {};
  headers.forEach((header, index) => headerMap[header] = index + 1);
  const contract = contractMatch && contractMatch.contract ? contractMatch.contract : {};
  const fileName = (contractMatch && contractMatch.fileName) || contract.contractFileName || "";
  const statusText = contractMatch ? contractMatch.statusText : "";
  const matchStatus = contractMatch ? contractMatch.status : "미확인";

  setCellByHeader_(sheet, row, headerMap, "접수번호", ticketNo);
  setCellByHeader_(sheet, row, headerMap, "긴급도", analysis.urgency);
  setCellByHeader_(sheet, row, headerMap, "민원 요약", analysis.summary);
  setCellByHeader_(sheet, row, headerMap, "업체 분류", analysis.vendorType);
  setCellByHeader_(sheet, row, headerMap, "상태값", casePayload.statusValue);
  setCellByHeader_(sheet, row, headerMap, "온보딩 매칭 상태", matchStatus);
  setCellByHeader_(sheet, row, headerMap, "온보딩 파일명", fileName);
  setCellByHeader_(sheet, row, headerMap, "온보딩 확인 메모", statusText);
  setCellByHeader_(sheet, row, headerMap, "계약 매칭 상태", matchStatus);
  setCellByHeader_(sheet, row, headerMap, "계약 건물주", contract.ownerName || "");
  setCellByHeader_(sheet, row, headerMap, "계약 파일명", fileName);
  setCellByHeader_(sheet, row, headerMap, "계약 확인 메모", statusText);
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
  const contractMatch = matchDriveOnboardingFile_(sample);
  Logger.log(JSON.stringify(buildCasePayload_("BR-TEST-0001", sample, analysis, contractMatch, 2, getResponseSheet_()), null, 2));
}

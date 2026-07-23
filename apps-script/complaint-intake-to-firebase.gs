/**
 * BRING Care 민원접수 자동 분석 -> FM GitHub.io 케이스 등록
 *
 * 설치 위치: Google Sheets 응답 시트의 확장 프로그램 > Apps Script
 * 최초 1회 실행: setupComplaintAutomation()
 */

const COMPLAINT_CONFIG = {
  SPREADSHEET_ID: "1HI6KzIMomL6vOUPs8zZDhXHktL1cWRDcg93lflsuojA",
  SHEET_NAME: "설문지 응답 시트1",
  CONTRACT_DRIVE_FOLDER_ID: "1GKI8oc4iicdEw7MnPKpfZrwKd4ZGKnBZ",
  QUOTE_DRIVE_FOLDER_ID: "11QX5F-KRQvvYNc0hso3QACuMS7lMZw4r",
  QUOTE_TEMPLATE_SPREADSHEET_ID: "1JXP8NEaU0I_96ZMAZFn2GlYQHkLsbhSJCawsdMgqH7w",
  VENDOR_QUOTE_REPLY_EMAIL: "bringengineering1008@gmail.com",
  WEB_APP_URL: "https://script.google.com/macros/s/AKfycbxGAdtEDoNifxkM-e_Jm7dBkCnjM4oPJqz8RxZXoMoSKod5M_m9Yj2b11-nI97zmfd6Jw/exec",
  FIREBASE_DATABASE_URL: "https://bring-fm-hj-default-rtdb.asia-southeast1.firebasedatabase.app",
  FIREBASE_CASES_PATH: "cases",
  RESPONSE_SHEET_URL: "https://docs.google.com/spreadsheets/d/1HI6KzIMomL6vOUPs8zZDhXHktL1cWRDcg93lflsuojA/edit",
  PAYMENT_SCHEDULE_DRIVE_FOLDER_ID: "1q1uKquSngjyi0upoCRmjnRxm_CD1sAcN",
  PAYMENT_SCHEDULE_SPREADSHEET_NAME: "BRING CARE 세입자 월세 관리대장"
};
const PAYMENT_SCHEDULE_SHEET_NAME = "세입자 월세 관리대장";
const PAYMENT_SCHEDULE_HEADERS = [
  "관리번호",
  "건물명",
  "호실",
  "세입자명",
  "연락처",
  "입금자명",
  "월 납부금액",
  "매월 납부일",
  "계약 시작일",
  "계약 종료일",
  "상태",
  "비고"
];
const AUTOMATION_BUILD = "complaint-workflow-20260723-v24";
const OWNER_RECOMMENDATION_IMAGE_VERSION = "owner-summary-v4";
const OWNER_DECISION_VIEW = "owner-decision";

const OUTPUT_HEADERS = [
  "접수번호",
  "긴급도",
  "민원 요약",
  "업체 분류",
  "상태값",
  "온보딩 매칭 상태",
  "온보딩 파일명",
  "온보딩 확인 메모",
  "문자 발송 상태",
  "문자 발송 메모",
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
  syncPaymentBuildingsFromOnboarding_();
  setupPaymentScheduleSheet_();
  ensurePaymentScheduleEditTrigger_();
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

  const templateId = extractDriveId_(COMPLAINT_CONFIG.QUOTE_TEMPLATE_SPREADSHEET_ID);
  const quoteFolderId = extractDriveId_(COMPLAINT_CONFIG.QUOTE_DRIVE_FOLDER_ID);
  if (quoteFolderId) {
    const quoteFolder = DriveApp.getFolderById(quoteFolderId);
    Logger.log("견적서 저장 폴더 확인 완료: " + quoteFolder.getName() + " / https://drive.google.com/drive/folders/" + quoteFolderId);
    Logger.log("사업자등록증은 견적서 저장 폴더의 케이스 폴더 안에 바로 저장됩니다: {접수번호}_{건물명}/사업자등록증/BR-..._{업체명}_사업자등록증.pdf");
  }

  if (templateId) {
    const templateFile = DriveApp.getFileById(templateId);
    Logger.log("견적서 템플릿 확인 완료: " + templateFile.getName() + " / " + templateFile.getUrl());
  } else {
    Logger.log("견적서 템플릿 미설정: QUOTE_TEMPLATE_SPREADSHEET_ID에 Google Sheets 템플릿 ID를 넣으면 ⑥에서 브링 양식 견적서를 자동 생성합니다.");
  }
}

function onComplaintFormSubmit(e) {
  const sheet = e && e.range ? e.range.getSheet() : getResponseSheet_();
  const row = e && e.range ? e.range.getRow() : sheet.getLastRow();
  processResponseRow_(sheet, row);
}

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  if (String(params.view || "") === OWNER_DECISION_VIEW) {
    return renderOwnerDecisionPage_(params);
  }
  return HtmlService.createHtmlOutput(
    "<!doctype html><html lang=\"ko\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<title>BRING Care</title></head><body style=\"font-family:Arial,sans-serif;padding:32px\">" +
    "<h1 style=\"font-size:22px\">BRING Care 자동화</h1><p>서비스가 정상 작동 중입니다.</p></body></html>"
  ).setTitle("BRING Care");
}

function doPost(e) {
  let payload = {};
  try {
    payload = JSON.parse(e && e.postData && e.postData.contents ? e.postData.contents : "{}");
    if (payload.action === "healthCheck") {
      return jsonResponse_({ ok: true, build: AUTOMATION_BUILD, time: new Date().toISOString() });
    }
    if (payload.action === "syncPaymentBuildings") {
      return jsonResponse_(syncPaymentBuildingsFromOnboarding_());
    }
    if (payload.action === "syncPaymentSchedules") {
      return jsonResponse_(syncPaymentSchedulesFromSheet_(payload));
    }
    if (payload.action === "sendPaymentReminderSms") {
      return jsonResponse_(handlePaymentReminderSms_(payload));
    }
    if (payload.action === "sendComplaintReceiptSms") {
      return jsonResponse_(handleComplaintReceiptSms_(payload));
    }
    if (payload.action === "sendVendorEstimateMms") {
      return jsonResponse_(handleVendorEstimateMms_(payload));
    }
    if (payload.action === "getOwnerRecommendationPreview") {
      return jsonResponse_(handleOwnerRecommendationPreview_(payload));
    }
    if (payload.action === "ensureOwnerDecisionLink") {
      return jsonResponse_(handleEnsureOwnerDecisionLink_(payload));
    }
    if (payload.action === "sendOwnerRecommendationMms") {
      return jsonResponse_(handleOwnerRecommendationMms_(payload));
    }
    if (payload.action === "confirmOwnerRecommendationMms") {
      return jsonResponse_(handleOwnerRecommendationMmsConfirmation_(payload));
    }
    if (payload.action === "uploadQuoteFile") {
      return jsonResponse_(handleQuoteFileUpload_(payload));
    }
    if (payload.action === "uploadBusinessRegistration") {
      return jsonResponse_(handleBusinessRegistrationUpload_(payload));
    }
    if (payload.action === "confirmQuoteAmount") {
      return jsonResponse_(handleConfirmQuoteAmount_(payload));
    }
    if (payload.action === "applyBusinessRegistrationToQuote") {
      return jsonResponse_(handleApplyBusinessRegistrationToQuote_(payload));
    }
    return jsonResponse_({ ok: false, message: "지원하지 않는 action입니다." });
  } catch (err) {
    try {
      recordAutomationError_(payload, err);
    } catch (recordErr) {
      Logger.log("자동화 오류 기록 실패: " + recordErr.message);
    }
    return jsonResponse_({ ok: false, message: err.message });
  }
}

function ownerDecisionWebAppUrl_() {
  const configured = String(COMPLAINT_CONFIG.WEB_APP_URL || "").trim();
  if (configured) return configured;
  return String(ScriptApp.getService().getUrl() || "").trim();
}

function ensureOwnerDecisionLink_(caseId, casePayload, quoteId, supplier, amounts) {
  const existing = casePayload && casePayload.ownerDecision || {};
  if (
    existing.status === "pending" &&
    existing.token &&
    existing.decisionUrl &&
    String(existing.quoteId || "") === String(quoteId || "")
  ) {
    return existing;
  }

  const baseUrl = ownerDecisionWebAppUrl_();
  if (!baseUrl) throw new Error("Apps Script 웹 앱 URL을 확인하지 못했습니다.");
  const now = new Date().toISOString();
  const token = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
  const decisionUrl = baseUrl +
    "?view=" + encodeURIComponent(OWNER_DECISION_VIEW) +
    "&caseId=" + encodeURIComponent(caseId) +
    "&token=" + encodeURIComponent(token);
  const state = {
    status: "pending",
    statusText: "건물주 응답 대기",
    token: token,
    decisionUrl: decisionUrl,
    quoteId: String(quoteId || ""),
    vendorName: String(supplier && supplier.name || ""),
    bringTotalAmount: Number(amounts && amounts.totalAmount || 0),
    createdAt: now,
    updatedAt: now
  };
  putCaseChildToFirebase_(caseId, "ownerDecision", state);
  casePayload.ownerDecision = state;
  return state;
}

function validateOwnerDecisionLink_(decisionUrl) {
  const url = String(decisionUrl || "").trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec\?/i.test(url)) {
    return { ok: false, statusCode: 0, message: "승인 링크 형식이 올바르지 않습니다." };
  }
  try {
    const response = UrlFetchApp.fetch(url, {
      method: "get",
      followRedirects: true,
      muteHttpExceptions: true
    });
    const statusCode = Number(response.getResponseCode() || 0);
    const body = String(response.getContentText() || "");
    const validPage = body.indexOf('data-owner-decision-valid="1"') >= 0;
    return {
      ok: statusCode >= 200 && statusCode < 400 && validPage,
      statusCode: statusCode,
      message: validPage
        ? "승인 링크 열림 확인 완료"
        : "승인 링크가 유효한 승인 화면을 반환하지 않았습니다."
    };
  } catch (err) {
    return {
      ok: false,
      statusCode: 0,
      message: "승인 링크 열림 확인 실패: " + err.message
    };
  }
}

function prepareOwnerDecisionLinkForCase_(caseId, casePayload, quoteId, quote) {
  const supplier = ownerRecommendationSupplier_(quote);
  const amounts = ownerRecommendationAmounts_(quote);
  let state = ensureOwnerDecisionLink_(caseId, casePayload, quoteId, supplier, amounts);
  if (
    state.linkValidated === true &&
    state.linkValidatedAt &&
    String(state.quoteId || "") === String(quoteId || "") &&
    state.decisionUrl
  ) {
    return { ok: true, state: state, supplier: supplier, amounts: amounts, reused: true };
  }

  const validation = validateOwnerDecisionLink_(state.decisionUrl);
  state = Object.assign({}, state, {
    linkValidated: validation.ok === true,
    linkStatus: validation.ok ? "ready" : "failed",
    linkStatusText: validation.message || "",
    linkStatusCode: validation.statusCode || 0,
    linkValidatedAt: validation.ok ? new Date().toISOString() : "",
    updatedAt: new Date().toISOString()
  });
  putCaseChildToFirebase_(caseId, "ownerDecision", state);
  casePayload.ownerDecision = state;
  return {
    ok: validation.ok === true,
    state: state,
    supplier: supplier,
    amounts: amounts,
    message: validation.message || ""
  };
}

function handleEnsureOwnerDecisionLink_(payload) {
  const caseId = String(payload && payload.caseId || "").trim();
  if (!caseId) return { ok: false, message: "caseId가 없습니다." };
  const casePayload = readCaseFromFirebase_(caseId);
  if (!casePayload) return { ok: false, message: "Firebase 케이스를 찾지 못했습니다: " + caseId };
  const selected = selectOwnerRecommendationQuote_(casePayload, payload && payload.quoteId);
  if (!selected.quote) return { ok: false, message: "승인 링크에 연결할 추천 견적이 없습니다." };

  const prepared = prepareOwnerDecisionLinkForCase_(caseId, casePayload, selected.quoteId, selected.quote);
  return {
    ok: prepared.ok === true,
    caseId: caseId,
    quoteId: selected.quoteId,
    decisionUrl: prepared.state && prepared.state.decisionUrl || "",
    decisionStatus: prepared.state && prepared.state.status || "",
    linkValidated: prepared.state && prepared.state.linkValidated === true,
    linkStatusText: prepared.state && prepared.state.linkStatusText || prepared.message || "",
    reused: prepared.reused === true
  };
}

function appendOwnerDecisionLink_(message, decisionUrl) {
  const content = String(message || "").trim();
  const url = String(decisionUrl || "").trim();
  if (!url || content.indexOf(url) >= 0) return content;
  const guide = [
    "추천 견적으로 진행을 원하시면 아래 링크에서",
    "'승인하고 입금 진행' 버튼을 눌러주세요."
  ].join("\n");
  const lines = [content];
  if (content.indexOf("승인하고 입금 진행") < 0) lines.push("", guide);
  lines.push("", "승인 링크:", url);
  return lines.join("\n");
}

function ownerDecisionEscapeHtml_(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ownerDecisionStatusText_(status) {
  if (status === "approved_payment") return "승인하고 입금 진행";
  if (status === "request_other_quote") return "다른 견적 요청";
  return "응답 대기";
}

function renderOwnerDecisionPage_(params) {
  const caseId = String(params && params.caseId || "").trim();
  const token = String(params && params.token || "").trim();
  const casePayload = caseId ? readCaseFromFirebase_(caseId) : null;
  const state = casePayload && casePayload.ownerDecision || {};
  const valid = !!(casePayload && token && state.token && token === String(state.token));
  const selected = valid ? selectOwnerRecommendationQuote_(casePayload, state.quoteId) : { quoteId: "", quote: null };
  const supplier = selected.quote ? ownerRecommendationSupplier_(selected.quote) : { name: state.vendorName || "" };
  const amounts = selected.quote ? ownerRecommendationAmounts_(selected.quote) : { totalAmount: Number(state.bringTotalAmount || 0) };
  const workLines = selected.quote ? ownerRecommendationWorkLines_(selected.quote) : [];
  const decided = valid && state.status && state.status !== "pending";
  const title = valid ? "추천 견적 승인" : "링크 확인 필요";
  const description = valid
    ? "추천 내용을 확인하고 아래 두 항목 중 하나를 선택해 주세요."
    : "유효하지 않거나 만료된 링크입니다. BRING Care 담당자에게 문의해 주세요.";
  const workHtml = workLines.length
    ? workLines.slice(0, 4).map(line => "<li>" + ownerDecisionEscapeHtml_(line) + "</li>").join("")
    : "<li>견적서의 작업 내용을 확인해 주세요.</li>";
  const statusHtml = decided
    ? "<div class=\"result " + (state.status === "approved_payment" ? "approved" : "other") + "\">" +
      "<strong>" + ownerDecisionEscapeHtml_(ownerDecisionStatusText_(state.status)) + "</strong>" +
      "<span>응답이 정상적으로 접수되었습니다.</span></div>"
    : "";
  const buttons = valid && !decided
    ? "<div class=\"actions\"><button class=\"approve\" onclick=\"submitDecision('approve_payment')\">승인하고 입금 진행</button>" +
      "<button class=\"other\" onclick=\"submitDecision('request_other_quote')\">다른 견적 요청</button></div>"
    : "";
  const caseIdJs = JSON.stringify(caseId).replace(/</g, "\\u003c");
  const tokenJs = JSON.stringify(token).replace(/</g, "\\u003c");
  const html = [
    "<!doctype html><html lang=\"ko\"><head><meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">",
    "<title>BRING Care 추천 견적 승인</title>",
    "<style>",
    "*{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#162033;font-family:Arial,'Noto Sans KR',sans-serif}",
    ".page{max-width:520px;margin:0 auto;padding:22px 16px 40px}.brand{font-weight:900;color:#173a70;font-size:18px;margin:5px 0 24px}",
    ".card{background:#fff;border:1px solid #dbe3ef;border-radius:8px;padding:22px 18px;box-shadow:0 8px 24px rgba(31,57,91,.08)}",
    "h1{font-size:24px;line-height:1.3;margin:0 0 8px}p{font-size:14px;line-height:1.6;color:#667085;margin:0 0 20px}",
    ".amount{background:#eaf2ff;border:1px solid #bfd3f6;border-radius:8px;padding:18px;margin:0 0 16px}",
    ".amount span{display:block;font-size:12px;color:#52606f;margin-bottom:5px}.amount strong{font-size:30px;color:#123568;letter-spacing:0}",
    ".info{display:grid;grid-template-columns:92px 1fr;gap:10px 12px;padding:14px 0;border-top:1px solid #edf1f6}",
    ".info b{font-size:13px;color:#667085}.info span{font-size:14px;font-weight:700;word-break:keep-all}",
    ".work{border-top:1px solid #edf1f6;padding-top:15px}.work b{font-size:13px}.work ul{margin:9px 0 0;padding-left:20px}.work li{font-size:14px;line-height:1.55;margin:4px 0}",
    ".actions{display:grid;gap:10px;margin-top:22px}.actions button{width:100%;min-height:54px;border-radius:8px;font-size:16px;font-weight:800;cursor:pointer}",
    ".approve{border:1px solid #173a70;background:#173a70;color:#fff}.other{border:1px solid #b8c3d1;background:#fff;color:#27364a}",
    ".actions button:disabled{opacity:.55;cursor:wait}.result{display:flex;flex-direction:column;gap:6px;margin-top:22px;padding:17px;border-radius:8px}",
    ".result.approved{background:#eaf8ef;border:1px solid #9cd9b0;color:#116329}.result.other{background:#fff7e8;border:1px solid #f1c879;color:#8a5300}",
    ".result strong{font-size:17px}.result span{font-size:13px}.message{margin-top:14px;font-size:13px;color:#667085;text-align:center}",
    "</style></head><body data-owner-decision-valid=\"" + (valid ? "1" : "0") + "\"><main class=\"page\"><div class=\"brand\">BRING Care</div><section class=\"card\">",
    "<h1>" + ownerDecisionEscapeHtml_(title) + "</h1><p>" + ownerDecisionEscapeHtml_(description) + "</p>",
    valid ? "<div class=\"amount\"><span>추천 최종금액</span><strong>" + ownerDecisionEscapeHtml_(ownerRecommendationAmountText_(amounts.totalAmount)) + "</strong></div>" : "",
    valid ? "<div class=\"info\"><b>추천 업체</b><span>" + ownerDecisionEscapeHtml_(supplier.name || "업체 확인 필요") + "</span><b>접수번호</b><span>" + ownerDecisionEscapeHtml_(casePayload.ticketNo || caseId) + "</span></div>" : "",
    valid ? "<div class=\"work\"><b>주요 작업</b><ul>" + workHtml + "</ul></div>" : "",
    "<div id=\"result\">" + statusHtml + "</div>" + buttons + "<div class=\"message\" id=\"message\"></div>",
    "</section></main><script>",
    "var CASE_ID=" + caseIdJs + ";var TOKEN=" + tokenJs + ";var running=false;",
    "function submitDecision(decision){if(running)return;running=true;var buttons=document.querySelectorAll('button');buttons.forEach(function(b){b.disabled=true});",
    "document.getElementById('message').textContent='응답을 저장하고 있습니다...';",
    "google.script.run.withSuccessHandler(function(result){running=false;if(!result||!result.ok){document.getElementById('message').textContent=result&&result.message||'응답 저장에 실패했습니다.';buttons.forEach(function(b){b.disabled=false});return;}",
    "document.getElementById('message').textContent='';document.querySelector('.actions').remove();var cls=decision==='approve_payment'?'approved':'other';",
    "var label=decision==='approve_payment'?'승인하고 입금 진행':'다른 견적 요청';document.getElementById('result').innerHTML='<div class=\"result '+cls+'\"><strong>'+label+'</strong><span>응답이 정상적으로 접수되었습니다.</span></div>';",
    "}).withFailureHandler(function(err){running=false;document.getElementById('message').textContent=err&&err.message||'응답 저장에 실패했습니다.';buttons.forEach(function(b){b.disabled=false});}).submitOwnerDecision(CASE_ID,TOKEN,decision);}",
    "</script></body></html>"
  ].join("");
  return HtmlService.createHtmlOutput(html).setTitle("BRING Care 추천 견적 승인");
}

function submitOwnerDecision(caseId, token, decision) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, message: "다른 응답을 처리 중입니다. 잠시 후 다시 시도해 주세요." };
  try {
    return submitOwnerDecisionLocked_(caseId, token, decision);
  } finally {
    lock.releaseLock();
  }
}

function submitOwnerDecisionLocked_(caseId, token, decision) {
  caseId = String(caseId || "").trim();
  token = String(token || "").trim();
  decision = String(decision || "").trim();
  if (!caseId || !token) return { ok: false, message: "승인 링크 정보가 없습니다." };
  if (decision !== "approve_payment" && decision !== "request_other_quote") {
    return { ok: false, message: "지원하지 않는 응답입니다." };
  }
  const casePayload = readCaseFromFirebase_(caseId);
  if (!casePayload) return { ok: false, message: "케이스를 찾지 못했습니다." };
  const current = Object.assign({}, casePayload.ownerDecision || {});
  if (!current.token || current.token !== token) return { ok: false, message: "유효하지 않거나 만료된 승인 링크입니다." };
  if (current.status && current.status !== "pending") {
    return current.status === (decision === "approve_payment" ? "approved_payment" : "request_other_quote")
      ? { ok: true, skipped: true, status: current.status }
      : { ok: false, message: "이미 다른 응답이 접수된 링크입니다." };
  }

  const now = new Date().toISOString();
  const resolved = Object.assign({}, current, {
    status: decision === "approve_payment" ? "approved_payment" : "request_other_quote",
    statusText: decision === "approve_payment" ? "승인하고 입금 진행" : "다른 견적 요청",
    decidedAt: now,
    updatedAt: now
  });
  putCaseChildToFirebase_(caseId, "ownerDecision", resolved);

  if (decision === "approve_payment") {
    const automationState = Object.assign({}, casePayload.automationState || {});
    workflowStepState_(automationState, "c9", "done", now, { decision: decision, source: "owner_mobile_link" });
    workflowStepState_(automationState, "c10", "doing", now, { mode: "payment_confirmation" });
    const log = Array.isArray(casePayload.log) ? casePayload.log.slice() : [];
    log.unshift("건물주 승인 완료 · 입금 진행");
    if (log.length > 30) log.length = 30;
    patchCaseChildToFirebase_(caseId, "status", { c9: "done", c10: "doing" });
    patchCaseChildToFirebase_(caseId, "note", {
      c9: "건물주가 추천 견적을 승인하고 입금 진행을 선택했습니다.",
      c10: "건물주 승인 완료 · 입금 확인 대기 중"
    });
    patchCaseToFirebase_(caseId, {
      automationState: automationState,
      paymentStatus: "awaiting_payment",
      log: log,
      updatedAt: now
    });
    return { ok: true, status: resolved.status, nextStep: "c10" };
  }

  reopenCaseForAnotherQuote_(caseId, casePayload, resolved, now);
  return { ok: true, status: resolved.status, nextStep: "c5" };
}

function reopenCaseForAnotherQuote_(caseId, casePayload, ownerDecision, now) {
  const currentRound = Math.max(1, Number(casePayload.quoteRequestRound || 1));
  const roundKey = "round-" + currentRound;
  const roundSnapshot = {
    round: currentRound,
    ownerDecision: ownerDecision,
    vendorSelections: casePayload.vendorSelections || {},
    selectedVendors: casePayload.selectedVendors || [],
    vendorEstimateMms: casePayload.vendorEstimateMms || {},
    quoteFiles: casePayload.quoteFiles || {},
    businessRegistrationFiles: casePayload.businessRegistrationFiles || {},
    recommendation: casePayload.recommendation || {},
    ownerRecommendationMms: casePayload.ownerRecommendationMms || {},
    archivedAt: now
  };
  putCaseChildToFirebase_(caseId, "quoteRequestRounds/" + roundKey, roundSnapshot);

  const automationState = Object.assign({}, casePayload.automationState || {});
  delete automationState.vendorEstimateMms;
  delete automationState.ownerRecommendationMms;
  delete automationState.uploadBatch;
  automationState.workflow = Object.assign({}, automationState.workflow || {});
  ["c6", "c7", "c8", "c9", "c10", "c11", "c12", "c13", "c14", "c15", "c16", "c17"].forEach(key => delete automationState.workflow[key]);
  workflowStepState_(automationState, "c5", "doing", now, { mode: "manual_vendor_selection", reason: "owner_requested_other_quote" });

  const log = Array.isArray(casePayload.log) ? casePayload.log.slice() : [];
  log.unshift("건물주가 다른 견적 요청을 선택했습니다. ⑤ 업체 견적 요청을 다시 시작합니다.");
  if (log.length > 30) log.length = 30;
  const statusPatch = { c5: "doing" };
  const notePatch = { c5: "건물주가 다른 견적 요청을 선택했습니다. 새 업체를 선택해 견적을 요청해 주세요." };
  for (let i = 6; i <= 17; i += 1) {
    statusPatch["c" + i] = null;
    notePatch["c" + i] = null;
  }
  patchCaseChildToFirebase_(caseId, "status", statusPatch);
  patchCaseChildToFirebase_(caseId, "note", notePatch);
  patchCaseToFirebase_(caseId, {
    quoteRequestRound: currentRound + 1,
    vendorSelections: null,
    selectedVendors: null,
    vendorEstimateMms: null,
    quoteFiles: null,
    businessRegistrationFiles: null,
    recommendation: null,
    ownerRecommendationMms: null,
    automationState: automationState,
    log: log,
    updatedAt: now
  });
}

function recordAutomationError_(payload, err) {
  const action = String(payload && payload.action || "");
  const caseId = String(payload && payload.caseId || "").trim();
  if (!caseId) return;

  const message = err && err.message ? err.message : String(err || "알 수 없는 오류");
  const now = new Date().toISOString();
  const casePayload = readCaseFromFirebase_(caseId) || {};
  const log = Array.isArray(casePayload.log) ? casePayload.log : [];

  if (action === "sendComplaintReceiptSms") {
    patchCaseChildToFirebase_(caseId, "status", { c2: "doing" });
    patchCaseChildToFirebase_(caseId, "note", { c2: "접수확인 문자 발송 실패: " + message });
    log.unshift("접수확인 문자 발송 실패: " + message);
  } else if (action === "uploadQuoteFile") {
    const fileName = payload && payload.file && payload.file.fileName ? String(payload.file.fileName) : "파일명 미확인";
    patchCaseChildToFirebase_(caseId, "status", { c6: "doing" });
    patchCaseChildToFirebase_(caseId, "note", { c6: "견적 파일 업로드 실패: " + fileName + " / " + message });
    log.unshift("견적 파일 업로드 실패: " + fileName + " / " + message);
  } else if (action === "uploadBusinessRegistration") {
    const fileName = payload && payload.file && payload.file.fileName ? String(payload.file.fileName) : "파일명 미확인";
    patchCaseChildToFirebase_(caseId, "status", { c6: "doing" });
    patchCaseChildToFirebase_(caseId, "note", { c6: "사업자등록증 업로드 실패: " + fileName + " / " + message });
    log.unshift("사업자등록증 업로드 실패: " + fileName + " / " + message);
  } else if (action === "confirmQuoteAmount") {
    patchCaseChildToFirebase_(caseId, "status", { c6: "doing" });
    patchCaseChildToFirebase_(caseId, "note", { c6: "견적 합계금액 확정 실패: " + message });
    log.unshift("견적 합계금액 확정 실패: " + message);
  } else if (action === "sendVendorEstimateMms") {
    patchCaseChildToFirebase_(caseId, "status", { c5: "doing" });
    patchCaseChildToFirebase_(caseId, "note", { c5: "업체 MMS 발송 실패: " + message });
    log.unshift("업체 MMS 발송 실패: " + message);
  } else if (action === "sendOwnerRecommendationMms") {
    patchCaseChildToFirebase_(caseId, "status", { c8: "doing" });
    patchCaseChildToFirebase_(caseId, "note", { c8: "건물주 추천 MMS 발송 실패: " + message });
    log.unshift("건물주 추천 MMS 발송 실패: " + message);
  } else {
    return;
  }

  if (log.length > 30) log.length = 30;
  patchCaseToFirebase_(caseId, { log: log, updatedAt: now });
}

function jsonResponse_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value || {}))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleComplaintReceiptSms_(payload) {
  const caseId = String(payload.caseId || "").trim();
  if (!caseId) return { ok: false, message: "caseId가 없습니다." };

  const casePayload = readCaseFromFirebase_(caseId);
  if (!casePayload) return { ok: false, message: "Firebase 케이스를 찾지 못했습니다: " + caseId };

  const existingStatus = String(casePayload.sms && casePayload.sms.status || "");
  if (!payload.force && isSmsSentStatus_(existingStatus)) {
    const skippedResult = {
      status: existingStatus,
      statusText: (casePayload.note && casePayload.note.c2) || "이미 발송된 문자 기록이 있어 재발송하지 않았습니다.",
      skipped: true
    };
    return Object.assign({ ok: true, caseId: caseId, message: skippedResult.statusText }, skippedResult);
  }

  const record = readResponseRecordForCase_(casePayload);
  const smsRecord = Object.keys(record).length ? record : casePayloadToSmsRecord_(casePayload, payload);
  const ticketNo = casePayload.ticketNo || casePayload.id || caseId;
  const analysis = {
    urgency: casePayload.urgency || "",
    vendorType: casePayload.vendorType || "",
    summary: casePayload.summary || "",
    reason: casePayload.analysisReason || ""
  };
  const smsResult = sendComplaintSms_(ticketNo, smsRecord, analysis, casePayload.contractMatch || {}, {
    force: payload.force === true
  });

  applySmsResultToCase_(casePayload, smsResult);
  if (!smsResult.skipped) writeSmsResultToSheetForCase_(casePayload, smsResult);
  writeCaseToFirebase_(caseId, casePayload);
  const workflow = advanceCaseWorkflow_(caseId, { source: "receipt_sms", skipOwnerAutoSend: true });

  const ok = isSmsSentStatus_(smsResult.status);
  return Object.assign({
    ok: ok,
    caseId: caseId,
    message: smsResult.statusText || smsResult.status || "",
    workflow: workflow
  }, smsResult);
}

function casePayloadToSmsRecord_(casePayload, payload) {
  const contact = payload && payload.contact || {};
  return {
    "건물명": casePayload.building || contact.building || "",
    "건물 주소": casePayload.address || contact.address || "",
    "호실": casePayload.room || contact.room || "",
    "이름": casePayload.name || contact.name || "",
    "연락처": contact.phone || casePayload.phone || "",
    "문제 유형": casePayload.issueType || contact.issueType || "",
    "방문 가능 시간": formatKoreanDateTimeForCase_(
      casePayload.visitTime || contact.visitTime || "",
      casePayload.visitDate || contact.visitDate || casePayload.receivedAt || casePayload.createdAt
    ),
    "민원 내용": casePayload.summary || contact.summary || ""
  };
}

function writeSmsResultToSheetForCase_(casePayload, smsResult) {
  const row = Number(casePayload && casePayload.sheetRow);
  if (!row || row < 2) return;

  const sheet = getResponseSheet_();
  const headers = ensureOutputHeaders_(sheet);
  const headerMap = {};
  headers.forEach((header, index) => headerMap[header] = index + 1);
  setCellByHeader_(sheet, row, headerMap, "문자 발송 상태", smsResult.status || "");
  setCellByHeader_(sheet, row, headerMap, "문자 발송 메모", smsResult.statusText || "");
}

function handleVendorEstimateMms_(payload) {
  const caseId = String(payload.caseId || "").trim();
  const selectedVendors = Array.isArray(payload.vendors) ? payload.vendors.map(normalizeVendorForMms_).filter(v => v.name || v.phone) : [];

  if (!caseId) return { ok: false, message: "caseId가 없습니다." };

  const casePayload = readCaseFromFirebase_(caseId);
  if (!casePayload) return { ok: false, message: "Firebase 케이스를 찾지 못했습니다: " + caseId };

  const requestKey = "vendor-mms:" + caseId + ":" + selectedVendors.map(vendor => [
    vendor.id || "",
    vendor.name || "",
    vendorSmsPhone_(vendor) || ""
  ].join("|")).sort().join(";");
  const previous = casePayload.vendorEstimateMms || {};
  if (payload.force !== true && previous.ok === true && previous.requestKey === requestKey) {
    const workflow = advanceCaseWorkflow_(caseId, { source: "vendor_mms", skipOwnerAutoSend: true });
    return Object.assign({ caseId: caseId, skipped: true, workflow: workflow }, previous);
  }

  if (!selectedVendors.length) {
    return updateVendorMmsCase_(caseId, casePayload, {
      ok: false,
      status: "blocked",
      statusText: "선택된 업체가 없어 MMS 발송을 보류했습니다.",
      sent: [],
      failed: [],
      skipped: []
    });
  }

  const record = readResponseRecordForCase_(casePayload);
  const photo = firstJpegPhotoFromRecord_(record);
  if (!photo.ok) {
    return updateVendorMmsCase_(caseId, casePayload, {
      ok: false,
      status: "blocked",
      statusText: photo.message,
      sent: [],
      failed: [],
      skipped: selectedVendors.map(v => ({ name: v.name, reason: "사진 미확인" }))
    });
  }

  const config = getSensConfig_();
  if (!config.enabled) {
    return updateVendorMmsCase_(caseId, casePayload, {
      ok: false,
      status: "blocked",
      statusText: "NCP SENS 설정 또는 승인된 발신번호가 없어 MMS 발송을 보류했습니다.",
      photoName: photo.fileName,
      sent: [],
      failed: [],
      skipped: selectedVendors.map(v => ({ name: v.name, reason: "SENS 설정 필요" }))
    });
  }

  const upload = uploadSensMmsAttachment_(photo, config);
  if (!upload.ok) {
    return updateVendorMmsCase_(caseId, casePayload, {
      ok: false,
      status: "blocked",
      statusText: upload.message,
      photoName: photo.fileName,
      sent: [],
      failed: [],
      skipped: selectedVendors.map(v => ({ name: v.name, reason: "사진 업로드 실패" }))
    });
  }

  const content = String(payload.message || "").trim() || makeVendorEstimateMmsContent_(casePayload, record);
  const result = {
    ok: false,
    status: "failed",
    statusText: "",
    requestKey: requestKey,
    photoName: photo.fileName,
    sensFileId: upload.fileId,
    sent: [],
    failed: [],
    skipped: []
  };

  selectedVendors.forEach(vendor => {
    const to = vendorSmsPhone_(vendor);
    if (!to) {
      result.skipped.push({ name: vendor.name || "업체명 없음", reason: "MMS 가능한 휴대폰 번호 없음" });
      return;
    }

    const sendResult = sendSensMms_(to, content, upload.fileId, vendor.name || "업체", config);
    const item = {
      name: vendor.name || "업체명 없음",
      category: vendor.category || "",
      phoneMasked: maskPhone_(to),
      message: sendResult.message,
      requestId: sendResult.requestId || "",
      statusCode: sendResult.statusCode || "",
      statusName: sendResult.statusName || "",
      responseCode: sendResult.responseCode || ""
    };
    if (sendResult.ok) {
      result.sent.push(item);
    } else {
      result.failed.push(item);
    }
  });

  result.ok = selectedVendors.length > 0 &&
    result.sent.length === selectedVendors.length &&
    result.failed.length === 0 &&
    result.skipped.length === 0;
  result.status = result.ok ? "sent" : "failed";
  result.statusText = result.ok
    ? "업체 MMS 발송 완료: " + result.sent.length + "곳"
    : "업체 MMS 발송 보류/실패: 성공 " + result.sent.length + "곳, 실패 " + result.failed.length + "곳, 제외 " + result.skipped.length + "곳";

  return updateVendorMmsCase_(caseId, casePayload, result);
}

function handleOwnerRecommendationPreview_(payload) {
  const caseId = String(payload && payload.caseId || "").trim();
  if (!caseId) return { ok: false, message: "caseId가 없습니다." };

  const casePayload = readCaseFromFirebase_(caseId);
  if (!casePayload) return { ok: false, message: "Firebase 케이스를 찾지 못했습니다: " + caseId };

  const selected = selectOwnerRecommendationQuote_(casePayload, payload.quoteId);
  if (!selected.quote) {
    return { ok: false, message: "추천할 수 있는 금액 확인 견적이 없습니다." };
  }

  const ownerPhone = extractOwnerRecommendationPhone_(casePayload);
  const preparedDecision = prepareOwnerDecisionLinkForCase_(caseId, casePayload, selected.quoteId, selected.quote);
  const supplier = preparedDecision.supplier;
  const amounts = preparedDecision.amounts;
  const ownerDecision = preparedDecision.state || {};
  if (!preparedDecision.ok || !ownerDecision.decisionUrl) {
    return {
      ok: false,
      status: "blocked",
      message: preparedDecision.message || ownerDecision.linkStatusText || "승인 링크가 열리는지 확인하지 못해 미리보기를 만들지 않았습니다.",
      caseId: caseId,
      quoteId: selected.quoteId,
      decisionUrl: ownerDecision.decisionUrl || "",
      linkValidated: false
    };
  }
  const message = appendOwnerDecisionLink_(
    String(payload.message || "").trim() || makeOwnerRecommendationMmsContent_(casePayload, supplier, amounts),
    ownerDecision.decisionUrl
  );
  let image = null;
  try {
    image = createOwnerRecommendationImage_(casePayload, selected.quoteId, selected.quote, supplier, amounts);
  } catch (err) {
    Logger.log("건물주 추천 이미지 미리 생성 실패: " + err.message);
  }

  const preview = {
    quoteId: selected.quoteId,
    vendorName: supplier.name,
    ownerPhoneMasked: maskPhone_(ownerPhone),
    ownerPhoneAvailable: !!ownerPhone,
    bringTotalAmount: amounts.totalAmount,
    bringSupplyAmount: amounts.supplyAmount,
    bringVatAmount: amounts.vatAmount,
    message: message,
    decisionUrl: ownerDecision.decisionUrl,
    decisionStatus: ownerDecision.status,
    decisionLinkValidated: true,
    imageFileId: image && image.fileId || "",
    imageFileUrl: image && image.fileUrl || "",
    imageFileName: image && image.fileName || "",
    imageDesignVersion: image && image.imageDesignVersion || OWNER_RECOMMENDATION_IMAGE_VERSION,
    updatedAt: new Date().toISOString()
  };
  try {
    patchCaseChildToFirebase_(caseId, "ownerRecommendationMms/preview", preview);
  } catch (err) {
    Logger.log("건물주 추천 미리보기 저장 실패: " + err.message);
  }

  return {
    ok: true,
    caseId: caseId,
    quoteId: selected.quoteId,
    vendorName: supplier.name,
    ownerPhoneMasked: maskPhone_(ownerPhone),
    ownerPhoneAvailable: !!ownerPhone,
    bringTotalAmount: amounts.totalAmount,
    bringSupplyAmount: amounts.supplyAmount,
    bringVatAmount: amounts.vatAmount,
    message: message,
    decisionUrl: ownerDecision.decisionUrl,
    decisionStatus: ownerDecision.status,
    decisionLinkValidated: true,
    imageFileId: image && image.fileId || "",
    imageFileUrl: image && image.fileUrl || "",
    imageFileName: image && image.fileName || "",
    imageDesignVersion: image && image.imageDesignVersion || OWNER_RECOMMENDATION_IMAGE_VERSION
  };
}

function handleOwnerRecommendationMms_(payload) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { ok: false, status: "blocked", statusText: "다른 건물주 추천 MMS 요청을 처리 중입니다. 잠시 후 다시 시도해 주세요." };
  }
  try {
    return handleOwnerRecommendationMmsLocked_(payload || {});
  } finally {
    lock.releaseLock();
  }
}

function handleOwnerRecommendationMmsConfirmation_(payload) {
  const caseId = String(payload && payload.caseId || "").trim();
  if (!caseId) return { ok: false, message: "caseId가 없습니다." };

  const casePayload = readCaseFromFirebase_(caseId);
  if (!casePayload) return { ok: false, message: "Firebase 케이스를 찾지 못했습니다: " + caseId };

  const existing = casePayload.ownerRecommendationMms || {};
  if (existing.deliveryConfirmed === true || (existing.ok === true && existing.status === "sent")) {
    return Object.assign({ caseId: caseId, skipped: true }, existing);
  }
  if (
    existing.deliveryAccepted !== true &&
    existing.status !== "sent_pending_confirmation" &&
    existing.status !== "sending"
  ) {
    return updateOwnerRecommendationMmsCase_(caseId, casePayload, {
      ok: false,
      status: "blocked",
      statusText: "먼저 건물주 추천 MMS 발송을 요청해야 합니다.",
      requestKey: existing.requestKey || "",
      quoteId: existing.quoteId || "",
      vendorName: existing.vendorName || ""
    });
  }

  const result = Object.assign({}, existing, {
    ok: true,
    status: "sent",
    deliveryAccepted: true,
    deliveryConfirmed: true,
    confirmedAt: new Date().toISOString(),
    statusText: "건물주 문자 수신 확인 완료"
  });
  return updateOwnerRecommendationMmsCase_(caseId, casePayload, result);
}

function handleOwnerRecommendationMmsLocked_(payload) {
  const caseId = String(payload.caseId || "").trim();
  if (!caseId) return { ok: false, message: "caseId가 없습니다." };

  const casePayload = readCaseFromFirebase_(caseId);
  if (!casePayload) return { ok: false, message: "Firebase 케이스를 찾지 못했습니다: " + caseId };

  const selected = selectOwnerRecommendationQuote_(casePayload, payload.quoteId);
  if (!selected.quote) {
    return updateOwnerRecommendationMmsCase_(caseId, casePayload, {
      ok: false,
      status: "blocked",
      statusText: "추천할 수 있는 금액 확인 견적이 없습니다."
    });
  }

  const existing = casePayload.ownerRecommendationMms || {};
  const requestKey = caseId + ":" + selected.quoteId;
  if ((existing.ok === true || existing.deliveryAccepted === true) && existing.requestKey === requestKey && payload.force !== true) {
    const normalizedExisting = Object.assign({}, existing, {
      ok: true,
      status: "sent",
      deliveryAccepted: true,
      deliveryConfirmed: true,
      confirmedAt: existing.confirmedAt || new Date().toISOString(),
      statusText: "SENS MMS 발송 완료. ⑨ 승인·입금 단계로 전환했습니다."
    });
    return Object.assign({ skipped: true }, updateOwnerRecommendationMmsCase_(caseId, casePayload, normalizedExisting));
  }

  const ownerPhone = extractOwnerRecommendationPhone_(casePayload);
  const preparedDecision = prepareOwnerDecisionLinkForCase_(caseId, casePayload, selected.quoteId, selected.quote);
  const supplier = preparedDecision.supplier;
  const amounts = preparedDecision.amounts;
  const ownerDecision = preparedDecision.state || {};
  if (!preparedDecision.ok || !ownerDecision.decisionUrl) {
    return updateOwnerRecommendationMmsCase_(caseId, casePayload, {
      ok: false,
      status: "blocked",
      statusText: preparedDecision.message || ownerDecision.linkStatusText || "승인 링크가 열리는지 확인하지 못해 MMS 발송을 보류했습니다.",
      requestKey: requestKey,
      quoteId: selected.quoteId,
      vendorName: supplier.name,
      originalTotalAmount: ownerQuoteOriginalAmount_(selected.quote),
      bringTotalAmount: amounts.totalAmount,
      ownerPhoneMasked: maskPhone_(ownerPhone),
      decisionUrl: ownerDecision.decisionUrl || "",
      decisionStatus: ownerDecision.status || "",
      decisionLinkValidated: false,
      updatedAt: new Date().toISOString()
    });
  }
  const message = appendOwnerDecisionLink_(
    String(payload.message || "").trim() || makeOwnerRecommendationMmsContent_(casePayload, supplier, amounts),
    ownerDecision.decisionUrl
  );
  const baseResult = {
    ok: false,
    status: "failed",
    statusText: "",
    requestKey: requestKey,
    quoteId: selected.quoteId,
    vendorName: supplier.name,
    originalTotalAmount: ownerQuoteOriginalAmount_(selected.quote),
    bringTotalAmount: amounts.totalAmount,
    ownerPhoneMasked: maskPhone_(ownerPhone),
    decisionUrl: ownerDecision.decisionUrl,
    decisionStatus: ownerDecision.status,
    decisionLinkValidated: true,
    updatedAt: new Date().toISOString()
  };

  if (!ownerPhone) {
    baseResult.status = "blocked";
    baseResult.statusText = "온보딩 수집서에서 건물주 연락처를 찾지 못했습니다.";
    return updateOwnerRecommendationMmsCase_(caseId, casePayload, baseResult);
  }

  const config = getSensConfig_();
  if (!config.enabled) {
    baseResult.status = "blocked";
    baseResult.statusText = "NCP SENS 설정 또는 승인된 발신번호가 없어 MMS 발송을 보류했습니다.";
    return updateOwnerRecommendationMmsCase_(caseId, casePayload, baseResult);
  }

  let image = null;
  try {
    const requestedImageId = String(payload.imageFileId || existing.imageFileId || "").trim();
    const requestedImageVersion = String(
      payload.imageDesignVersion || existing.imageDesignVersion ||
      existing.preview && existing.preview.imageDesignVersion || ""
    ).trim();
    if (requestedImageId && requestedImageVersion === OWNER_RECOMMENDATION_IMAGE_VERSION) {
      try {
        const requestedFile = DriveApp.getFileById(requestedImageId);
        image = {
          fileId: requestedFile.getId(),
          fileUrl: requestedFile.getUrl(),
          fileName: requestedFile.getName(),
          file: requestedFile
        };
      } catch (err) {
        Logger.log("건물주 추천 기존 이미지 확인 실패: " + err.message);
      }
    }
    if (!image) image = createOwnerRecommendationImage_(casePayload, selected.quoteId, selected.quote, supplier, amounts);
    const imagePayload = driveImageToMmsPayload_(image.file);
    const upload = uploadSensMmsAttachment_(imagePayload, config);
    if (!upload.ok) {
      baseResult.statusText = upload.message;
      baseResult.imageFileId = image.fileId;
      baseResult.imageFileUrl = image.fileUrl;
      baseResult.imageFileName = image.fileName;
      baseResult.imageDesignVersion = image.imageDesignVersion || OWNER_RECOMMENDATION_IMAGE_VERSION;
      return updateOwnerRecommendationMmsCase_(caseId, casePayload, baseResult);
    }

    baseResult.sensFileId = upload.fileId;
    baseResult.imageFileId = image.fileId;
    baseResult.imageFileUrl = image.fileUrl;
    baseResult.imageFileName = image.fileName;
    baseResult.imageDesignVersion = image.imageDesignVersion || OWNER_RECOMMENDATION_IMAGE_VERSION;
    checkpointOwnerRecommendationMmsCase_(caseId, casePayload, baseResult);

    const send = sendSensMms_(ownerPhone, message, upload.fileId, "건물주", config);
    baseResult.requestId = send.requestId || "";
    baseResult.responseCode = send.responseCode || "";
    baseResult.statusText = send.ok
      ? "SENS MMS 발송 완료. ⑨ 승인·입금 단계로 전환했습니다."
      : send.message;
    baseResult.deliveryAccepted = send.ok === true;
    baseResult.deliveryConfirmed = send.ok === true;
    baseResult.confirmedAt = send.ok ? new Date().toISOString() : "";
    baseResult.ok = send.ok === true;
    baseResult.status = send.ok ? "sent" : "failed";
  } catch (err) {
    baseResult.statusText = "건물주 추천 MMS 처리 실패: " + err.message;
  }

  return updateOwnerRecommendationMmsCase_(caseId, casePayload, baseResult);
}

function selectOwnerRecommendationQuote_(casePayload, requestedQuoteId) {
  const quoteFiles = casePayload && casePayload.quoteFiles && typeof casePayload.quoteFiles === "object"
    ? casePayload.quoteFiles
    : {};
  const candidates = Object.keys(quoteFiles).map(quoteId => {
    const quote = quoteFiles[quoteId] || {};
    return { quoteId: quoteId, quote: quote, amount: ownerQuoteOriginalAmount_(quote) };
  }).filter(item => item.amount >= 1000 && !isBusinessRegistrationLikeQuote_(item.quote));

  const requested = candidates.find(item => item.quoteId === String(requestedQuoteId || ""));
  if (requested) return requested;
  candidates.sort((a, b) => {
    if (a.amount !== b.amount) return a.amount - b.amount;
    const aApplied = a.quote.businessRegistrationAppliedAt ? 1 : 0;
    const bApplied = b.quote.businessRegistrationAppliedAt ? 1 : 0;
    if (aApplied !== bApplied) return bApplied - aApplied;
    return String(a.quote.vendorName || "").localeCompare(String(b.quote.vendorName || ""), "ko");
  });
  return candidates[0] || { quoteId: "", quote: null, amount: 0 };
}

function ownerQuoteOriginalAmount_(quote) {
  quote = quote || {};
  return Math.round(Number(
    quote.confirmedTotalAmount ||
    quote.bringQuoteBaseTotalAmount ||
    quote.totalAmount ||
    parseMoneyValue_(quote.amount) ||
    0
  ));
}

function ownerRecommendationSupplier_(quote) {
  const sources = [quote && quote.resolvedVendorInfo, quote && quote.vendor, quote && quote.extractedVendorInfo, quote || {}];
  const pick = keys => {
    for (const source of sources) {
      if (!source || typeof source !== "object") continue;
      for (const key of keys) {
        const value = String(source[key] || "").trim();
        if (value && !isGenericQuoteVendorValue_(value)) return value;
      }
    }
    return "";
  };
  return {
    name: pick(["name", "vendorName"]) || "업체 확인 필요",
    businessNo: pick(["businessNo", "bizNo", "businessNumber"]),
    ceo: pick(["ceo", "owner", "representative", "representativeName"]),
    address: pick(["address", "addressFromVendorList"]),
    type: pick(["type", "businessType"]),
    category: pick(["category", "businessCategory", "industry"]),
    phone: pick(["phone", "tel", "telephone"]),
    email: pick(["email", "mail"])
  };
}

function ownerRecommendationAmounts_(quote) {
  const base = ownerQuoteOriginalAmount_(quote);
  const calculated = calculateBringQuoteAmounts_(base);
  const total = Number(quote && quote.bringQuoteTotalAmount || calculated.totalAmount || 0);
  const supply = Number(quote && quote.bringQuoteSupplyAmount || calculated.supplyAmount || (total ? Math.round(total / 1.1) : 0));
  const vat = Number(quote && quote.bringQuoteVatAmount || calculated.vatAmount || (total ? total - supply : 0));
  return { baseTotalAmount: base, supplyAmount: supply, vatAmount: vat, totalAmount: total };
}

function ownerRecommendationAmountText_(amount) {
  return Number(amount || 0) ? Number(amount).toLocaleString("ko-KR") + "원" : "금액 미입력";
}

function makeOwnerRecommendationMmsContent_(casePayload, supplier, amounts) {
  return [
    "[BRING Care 추천 견적 안내]",
    "",
    "안녕하세요. BRING Care입니다.",
    "추천 업체: " + (supplier.name || "업체 확인 필요"),
    "추천 금액: " + ownerRecommendationAmountText_(amounts.totalAmount),
    "",
    "첨부된 브링 견적서를 확인해 주세요.",
    "추천 견적으로 진행을 원하시면 문자 하단의 승인 링크에서",
    "'승인하고 입금 진행' 버튼을 눌러주세요.",
    "접수번호: " + (casePayload.ticketNo || casePayload.id || "")
  ].join("\n");
}

function extractOwnerRecommendationPhone_(casePayload) {
  const direct = [casePayload && casePayload.ownerPhone, casePayload && casePayload.ownerContact,
    casePayload && casePayload.owner && casePayload.owner.phone].filter(Boolean).join(" ");
  const directPhone = extractPhones_(direct).find(phone => isSendableSmsPhone_(phone));
  if (directPhone) return directPhone;
  const contractMatch = casePayload && casePayload.contractMatch || {};
  const onboardingPhone = normalizePhoneForSms_(extractOwnerPhoneFromOnboarding_(contractMatch));
  return isSendableSmsPhone_(onboardingPhone) ? onboardingPhone : "";
}

function ownerRecommendationWorkLines_(quote) {
  const items = Array.isArray(quote && quote.bringQuoteItems) && quote.bringQuoteItems.length
    ? quote.bringQuoteItems
    : (Array.isArray(quote && quote.extractedItems) ? quote.extractedItems : []);
  const names = items.map(item => String(
    item && (item.product || item.name || item.itemName || item.description || item.title) || ""
  ).trim()).filter(Boolean);
  if (!names.length) return ["현장 확인 및 작업 견적"];
  const lines = names.slice(0, 4);
  if (names.length > 4) lines.push("외 " + String(names.length - 4) + "건");
  return lines;
}

function workflowStatusRank_(value) {
  if (value === "done") return 2;
  if (value === "doing") return 1;
  return 0;
}

function promoteWorkflowStatus_(status, key, value) {
  status = status || {};
  if (workflowStatusRank_(value) > workflowStatusRank_(status[key])) status[key] = value;
  return status;
}

function receiptSmsWorkflowComplete_(casePayload) {
  const candidates = [
    casePayload && casePayload.complaintReceiptSms,
    casePayload && casePayload.sms,
    casePayload && casePayload.automationState && casePayload.automationState.receiptSms
  ];
  return candidates.some(item => item && (
    item.ok === true || item.deliveryAccepted === true || isSmsCompleteStatus_(item.status)
  ));
}

function vendorMmsWorkflowComplete_(casePayload) {
  const candidates = [
    casePayload && casePayload.vendorEstimateMms,
    casePayload && casePayload.automationState && casePayload.automationState.vendorEstimateMms
  ];
  return candidates.some(item => item && item.ok === true && (item.status === "sent" || item.deliveryAccepted === true || (item.sent || []).length > 0));
}

function ownerMmsWorkflowComplete_(casePayload) {
  const candidates = [
    casePayload && casePayload.ownerRecommendationMms,
    casePayload && casePayload.automationState && casePayload.automationState.ownerRecommendationMms
  ];
  return candidates.some(item => item && (
    item.deliveryConfirmed === true || item.deliveryAccepted === true || (item.ok === true && item.status === "sent")
  ));
}

function workflowPricedQuote_(casePayload) {
  const selected = selectOwnerRecommendationQuote_(casePayload || {}, "");
  return selected && selected.quote && Number(selected.amount || 0) >= 1000 ? selected : null;
}

function workflowStepState_(automationState, key, status, now, extra) {
  automationState.workflow = Object.assign({}, automationState.workflow || {});
  const current = Object.assign({}, automationState.workflow[key] || {}, extra || {});
  current.status = status;
  current.updatedAt = now;
  if (status === "done" && !current.completedAt) current.completedAt = now;
  automationState.workflow[key] = current;
}

function recordUploadBatchProgress_(caseId, payload) {
  const batchId = String(payload && payload.uploadBatchId || "").trim();
  if (!batchId) return;
  const casePayload = readCaseFromFirebase_(caseId) || {};
  const automationState = Object.assign({}, casePayload.automationState || {});
  automationState.uploadBatch = Object.assign({}, automationState.uploadBatch || {}, {
    id: batchId,
    processed: Number(payload.uploadBatchIndex || 0),
    total: Number(payload.uploadBatchTotal || 0),
    complete: payload.uploadBatchComplete === true,
    updatedAt: new Date().toISOString()
  });
  if (payload.uploadBatchComplete === true) automationState.uploadBatch.completedAt = automationState.uploadBatch.completedAt || new Date().toISOString();
  patchCaseChildToFirebase_(caseId, "automationState", automationState);
}

/**
 * 서버에서만 단계 상태를 올리는 중앙 진행 함수.
 * 완료 상태는 절대 낮추지 않으며 status/cN 경로만 부분 업데이트한다.
 */
function advanceCaseWorkflow_(caseId, context) {
  context = context || {};
  const casePayload = readCaseFromFirebase_(caseId);
  if (!casePayload) return { ok: false, message: "Firebase 케이스를 찾지 못했습니다: " + caseId };
  if (casePayload.deleted === true) return { ok: false, skipped: true, message: "삭제된 케이스는 자동 진행하지 않습니다: " + caseId };

  const now = new Date().toISOString();
  const before = Object.assign({}, casePayload.status || {});
  const status = Object.assign({}, before);
  const automationState = Object.assign({}, casePayload.automationState || {});
  let pricedQuote = null;
  let ownerDecisionPreparation = null;
  const match = casePayload.contractMatch || {};
  const matched = match.status === "matched";

  if (!matched) {
    promoteWorkflowStatus_(status, "c1", "doing");
    workflowStepState_(automationState, "c1", "doing", now, { reason: match.statusText || "온보딩 매칭 대기" });
  } else {
    promoteWorkflowStatus_(status, "c1", "done");
    promoteWorkflowStatus_(status, "c2", "doing");
    workflowStepState_(automationState, "c1", "done", now, {
      matchKey: match.matchKey || "",
      driveFileId: match.driveFileId || "",
      matchLevel: match.matchLevel || ""
    });
    workflowStepState_(automationState, "c2", "doing", now, {
      retryState: "waiting_or_processing"
    });

    if (receiptSmsWorkflowComplete_(casePayload)) {
      ["c2", "c3", "c4"].forEach(key => promoteWorkflowStatus_(status, key, "done"));
      promoteWorkflowStatus_(status, "c5", "doing");
      workflowStepState_(automationState, "c2", "done", now, {
        tenantRequestId: casePayload.sms && casePayload.sms.tenantRequestId || "",
        ownerRequestId: casePayload.sms && casePayload.sms.ownerRequestId || "",
        retryState: "completed"
      });
      workflowStepState_(automationState, "c3", "done", now, { mode: "rules" });
      workflowStepState_(automationState, "c4", "done", now, { vendorType: casePayload.vendorType || "" });
      workflowStepState_(automationState, "c5", "doing", now, { mode: "manual_vendor_selection" });
    }

    if (vendorMmsWorkflowComplete_(casePayload)) {
      promoteWorkflowStatus_(status, "c5", "done");
      promoteWorkflowStatus_(status, "c6", "doing");
      workflowStepState_(automationState, "c5", "done", now, {
        requestKey: casePayload.vendorEstimateMms && casePayload.vendorEstimateMms.requestKey || ""
      });
      workflowStepState_(automationState, "c6", "doing", now, { mode: "manual_document_upload" });
    }

    const batchComplete = context.uploadBatchComplete === true || (!context.uploadBatchId && context.source !== "quote_upload" && context.source !== "business_registration_upload");
    pricedQuote = workflowPricedQuote_(casePayload);
    if (status.c5 === "done" && pricedQuote && batchComplete) {
      promoteWorkflowStatus_(status, "c6", "done");
      promoteWorkflowStatus_(status, "c7", "done");
      promoteWorkflowStatus_(status, "c8", "doing");
      workflowStepState_(automationState, "c6", "done", now, { pricedQuoteCount: Object.keys(casePayload.quoteFiles || {}).length });
      workflowStepState_(automationState, "c7", "done", now, {
        quoteId: pricedQuote.quoteId,
        vendorName: ownerRecommendationSupplier_(pricedQuote.quote).name,
        originalTotalAmount: pricedQuote.amount,
        criterion: "lowest_original_amount"
      });
      workflowStepState_(automationState, "c8", "doing", now, { mode: "automatic_owner_mms" });
      if (status.c8 === "doing" && !ownerMmsWorkflowComplete_(casePayload)) {
        ownerDecisionPreparation = prepareOwnerDecisionLinkForCase_(
          caseId,
          casePayload,
          pricedQuote.quoteId,
          pricedQuote.quote
        );
        workflowStepState_(automationState, "c8", "doing", now, {
          mode: "automatic_owner_mms",
          decisionLinkStatus: ownerDecisionPreparation.ok ? "ready" : "failed",
          decisionUrl: ownerDecisionPreparation.state && ownerDecisionPreparation.state.decisionUrl || "",
          decisionLinkMessage: ownerDecisionPreparation.message || ""
        });
      }
    }

    if (ownerMmsWorkflowComplete_(casePayload)) {
      promoteWorkflowStatus_(status, "c8", "done");
      promoteWorkflowStatus_(status, "c9", "doing");
      workflowStepState_(automationState, "c8", "done", now, {
        requestId: casePayload.ownerRecommendationMms && casePayload.ownerRecommendationMms.requestId || ""
      });
      workflowStepState_(automationState, "c9", "doing", now, { mode: "manual_approval_payment" });
    }
  }

  const statusPatch = {};
  Object.keys(status).forEach(key => {
    if (status[key] !== before[key]) statusPatch[key] = status[key];
  });
  if (Object.keys(statusPatch).length) patchCaseChildToFirebase_(caseId, "status", statusPatch);
  patchCaseChildToFirebase_(caseId, "automationState", automationState);
  patchCaseToFirebase_(caseId, { updatedAt: now });

  const shouldSendOwner = matched && status.c7 === "done" && status.c8 === "doing" && !ownerMmsWorkflowComplete_(casePayload);
  if (shouldSendOwner && context.skipOwnerAutoSend !== true) {
    const priced = pricedQuote || workflowPricedQuote_(readCaseFromFirebase_(caseId) || {});
    if (priced) {
      const latestCase = readCaseFromFirebase_(caseId) || casePayload;
      const prepared = ownerDecisionPreparation || prepareOwnerDecisionLinkForCase_(
        caseId,
        latestCase,
        priced.quoteId,
        priced.quote
      );
      if (!prepared.ok) {
        return {
          ok: false,
          status: status,
          ownerDecisionPreparation: {
            ok: false,
            decisionUrl: prepared.state && prepared.state.decisionUrl || "",
            message: prepared.message || prepared.state && prepared.state.linkStatusText || "승인 링크 확인 실패"
          }
        };
      }
      const ownerResult = handleOwnerRecommendationMms_({ caseId: caseId, quoteId: priced.quoteId });
      return { ok: ownerResult && ownerResult.ok === true, status: status, ownerResult: ownerResult };
    }
  }
  return { ok: true, status: status };
}

function ownerRecommendationVisitTime_(casePayload) {
  const source = casePayload || {};
  return formatKoreanDateTimeForCase_(
    source.visitTime || "",
    source.visitDate || source.receivedAt || source.createdAt || ""
  ) || "미입력";
}

function ownerRecommendationWrapText_(value, maxChars) {
  const text = String(value || "").trim() || "미입력";
  const lines = [];
  text.split(/\n/).forEach(part => {
    let rest = part.trim() || "미입력";
    while (rest.length > maxChars) {
      lines.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
    }
    lines.push(rest);
  });
  return lines.join("\n");
}

function createOwnerRecommendationImage_(casePayload, quoteId, quote, supplier, amounts) {
  const date = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd_HHmmss");
  const fileName = safeDriveName_((casePayload.ticketNo || casePayload.id || "case") + "_" + (supplier.name || "업체확인필요") + "_" + date + "_브링추천견적.jpg");
  const folder = getOrCreateChildFolder_(getQuoteDriveFolder_(casePayload), "건물주 추천 발송");
  let file = null;
  let tempSpreadsheetFile = null;
  let tempPdfFile = null;
  try {
    const spreadsheet = SpreadsheetApp.create("BRING 추천 견적 이미지 임시 파일");
    tempSpreadsheetFile = DriveApp.getFileById(spreadsheet.getId());
    buildOwnerRecommendationSheet_(spreadsheet, casePayload, quote, supplier, amounts);
    const pdfBlob = exportOwnerRecommendationSheetPdf_(spreadsheet);
    tempPdfFile = folder.createFile(pdfBlob.setName(fileName.replace(/\.jpg$/i, ".pdf")));
    const rendered = renderDriveImageFile_(tempPdfFile.getId(), fileName);
    file = folder.createFile(rendered);
  } catch (err) {
    Logger.log("추천 견적 한글 이미지 생성 실패, 기본 이미지로 대체: " + err.message);
    file = createOwnerRecommendationFallbackImage_(folder, fileName, casePayload, quote, supplier, amounts);
  } finally {
    try { if (tempPdfFile) tempPdfFile.setTrashed(true); } catch (err) {}
    try { if (tempSpreadsheetFile) tempSpreadsheetFile.setTrashed(true); } catch (err) {}
  }
  return {
    file: file,
    fileId: file.getId(),
    fileUrl: file.getUrl(),
    fileName: file.getName(),
    quoteId: quoteId,
    imageDesignVersion: OWNER_RECOMMENDATION_IMAGE_VERSION
  };
}

function buildOwnerRecommendationSheet_(spreadsheet, casePayload, quote, supplier, amounts) {
  const sheet = spreadsheet.getSheets()[0];
  sheet.setName("추천 견적");
  sheet.clear();
  sheet.setHiddenGridlines(true);
  const font = "Noto Sans KR";
  const all = sheet.getRange("A1:H19");
  all.setBackground("#f3f6fb").setFontFamily(font).setFontColor("#17233a").setVerticalAlignment("middle");
  [56, 118, 118, 92, 92, 108, 108, 56].forEach((width, index) => sheet.setColumnWidth(index + 1, width));
  sheet.setRowHeights(1, 19, 38);
  sheet.setRowHeights(1, 2, 54);
  sheet.setRowHeight(3, 34);
  sheet.setRowHeights(4, 3, 55);
  sheet.setRowHeights(7, 3, 46);
  sheet.setRowHeight(10, 42);
  sheet.setRowHeights(11, 5, 42);
  sheet.setRowHeights(16, 3, 48);
  sheet.setRowHeight(19, 32);

  sheet.getRange("A1:H2").merge().setValue("BRING Care 추천 견적서")
    .setBackground("#17386f").setFontColor("#ffffff").setFontSize(28).setFontWeight("bold")
    .setHorizontalAlignment("left").setWrap(true);
  sheet.getRange("A3:H3").merge().setValue("검토를 마친 추천 견적 요약입니다")
    .setBackground("#17386f").setFontColor("#cfe0ff").setFontSize(14).setFontWeight("bold")
    .setHorizontalAlignment("left");

  sheet.getRange("A4:C6").merge().setValue("최종 합계금액")
    .setBackground("#e1edff").setFontColor("#52606d").setFontSize(16).setFontWeight("bold")
    .setHorizontalAlignment("left").setBorder(true, true, true, false, false, false, "#aac8f3", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sheet.getRange("D4:H6").merge().setValue(ownerRecommendationAmountText_(amounts.totalAmount))
    .setBackground("#e1edff").setFontColor("#12346b").setFontSize(34).setFontWeight("bold")
    .setHorizontalAlignment("right").setBorder(true, false, true, true, false, false, "#aac8f3", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  ownerRecommendationSheetCard_(sheet, "A7:D7", "A8:D9", "추천 업체", supplier.name || "업체 확인 필요");
  ownerRecommendationSheetCard_(sheet, "E7:H7", "E8:H9", "방문 가능 시간", ownerRecommendationVisitTime_(casePayload));

  sheet.getRange("A10:H10").merge().setValue("작업 내용")
    .setBackground("#ffffff").setFontColor("#52606d").setFontSize(16).setFontWeight("bold")
    .setHorizontalAlignment("left").setBorder(true, true, false, true, false, false, "#d7e0ed", SpreadsheetApp.BorderStyle.SOLID);
  const workLines = ownerRecommendationWorkLines_(quote);
  for (let row = 11; row <= 15; row++) {
    const value = workLines[row - 11] ? "• " + workLines[row - 11] : "";
    sheet.getRange("A" + row + ":H" + row).merge().setValue(value)
      .setBackground("#ffffff").setFontSize(17).setFontWeight("bold").setHorizontalAlignment("left")
      .setWrap(true).setBorder(false, true, row === 15, true, false, false, "#d7e0ed", SpreadsheetApp.BorderStyle.SOLID);
  }

  ownerRecommendationSheetMoney_(sheet, "A16:D16", "A17:D18", "공급가액", amounts.supplyAmount);
  ownerRecommendationSheetMoney_(sheet, "E16:H16", "E17:H18", "부가세", amounts.vatAmount);
  sheet.getRange("A19:H19").merge().setValue("BRING Care · 건물 유지보수 추천 견적")
    .setFontColor("#7b8798").setFontSize(11).setFontWeight("bold").setHorizontalAlignment("center");
  SpreadsheetApp.flush();
}

function ownerRecommendationSheetCard_(sheet, labelRange, valueRange, label, value) {
  sheet.getRange(labelRange).merge().setValue(label)
    .setBackground("#ffffff").setFontColor("#52606d").setFontSize(14).setFontWeight("bold")
    .setHorizontalAlignment("left").setBorder(true, true, false, true, false, false, "#d7e0ed", SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange(valueRange).merge().setValue(String(value || "미입력"))
    .setBackground("#ffffff").setFontColor("#17233a").setFontSize(18).setFontWeight("bold")
    .setHorizontalAlignment("left").setWrap(true).setBorder(false, true, true, true, false, false, "#d7e0ed", SpreadsheetApp.BorderStyle.SOLID);
}

function ownerRecommendationSheetMoney_(sheet, labelRange, valueRange, label, amount) {
  sheet.getRange(labelRange).merge().setValue(label)
    .setBackground("#ffffff").setFontColor("#52606d").setFontSize(14).setFontWeight("bold")
    .setHorizontalAlignment("left").setBorder(true, true, false, true, false, false, "#d7e0ed", SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange(valueRange).merge().setValue(ownerRecommendationAmountText_(amount))
    .setBackground("#ffffff").setFontColor("#17233a").setFontSize(24).setFontWeight("bold")
    .setHorizontalAlignment("right").setBorder(false, true, true, true, false, false, "#d7e0ed", SpreadsheetApp.BorderStyle.SOLID);
}

function exportOwnerRecommendationSheetPdf_(spreadsheet) {
  SpreadsheetApp.flush();
  Utilities.sleep(250);
  const sheet = spreadsheet.getSheets()[0];
  const params = [
    "format=pdf", "size=letter", "portrait=true", "scale=4", "sheetnames=false", "printtitle=false",
    "pagenumbers=false", "gridlines=false", "fzr=false", "top_margin=0.20", "bottom_margin=0.20",
    "left_margin=0.20", "right_margin=0.20", "gid=" + sheet.getSheetId(), "range=A1:H19"
  ].join("&");
  const response = UrlFetchApp.fetch("https://docs.google.com/spreadsheets/d/" + spreadsheet.getId() + "/export?" + params, {
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
    followRedirects: true
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error("추천 견적 PDF 생성 실패: HTTP " + response.getResponseCode());
  }
  return response.getBlob().getAs("application/pdf");
}

function renderDriveImageFile_(fileId, outputName) {
  const headers = { Authorization: "Bearer " + ScriptApp.getOAuthToken() };
  const fallbackUrl = "https://drive.google.com/thumbnail?id=" + encodeURIComponent(fileId) + "&sz=w1600-h1600";
  for (let attempt = 0; attempt < 8; attempt++) {
    const urls = [];
    try {
      const metadata = Drive.Files.get(fileId, { fields: "thumbnailLink" });
      if (metadata && metadata.thumbnailLink) {
        urls.push(String(metadata.thumbnailLink).replace(/=s\d+$/, "=s1600"));
      }
    } catch (err) {
      Logger.log("추천 PDF 썸네일 링크 확인 실패: " + err.message);
    }
    urls.push(fallbackUrl + "&retry=" + attempt);
    for (let index = 0; index < urls.length; index++) {
      try {
        const response = UrlFetchApp.fetch(urls[index], { headers: headers, muteHttpExceptions: true, followRedirects: true });
        const responseHeaders = response.getHeaders();
        const type = String(responseHeaders["Content-Type"] || responseHeaders["content-type"] || response.getBlob().getContentType() || "").toLowerCase();
        if (response.getResponseCode() >= 200 && response.getResponseCode() < 300 && type.indexOf("image/") === 0) {
          const blob = response.getBlob().getAs("image/jpeg");
          blob.setName(outputName);
          return blob;
        }
      } catch (err) {
        Logger.log("추천 PDF 이미지 변환 시도 실패: " + err.message);
      }
    }
    Utilities.sleep(500);
  }
  throw new Error("한글 추천 견적 이미지를 렌더링하지 못했습니다.");
}

function createOwnerRecommendationFallbackImage_(folder, fileName, casePayload, quote, supplier, amounts) {
  const rows = [
    ["최종 합계금액", ownerRecommendationAmountText_(amounts.totalAmount)],
    ["추천 업체", ownerRecommendationWrapText_(supplier.name || "업체 확인 필요", 28)],
    ["방문 가능 시간", ownerRecommendationWrapText_(ownerRecommendationVisitTime_(casePayload), 32)]
  ];
  ownerRecommendationWorkLines_(quote).forEach((line, index) => rows.push([
    index === 0 ? "작업 내용" : "",
    ownerRecommendationWrapText_(line, 32)
  ]));
  rows.push(
    ["공급가액", ownerRecommendationAmountText_(amounts.supplyAmount)],
    ["부가세", ownerRecommendationAmountText_(amounts.vatAmount)]
  );
  const table = Charts.newDataTable()
    .addColumn(Charts.ColumnType.STRING, "항목")
    .addColumn(Charts.ColumnType.STRING, "내용");
  rows.forEach(row => table.addRow(row));
  const chart = Charts.newTableChart()
    .setDataTable(table)
    .setDimensions(800, 1000)
    .setOption("page", "disable")
    .setOption("alternatingRowStyle", false)
    .setOption("showRowNumber", false)
    .build();
  let blob = chart.getAs("image/png");
  try { blob = blob.getAs("image/jpeg"); } catch (err) {}
  blob.setName(fileName);
  return folder.createFile(blob);
}

function driveImageToMmsPayload_(file) {
  if (!file) throw new Error("건물주 추천 이미지 파일이 없습니다.");
  const thumbnail = makeOwnerRecommendationMmsBlob_(file.getId(), file.getName());
  if (!thumbnail || !thumbnail.blob) {
    throw new Error("추천 이미지를 MMS 허용 해상도(최대 800px)로 축소하지 못했습니다.");
  }
  const blob = thumbnail.blob;
  const bytes = blob.getBytes();
  if (bytes.length > 300 * 1024) throw new Error("생성된 추천 이미지가 SENS MMS 첨부 제한 300KB를 초과했습니다.");
  return {
    fileName: thumbnail.name || makeSensImageName_(file.getName()),
    fileBody: Utilities.base64Encode(bytes),
    byteSize: bytes.length
  };
}

function makeOwnerRecommendationMmsBlob_(fileId, originalName) {
  try {
    const metadata = Drive.Files.get(fileId, { fields: "thumbnailLink,name" });
    const thumbnailLink = String(metadata && metadata.thumbnailLink || "").trim();
    const thumbnailLinks = [
      thumbnailLink,
      "https://drive.google.com/thumbnail?id=" + encodeURIComponent(fileId) + "&sz=w800-h800"
    ].filter(Boolean);
    const sizes = [800, 720, 640, 560, 480];
    const requestOptions = [
      { method: "get", headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }, muteHttpExceptions: true, followRedirects: true },
      { method: "get", muteHttpExceptions: true, followRedirects: true }
    ];
    for (const size of sizes) {
      for (const baseUrl of thumbnailLinks) {
        let url = baseUrl;
        if (/=s\d+/.test(url)) url = url.replace(/=s\d+[^&]*/, "=s" + size);
        else if (/sz=w\d+-h\d+/.test(url)) url = url.replace(/sz=w\d+-h\d+/, "sz=w" + size + "-h" + size);
        for (const options of requestOptions) {
          const response = UrlFetchApp.fetch(url, options);
          if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) continue;
          const source = response.getBlob();
          const type = String(source.getContentType() || "").toLowerCase();
          if (type.indexOf("image/") !== 0) continue;
          let blob = source;
          try { blob = source.getAs("image/jpeg"); } catch (err) { continue; }
          if (blob.getBytes().length <= 300 * 1024) {
            blob.setName(makeSensImageName_(originalName));
            return { blob: blob, name: blob.getName(), maxDimension: size };
          }
        }
      }
    }
  } catch (err) {
    Logger.log("추천 견적 MMS 이미지 축소 실패: " + err.message);
  }
  return null;
}

function updateOwnerRecommendationMmsCase_(caseId, casePayload, result) {
  const timestamp = new Date().toISOString();
  result = result || {};
  const previousResult = casePayload.ownerRecommendationMms || {};
  if (!result.preview && previousResult.preview) result.preview = previousResult.preview;
  const deliveryAccepted = result.deliveryAccepted === true || result.status === "sent_pending_confirmation";
  const deliveryConfirmed = deliveryAccepted || result.deliveryConfirmed === true || (result.ok === true && result.status === "sent");
  if (deliveryConfirmed) {
    result.ok = true;
    result.status = "sent";
    result.deliveryAccepted = true;
    result.deliveryConfirmed = true;
    result.confirmedAt = result.confirmedAt || timestamp;
  }
  result.updatedAt = timestamp;
  casePayload.status = casePayload.status || {};
  casePayload.note = casePayload.note || {};
  casePayload.log = Array.isArray(casePayload.log) ? casePayload.log : [];
  casePayload.ownerRecommendationMms = result;
  casePayload.status.c8 = deliveryConfirmed ? "done" : "doing";
  if (deliveryConfirmed && casePayload.status.c9 !== "done") casePayload.status.c9 = "doing";
  casePayload.note.c8 = makeOwnerRecommendationMmsNote_(result);
  casePayload.log.unshift("건물주 추천 MMS " + (result.ok ? "발송완료" : "발송보류") + " / " + (result.statusText || ""));
  if (casePayload.log.length > 30) casePayload.log.length = 30;
  putCaseChildToFirebase_(caseId, "ownerRecommendationMms", result);
  patchCaseChildToFirebase_(caseId, "status", {
    c8: casePayload.status.c8,
    c9: casePayload.status.c9 || null
  });
  patchCaseChildToFirebase_(caseId, "note", { c8: casePayload.note.c8 });
  putCaseChildToFirebase_(caseId, "recommendation", {
    quoteId: result.quoteId || "",
    vendorName: result.vendorName || "",
    selectionAmount: result.originalTotalAmount || 0,
    criterion: "lowest_original_amount",
    updatedAt: timestamp
  });
  patchCaseToFirebase_(caseId, { log: casePayload.log, updatedAt: timestamp });
  if (deliveryConfirmed) {
    const automationState = Object.assign({}, casePayload.automationState || {});
    automationState.ownerRecommendationMms = {
      ok: true,
      status: "sent",
      deliveryAccepted: true,
      deliveryConfirmed: true,
      requestId: result.requestId || "",
      requestKey: result.requestKey || "",
      quoteId: result.quoteId || "",
      vendorName: result.vendorName || "",
      originalTotalAmount: result.originalTotalAmount || 0,
      bringTotalAmount: result.bringTotalAmount || 0,
      ownerPhoneMasked: result.ownerPhoneMasked || "",
      imageFileId: result.imageFileId || "",
      imageFileUrl: result.imageFileUrl || "",
      imageFileName: result.imageFileName || "",
      statusText: result.statusText || "SENS MMS 발송 완료",
      confirmedAt: result.confirmedAt || timestamp,
      updatedAt: timestamp,
      build: AUTOMATION_BUILD
    };
    patchCaseChildToFirebase_(caseId, "automationState", automationState);
  }
  const workflow = advanceCaseWorkflow_(caseId, { source: "owner_mms", skipOwnerAutoSend: true });
  return Object.assign({ caseId: caseId, workflow: workflow }, result);
}

function checkpointOwnerRecommendationMmsCase_(caseId, casePayload, result) {
  const timestamp = new Date().toISOString();
  const previousResult = casePayload.ownerRecommendationMms || {};
  const checkpoint = Object.assign({}, result, {
    ok: false,
    status: "sending",
    statusText: "SENS MMS 발송 요청을 처리하고 있습니다.",
    deliveryAccepted: false,
    deliveryConfirmed: false,
    sendAttemptedAt: timestamp,
    updatedAt: timestamp
  });
  if (!checkpoint.preview && previousResult.preview) checkpoint.preview = previousResult.preview;

  casePayload.status = casePayload.status || {};
  casePayload.note = casePayload.note || {};
  casePayload.status.c8 = "doing";
  casePayload.note.c8 = "건물주 추천 MMS 발송을 처리하고 있습니다.";
  casePayload.ownerRecommendationMms = checkpoint;

  putCaseChildToFirebase_(caseId, "ownerRecommendationMms", checkpoint);
  patchCaseChildToFirebase_(caseId, "status", { c8: "doing" });
  patchCaseChildToFirebase_(caseId, "note", { c8: casePayload.note.c8 });
  patchCaseToFirebase_(caseId, { updatedAt: timestamp });
  return checkpoint;
}

function patchOwnerRecommendationCaseWithRetry_(caseId, patch) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      patchCaseToFirebase_(caseId, patch);
      return;
    } catch (err) {
      lastError = err;
      Logger.log("건물주 추천 MMS Firebase 저장 재시도 " + attempt + "/3: " + err.message);
      if (attempt < 3) Utilities.sleep(attempt * 500);
    }
  }
  throw lastError || new Error("건물주 추천 MMS Firebase 저장 실패");
}

function makeOwnerRecommendationMmsNote_(result) {
  const deliveryConfirmed = result.deliveryConfirmed === true || (result.ok === true && result.status === "sent");
  const deliveryAccepted = result.deliveryAccepted === true || result.status === "sent_pending_confirmation";
  const lines = [
    "[건물주 추천 MMS]",
    "상태: " + (deliveryConfirmed ? "발송완료" : deliveryAccepted ? "발송 요청 완료 · 수신 확인 필요" : "진행중/보류"),
    result.statusText || "",
    result.vendorName ? "추천 업체: " + result.vendorName : "",
    result.bringTotalAmount ? "브링 추천금액: " + ownerRecommendationAmountText_(result.bringTotalAmount) : "",
    result.ownerPhoneMasked ? "건물주 연락처: " + result.ownerPhoneMasked : "",
    result.imageFileUrl ? "첨부 이미지: " + result.imageFileUrl : "",
    result.ok ? "다음 단계: ⑨ 승인·입금 진행중" : ""
  ];
  return lines.filter(Boolean).join("\n");
}

function readCaseFromFirebase_(caseId) {
  const response = UrlFetchApp.fetch(firebaseCaseUrl_(caseId), {
    method: "get",
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  if (code === 404) return null;
  if (code < 200 || code >= 300) {
    throw new Error("Firebase 조회 실패: HTTP " + code + " / " + response.getContentText());
  }
  const body = response.getContentText();
  return body && body !== "null" ? JSON.parse(body) : null;
}

function readResponseRecordForCase_(casePayload) {
  const row = Number(casePayload && casePayload.sheetRow);
  if (!row || row < 2) return {};
  const sheet = getResponseSheet_();
  const headers = ensureOutputHeaders_(sheet);
  const values = sheet.getRange(row, 1, 1, headers.length).getValues()[0];
  return recordFromRow_(headers, values);
}

function firstJpegPhotoFromRecord_(record) {
  const photoValue = readField_(record, ["사진 첨부", "첨부 사진", "사진", "사진첨부"]);
  if (!photoValue) return { ok: false, message: "구글폼 사진 첨부가 없어 MMS 발송을 보류했습니다." };

  const ids = extractDriveFileIdsFromText_(photoValue);
  if (!ids.length) return { ok: false, message: "사진 첨부에서 Drive 파일 ID를 찾지 못했습니다." };

  const errors = [];
  for (const id of ids) {
    try {
      const file = DriveApp.getFileById(id);
      const blob = file.getBlob();
      const name = file.getName() || "photo.jpg";
      const contentType = blob.getContentType() || "";
      const isJpeg = /jpe?g$/i.test(name) || /jpeg/i.test(contentType);
      if (!isJpeg) {
        errors.push(name + ": JPG/JPEG 파일이 아님");
        continue;
      }

      const originalBytes = blob.getBytes();
      const thumbnail = originalBytes.length > 300 * 1024 ? makeSensThumbnailBlob_(id, name) : null;
      const bytes = thumbnail ? thumbnail.blob.getBytes() : originalBytes;
      const outputName = thumbnail ? thumbnail.name : makeSensImageName_(name);
      if (bytes.length > 300 * 1024) {
        errors.push(name + ": SENS MMS 첨부 제한 300KB 초과");
        continue;
      }

      return {
        ok: true,
        driveFileId: id,
        fileName: outputName,
        fileBody: Utilities.base64Encode(bytes),
        byteSize: bytes.length
      };
    } catch (err) {
      errors.push(id + ": " + err.message);
    }
  }

  return { ok: false, message: "MMS로 보낼 수 있는 JPG/JPEG 사진을 찾지 못했습니다. " + errors.join(" / ") };
}

function makeSensThumbnailBlob_(fileId, originalName) {
  try {
    // DriveApp's thumbnail is a reliable fallback when the Advanced Drive
    // Service does not expose a usable thumbnailLink for a form upload.
    const driveFile = DriveApp.getFileById(fileId);
    const directThumbnail = driveFile.getThumbnail();
    if (directThumbnail) {
      const directType = String(directThumbnail.getContentType() || "").toLowerCase();
      const directBytes = directThumbnail.getBytes();
      if (directBytes.length <= 300 * 1024 && /jpe?g/.test(directType)) {
        return { blob: directThumbnail, name: makeSensImageName_(originalName) };
      }
    }

    if (typeof Drive === "undefined" || !Drive.Files || !Drive.Files.get) return null;
    const metadata = Drive.Files.get(fileId, { fields: "thumbnailLink,name" });
    const thumbnailLink = String(metadata && metadata.thumbnailLink || "").trim();
    const thumbnailLinks = [
      thumbnailLink,
      "https://drive.google.com/thumbnail?id=" + encodeURIComponent(fileId) + "&sz=w800-h800"
    ].filter(Boolean);
    if (!thumbnailLinks.length) return null;

    const sizes = [640, 480, 360, 240, 180, 120];
    for (const size of sizes) {
      for (const baseUrl of thumbnailLinks) {
        let url = baseUrl;
        if (/=s\d+$/.test(url)) url = url.replace(/=s\d+$/, "=s" + size);
        else if (/sz=w\d+-h\d+/.test(url)) url = url.replace(/sz=w\d+-h\d+/, "sz=w" + size + "-h" + size);
        const requestOptions = [
          { method: "get", headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }, muteHttpExceptions: true },
          { method: "get", muteHttpExceptions: true }
        ];
        for (const options of requestOptions) {
          const response = UrlFetchApp.fetch(url, options);
          const code = response.getResponseCode();
          if (code < 200 || code >= 300) continue;
          const blob = response.getBlob();
          const contentType = String(blob.getContentType() || "").toLowerCase();
          if (contentType && contentType.indexOf("jpeg") < 0 && contentType.indexOf("jpg") < 0) continue;
          if (blob.getBytes().length <= 300 * 1024) {
            return { blob: blob, name: makeSensImageName_(originalName) };
          }
        }
      }
    }
  } catch (err) {
    Logger.log("SENS MMS photo resize failed: " + err.message);
  }
  return null;
}

function extractDriveFileIdsFromText_(value) {
  const text = String(value || "");
  const ids = [];
  const patterns = [
    /\/d\/([A-Za-z0-9_-]{20,})/g,
    /[?&]id=([A-Za-z0-9_-]{20,})/g,
    /open\?id=([A-Za-z0-9_-]{20,})/g
  ];
  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(text)) !== null) ids.push(match[1]);
  });
  const generic = text.match(/[A-Za-z0-9_-]{25,}/g) || [];
  generic.forEach(id => ids.push(id));
  return [...new Set(ids)];
}

function makeSensImageName_(name) {
  const ext = /\.jpeg$/i.test(name) ? ".jpeg" : ".jpg";
  return ("bring_photo_" + Utilities.formatDate(new Date(), "Asia/Seoul", "MMddHHmmss")).slice(0, 40 - ext.length) + ext;
}

function uploadSensMmsAttachment_(photo, config) {
  const uri = "/sms/v2/services/" + encodeURIComponent(config.serviceId) + "/files";
  const response = sensPostJson_(uri, {
    fileName: photo.fileName,
    fileBody: photo.fileBody
  }, config);

  if (!response.ok) return { ok: false, message: "MMS 사진 업로드 실패: " + response.message };

  const fileId = findSensFileId_(response.json);
  if (!fileId) return { ok: false, message: "MMS 사진 업로드 응답에서 fileId를 찾지 못했습니다: " + response.body.slice(0, 200) };
  return { ok: true, fileId: fileId };
}

function sendSensMms_(to, content, fileId, label, config) {
  if (!config || !config.enabled) config = getSensConfig_();
  if (!config.enabled) return { ok: false, message: "SENS 설정필요" };
  if (!fileId) return { ok: false, message: "MMS 첨부 fileId 없음" };
  if (byteLength_(content) > 2000) return { ok: false, message: "MMS 문구 2000바이트 초과" };

  const uri = "/sms/v2/services/" + encodeURIComponent(config.serviceId) + "/messages";
  const payload = {
    type: "MMS",
    contentType: "COMM",
    countryCode: "82",
    from: config.from,
    subject: "BRING Care",
    content: content,
    messages: [{ to: to, content: content }],
    files: [{ fileId: fileId }]
  };
  const response = sensPostJson_(uri, payload, config);
  if (!response.ok) return { ok: false, message: "MMS 발송실패(" + label + "): " + response.message };
  const receipt = sensResponseReceipt_(response.json);
  return {
    ok: true,
    message: "MMS 발송요청 완료(" + label + ")",
    requestId: receipt.requestId,
    statusCode: receipt.statusCode,
    statusName: receipt.statusName,
    responseCode: response.code
  };
}

function sensPostJson_(uri, payload, config) {
  const timestamp = String(Date.now());
  const signature = makeNcpSignature_("POST", uri, timestamp, config.accessKey, config.secretKey);
  try {
    const response = UrlFetchApp.fetch("https://sens.apigw.ntruss.com" + uri, {
      method: "post",
      contentType: "application/json; charset=utf-8",
      headers: {
        "x-ncp-apigw-timestamp": timestamp,
        "x-ncp-iam-access-key": config.accessKey,
        "x-ncp-apigw-signature-v2": signature
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    const body = response.getContentText();
    let json = {};
    try { json = body ? JSON.parse(body) : {}; } catch (err) {}
    if (code >= 200 && code < 300) return { ok: true, code: code, body: body, json: json };
    return { ok: false, code: code, body: body, json: json, message: "HTTP " + code + " / " + body.slice(0, 200) };
  } catch (err) {
    return { ok: false, code: 0, body: "", json: {}, message: err.message };
  }
}

function findSensFileId_(value) {
  if (!value || typeof value !== "object") return "";
  if (value.fileId) return value.fileId;
  if (Array.isArray(value.files)) {
    for (const file of value.files) {
      const id = findSensFileId_(file);
      if (id) return id;
    }
  }
  for (const key in value) {
    if (value[key] && typeof value[key] === "object") {
      const id = findSensFileId_(value[key]);
      if (id) return id;
    }
  }
  return "";
}

function sensResponseReceipt_(json) {
  json = json && typeof json === "object" ? json : {};
  return {
    requestId: String(json.requestId || json.requestID || ""),
    statusCode: String(json.statusCode || ""),
    statusName: String(json.statusName || json.status || "")
  };
}

function normalizeVendorForMms_(vendor) {
  vendor = vendor || {};
  return {
    id: String(vendor.id || ""),
    category: String(vendor.category || ""),
    no: String(vendor.no || ""),
    type: String(vendor.type || ""),
    name: String(vendor.name || ""),
    address: String(vendor.address || ""),
    phone: String(vendor.phone || ""),
    mobile: String(vendor.mobile || ""),
    tel: String(vendor.tel || ""),
    map: String(vendor.map || ""),
    promo: String(vendor.promo || ""),
    note: String(vendor.note || "")
  };
}

function vendorSmsPhone_(vendor) {
  const raw = [vendor.phone, vendor.mobile, vendor.tel].filter(Boolean).join("\n");
  const phones = extractPhones_(raw);
  return phones.find(phone => /^01[016789]\d{7,8}$/.test(phone)) || "";
}

function extractPhones_(value) {
  const matches = String(value || "").match(/(?:\+?82[-.\s]?)?0?\d{1,3}[-.\s]?\d{3,4}[-.\s]?\d{4}/g) || [];
  return [...new Set(matches.map(normalizePhoneForSms_).filter(phone => phone.length >= 9 && phone.length <= 11))];
}

function getVendorQuoteReplyEmail_() {
  const props = PropertiesService.getScriptProperties();
  return String(
    props.getProperty("VENDOR_QUOTE_REPLY_EMAIL") ||
    COMPLAINT_CONFIG.VENDOR_QUOTE_REPLY_EMAIL ||
    ""
  ).trim();
}

function vendorQuoteSymptom_(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const marker = text.indexOf(" - ");
  return marker >= 0 ? text.slice(marker + 3).trim() : text;
}

function makeVendorEstimateMmsContent_(casePayload, record) {
  const replyEmail = getVendorQuoteReplyEmail_() || "회신 이메일 미설정";
  const building = readField_(record, ["건물명", "건물"]) || casePayload.building || "건물 미입력";
  const room = readField_(record, ["호실"]) || casePayload.room || "";
  const issueType = readField_(record, ["문제 유형"]) || casePayload.issueType || casePayload.vendorType || "시설";
  const subject = [building, room, issueType, "유지보수 민원 건"].filter(Boolean).join(" ");
  const symptom = readField_(record, ["증상 설명", "민원 내용", "내용"]) || vendorQuoteSymptom_(casePayload.summary) || "미입력";
  const visitTime = formatVisitTimeFromRecord_(record) || casePayload.visitTime || "미입력";
  return [
    "[BRING Care 견적서 회신 요청]",
    "",
    "안녕하세요. BRING Care입니다.",
    "",
    "첨부된 현장 사진과 아래 내용을 확인하신 후,",
    "작업 가능 여부와 견적서를 아래 이메일로 회신 부탁드립니다.",
    "",
    "회신 이메일: " + replyEmail,
    "",
    "■ 민원 내용",
    "- 증상: " + symptom,
    "- 방문 가능 시간대: " + visitTime,
    "",
    "■ 회신 요청 내용",
    "- 작업 가능 여부",
    "- 예상 작업 내용",
    "- 총 견적금액",
    "- 방문 가능 일정",
    "",
    "■ 첨부 요청",
    "- 견적서",
    "- 사업자등록증 사본",
    "",
    "확인 후 회신 부탁드립니다.",
    "감사합니다."
  ].join("\n");
}

function updateVendorMmsCase_(caseId, casePayload, result) {
  const timestamp = new Date().toISOString();
  casePayload.status = casePayload.status || {};
  casePayload.note = casePayload.note || {};
  casePayload.log = Array.isArray(casePayload.log) ? casePayload.log : [];
  if (result.ok === true) {
    result.completedAt = result.completedAt || timestamp;
    result.stepTransition = {
      completed: "c5",
      opened: "c6",
      completedAt: result.completedAt
    };
  }
  casePayload.vendorEstimateMms = result;
  casePayload.note.c5 = makeVendorMmsNote_(result);
  casePayload.status.c5 = result.ok === true ? "done" : "doing";
  if (result.ok === true && casePayload.status.c6 !== "done") {
    casePayload.status.c6 = "doing";
  }
  casePayload.updatedAt = timestamp;
  casePayload.log.unshift("업체 MMS " + (result.ok ? "발송완료" : "발송보류") + " / " + (result.statusText || ""));
  if (casePayload.log.length > 30) casePayload.log.length = 30;
  putCaseChildToFirebase_(caseId, "vendorEstimateMms", result);
  patchCaseChildToFirebase_(caseId, "status", {
    c5: casePayload.status.c5,
    c6: casePayload.status.c6
  });
  patchCaseChildToFirebase_(caseId, "note", { c5: casePayload.note.c5 });
  patchCaseToFirebase_(caseId, {
    log: casePayload.log,
    updatedAt: casePayload.updatedAt
  });
  const automationState = Object.assign({}, casePayload.automationState || {});
  automationState.vendorEstimateMms = {
    ok: result.ok === true,
    status: result.status || "",
    requestKey: result.requestKey || "",
    requestIds: (result.sent || []).map(item => item.requestId || "").filter(Boolean),
    sentCount: (result.sent || []).length,
    failedCount: (result.failed || []).length,
    skippedCount: (result.skipped || []).length,
    completedAt: result.ok === true ? (result.completedAt || timestamp) : "",
    updatedAt: timestamp,
    build: AUTOMATION_BUILD
  };
  patchCaseChildToFirebase_(caseId, "automationState", automationState);
  const workflow = advanceCaseWorkflow_(caseId, { source: "vendor_mms", skipOwnerAutoSend: true });
  return Object.assign({ caseId: caseId, workflow: workflow }, result);
}

function makeVendorMmsNote_(result) {
  const lines = [
    "[업체 MMS 견적 요청]",
    "상태: " + (result.ok ? "발송완료" : "진행중/보류"),
    result.statusText || "",
    result.ok ? "다음 단계: ⑥ 견적 비교 진행중" : "",
    result.photoName ? "사진: " + result.photoName : "",
    result.sensFileId ? "SENS 파일 ID: " + result.sensFileId : ""
  ].filter(Boolean);

  if (result.sent && result.sent.length) {
    lines.push("");
    lines.push("[발송 완료]");
    result.sent.forEach(item => {
      const tracking = item.requestId ? " / 요청ID: " + item.requestId : "";
      const sensStatus = item.statusCode || item.statusName ? " / SENS: " + [item.statusCode, item.statusName].filter(Boolean).join(" ") : "";
      lines.push("- " + item.name + " / " + item.phoneMasked + " / " + item.message + tracking + sensStatus);
    });
  }
  if (result.failed && result.failed.length) {
    lines.push("");
    lines.push("[발송 실패]");
    result.failed.forEach(item => lines.push("- " + item.name + " / " + item.phoneMasked + " / " + item.message));
  }
  if (result.skipped && result.skipped.length) {
    lines.push("");
    lines.push("[제외]");
    result.skipped.forEach(item => lines.push("- " + item.name + " / " + item.reason));
  }
  return lines.join("\n");
}

function handleQuoteFileUpload_(payload) {
  const caseId = String(payload.caseId || "").trim();
  const filePayload = payload.file || {};
  if (!caseId) return { ok: false, message: "caseId가 없습니다." };

  const casePayload = readCaseFromFirebase_(caseId);
  if (!casePayload) return { ok: false, message: "Firebase 케이스를 찾지 못했습니다: " + caseId };

  const validation = validateQuoteUpload_(filePayload);
  if (!validation.ok) {
    return updateQuoteUploadFailure_(caseId, casePayload, validation.message);
  }

  const initialVendorName = resolveInitialQuoteVendorName_(payload, filePayload.fileName);
  const vendor = normalizeQuoteVendor_(payload.vendor, initialVendorName);
  const uploadedAt = new Date().toISOString();
  const quoteId = "q" + Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMddHHmmss") + "-" + Utilities.getUuid().slice(0, 8);
  const folder = getQuoteDriveFolder_(casePayload);
  const originalFolder = getOrCreateChildFolder_(folder, "원본 견적서");
  const bringFolder = getOrCreateChildFolder_(folder, "브링 양식 견적서");
  const analysisFolder = null;
  const savedName = makeQuoteDriveFileName_(casePayload, initialVendorName, filePayload.fileName);
  const bytes = Utilities.base64Decode(String(filePayload.fileBody || "").replace(/^data:[^,]+,/, ""));
  const mimeType = filePayload.mimeType || inferQuoteMimeType_(filePayload.fileName);
  const blob = Utilities.newBlob(bytes, mimeType, savedName);
  const driveFile = originalFolder.createFile(blob);

  const quote = {
    id: quoteId,
    vendorId: String(payload.vendorId || ""),
    vendorName: initialVendorName,
    vendor: vendor,
    amount: String(payload.amount || "").trim(),
    memo: String(payload.memo || "").trim(),
    fileName: driveFile.getName(),
    fileUrl: driveFile.getUrl(),
    driveFileId: driveFile.getId(),
    originalFileName: driveFile.getName(),
    originalFileUrl: driveFile.getUrl(),
    originalDriveFileId: driveFile.getId(),
    mimeType: mimeType,
    size: Number(filePayload.size || bytes.length),
    uploadedAt: uploadedAt
  };

  const bringQuote = createBringQuoteFromUpload_(casePayload, quote, blob, payload, bringFolder, analysisFolder);
  Object.keys(bringQuote).forEach(key => {
    quote[key] = bringQuote[key];
  });
  applyQuoteAmountState_(quote);
  if (isGenericQuoteVendorName_(quote.vendorName) && quote.extractedVendorName) {
    quote.vendorName = quote.extractedVendorName;
    quote.vendor = quote.vendor || {};
    quote.vendor.name = quote.extractedVendorName;
  }
  const finalVendorName = quote.vendorName || initialVendorName;
  if (!isGenericQuoteVendorName_(finalVendorName)) {
    const renamed = makeQuoteDriveFileName_(casePayload, finalVendorName, filePayload.fileName);
    if (driveFile.getName() !== renamed) {
      driveFile.setName(renamed);
      quote.fileName = driveFile.getName();
      quote.originalFileName = driveFile.getName();
    }
  }

  casePayload.quoteFiles = casePayload.quoteFiles && typeof casePayload.quoteFiles === "object" && !Array.isArray(casePayload.quoteFiles)
    ? casePayload.quoteFiles
    : {};
  casePayload.quoteFiles[quoteId] = quote;
  casePayload.status = casePayload.status || {};
  if (casePayload.status.c6 !== "done") casePayload.status.c6 = "doing";
  casePayload.note = casePayload.note || {};
  casePayload.note.c6 = makeQuoteComparisonNote_(casePayload);
  casePayload.log = Array.isArray(casePayload.log) ? casePayload.log : [];
  casePayload.log.unshift("견적 파일 업로드: " + finalVendorName + " / " + driveFile.getName());
  if (quote.bringQuoteXlsxUrl) {
    casePayload.log.unshift("브링 양식 견적서 초안 생성: " + finalVendorName + " / " + (quote.extractionStatus || "확인필요"));
  } else {
    casePayload.log.unshift("브링 양식 견적서 생성 보류: " + finalVendorName + " / " + (quote.extractionMemo || "템플릿 설정 확인 필요"));
  }
  if (casePayload.log.length > 30) casePayload.log.length = 30;
  casePayload.updatedAt = uploadedAt;
  putCaseChildToFirebase_(caseId, "quoteFiles/" + quoteId, quote);
  patchCaseChildToFirebase_(caseId, "status", { c6: casePayload.status.c6 });
  patchCaseChildToFirebase_(caseId, "note", { c6: casePayload.note.c6 });
  patchCaseToFirebase_(caseId, {
    log: casePayload.log,
    updatedAt: uploadedAt
  });
  recordUploadBatchProgress_(caseId, payload);
  const workflow = advanceCaseWorkflow_(caseId, {
    source: "quote_upload",
    uploadBatchId: String(payload.uploadBatchId || ""),
    uploadBatchComplete: payload.uploadBatchId ? payload.uploadBatchComplete === true : true
  });

  return { ok: true, caseId: caseId, quote: quote, workflow: workflow, message: "견적 파일 업로드 및 브링 양식 처리 완료" };
}

function handleBusinessRegistrationUpload_(payload) {
  const caseId = String(payload.caseId || "").trim();
  const filePayload = payload.file || {};
  if (!caseId) return { ok: false, message: "caseId가 없습니다." };

  const casePayload = readCaseFromFirebase_(caseId);
  if (!casePayload) return { ok: false, message: "Firebase 케이스를 찾지 못했습니다: " + caseId };

  const validation = validateBusinessRegistrationUpload_(filePayload);
  if (!validation.ok) {
    return updateBusinessRegistrationUploadFailure_(caseId, casePayload, validation.message);
  }

  const uploadedAt = new Date().toISOString();
  const docId = "br" + Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMddHHmmss") + "-" + Utilities.getUuid().slice(0, 8);
  const bytes = Utilities.base64Decode(String(filePayload.fileBody || "").replace(/^data:[^,]+,/, ""));
  const mimeType = filePayload.mimeType || inferQuoteMimeType_(filePayload.fileName);
  const blob = Utilities.newBlob(bytes, mimeType, safeDriveName_(filePayload.fileName || "business-registration"));
  const analysis = extractBusinessRegistrationData_(blob, mimeType, filePayload.fileName, casePayload, null);
  const vendorInfo = cleanVendorInfo_(analysis.vendorInfo || {});
  const match = matchBusinessRegistrationVendor_(vendorInfo, payload, casePayload);
  const finalVendorName = vendorInfo.name || match.vendorName || "";
  const folder = getBusinessRegistrationDriveFolder_(casePayload, finalVendorName);
  const savedName = makeBusinessRegistrationDriveFileName_(casePayload, finalVendorName, filePayload.fileName);
  const driveFile = folder.createFile(blob.setName(savedName));

  const doc = {
    id: docId,
    vendorId: match.vendorId || "",
    vendorName: finalVendorName,
    matchedVendorName: match.vendorName || "",
    matchStatus: match.status,
    matchMemo: match.memo,
    statusText: match.status === "matched" ? "업체 자동 연결" : match.status === "multiple" ? "업체 연결 확인 필요" : "업체 연결 확인 필요",
    businessNo: vendorInfo.businessNo || "",
    ceo: vendorInfo.ceo || "",
    address: vendorInfo.address || "",
    type: vendorInfo.type || "",
    category: vendorInfo.category || "",
    phone: vendorInfo.phone || "",
    email: vendorInfo.email || "",
    extractionStatus: analysis.status,
    extractionMemo: analysis.memo,
    extractionTextPreview: analysis.textPreview || "",
    analysisEngine: analysis.analysisEngine || "",
    analysisStatus: analysis.analysisStatus || "",
    analysisStatusCode: analysis.analysisStatusCode || "",
    analysisWarnings: analysis.analysisWarnings || [],
    analysisMarkdownUrl: analysis.analysisMarkdownUrl || "",
    analysisMarkdownFileId: analysis.analysisMarkdownFileId || "",
    analysisJsonUrl: analysis.analysisJsonUrl || "",
    analysisJsonFileId: analysis.analysisJsonFileId || "",
    mineruSupplementAttempted: !!analysis.mineruSupplementMessage,
    mineruSupplementUsed: !!analysis.mineruSupplementUsed,
    mineruSupplementMessage: analysis.mineruSupplementMessage || "",
    supplierMissingFields: analysis.supplierMissingFields || [],
    fileName: driveFile.getName(),
    fileUrl: driveFile.getUrl(),
    driveFileId: driveFile.getId(),
    originalFileName: String(filePayload.fileName || driveFile.getName()),
    mimeType: mimeType,
    size: Number(filePayload.size || bytes.length),
    uploadedAt: uploadedAt
  };

  casePayload.businessRegistrationFiles = casePayload.businessRegistrationFiles && typeof casePayload.businessRegistrationFiles === "object" && !Array.isArray(casePayload.businessRegistrationFiles)
    ? casePayload.businessRegistrationFiles
    : {};
  casePayload.businessRegistrationFiles[docId] = doc;
  const refreshResult = refreshBringQuotesFromBusinessRegistration_(caseId, casePayload, doc, uploadedAt);
  casePayload.status = casePayload.status || {};
  if (casePayload.status.c6 !== "done") casePayload.status.c6 = "doing";
  casePayload.note = casePayload.note || {};
  casePayload.note.c6 = makeQuoteComparisonNote_(casePayload);
  casePayload.log = Array.isArray(casePayload.log) ? casePayload.log : [];
  casePayload.log.unshift("사업자등록증 업로드: " + (finalVendorName || "업체 연결 확인 필요") + " / " + driveFile.getName());
  if (refreshResult.updated) {
    casePayload.log.unshift("사업자등록증 정보로 브링 엑셀 보충: " + refreshResult.updated + "건");
  }
  if (casePayload.log.length > 30) casePayload.log.length = 30;
  casePayload.updatedAt = uploadedAt;

  putCaseChildToFirebase_(caseId, "businessRegistrationFiles/" + docId, doc);
  patchCaseChildToFirebase_(caseId, "status", { c6: casePayload.status.c6 });
  patchCaseChildToFirebase_(caseId, "note", { c6: casePayload.note.c6 });
  patchCaseToFirebase_(caseId, {
    log: casePayload.log,
    updatedAt: uploadedAt
  });
  recordUploadBatchProgress_(caseId, payload);
  const workflow = advanceCaseWorkflow_(caseId, {
    source: "business_registration_upload",
    uploadBatchId: String(payload.uploadBatchId || ""),
    uploadBatchComplete: payload.uploadBatchId ? payload.uploadBatchComplete === true : true
  });

  return { ok: true, caseId: caseId, businessRegistration: doc, refreshedQuotes: refreshResult.updated, workflow: workflow, message: "사업자등록증 업로드 및 업체 정보 분석 완료" };
}

function applyQuoteAmountState_(quote) {
  quote = quote || {};
  if (Number(quote.confirmedTotalAmount || 0)) {
    quote.amountStatus = "확정";
    quote.amountSource = "admin_confirmed";
    return quote;
  }
  if (Number(quote.bringQuoteTotalAmount || 0) || quote.amountSource === "bring_sheet") {
    quote.amountStatus = "확인필요";
    quote.amountSource = "bring_sheet";
    return quote;
  }
  if (Number(quote.totalAmount || 0)) {
    quote.amountStatus = "확인필요";
    quote.amountSource = "auto_extracted";
    return quote;
  }
  quote.amountStatus = "확인필요";
  quote.amountSource = "missing";
  return quote;
}

function handleConfirmQuoteAmount_(payload) {
  const caseId = String(payload.caseId || "").trim();
  const quoteId = String(payload.quoteId || "").trim();
  const totalAmount = parseMoneyValue_(payload.totalAmount);
  if (!caseId) return { ok: false, message: "caseId가 없습니다." };
  if (!quoteId) return { ok: false, message: "quoteId가 없습니다." };
  if (!totalAmount || totalAmount < 1000) return { ok: false, caseId: caseId, quoteId: quoteId, message: "확정할 합계금액을 1,000원 이상으로 입력해주세요." };

  const casePayload = readCaseFromFirebase_(caseId);
  if (!casePayload) return { ok: false, message: "Firebase 케이스를 찾지 못했습니다: " + caseId };

  casePayload.quoteFiles = casePayload.quoteFiles && typeof casePayload.quoteFiles === "object" && !Array.isArray(casePayload.quoteFiles)
    ? casePayload.quoteFiles
    : {};
  const quote = casePayload.quoteFiles[quoteId];
  if (!quote) return { ok: false, caseId: caseId, quoteId: quoteId, message: "견적 파일을 찾지 못했습니다." };

  const amounts = confirmedQuoteAmounts_(totalAmount);
  const confirmedAt = new Date().toISOString();
  quote.confirmedTotalAmount = amounts.totalAmount;
  quote.confirmedSupplyAmount = amounts.supplyAmount;
  quote.confirmedVatAmount = amounts.vatAmount;
  quote.amountStatus = "확정";
  quote.amountSource = "admin_confirmed";
  quote.amountConfirmedAt = confirmedAt;
  quote.amount = formatMoney_(amounts.totalAmount);
  quote.totalAmount = amounts.totalAmount;
  quote.supplyAmount = amounts.supplyAmount;
  quote.vatAmount = amounts.vatAmount;
  quote.extractionMemo = removeQuoteMemo_(quote.extractionMemo, "금액 확인 필요");

  const templateId = extractDriveId_(COMPLAINT_CONFIG.QUOTE_TEMPLATE_SPREADSHEET_ID);
  let rewriteMessage = "";
  if (!templateId) {
    quote.bringQuoteStatus = "template_missing";
    quote.bringQuoteType = "missing";
    quote.extractionStatus = quote.extractionStatus || "확인필요";
    quote.extractionMemo = appendQuoteMemo_(quote.extractionMemo, "브링 양식 템플릿 설정 필요");
    rewriteMessage = "브링 양식 템플릿 설정 필요";
  } else {
    const folder = getQuoteDriveFolder_(casePayload);
    const bringFolder = getOrCreateChildFolder_(folder, "브링 양식 견적서");
    const extraction = makeConfirmedQuoteExtraction_(quote, casePayload, amounts);
    let sheetId = extractDriveId_(quote.bringQuoteSheetId || quote.bringQuoteSheetUrl);
    let sheetFile = null;
    if (sheetId) {
      sheetFile = DriveApp.getFileById(sheetId);
    } else {
      const fileNameBase = makeBringQuoteFileNameBase_(quote, extraction);
      sheetFile = DriveApp.getFileById(templateId).makeCopy(fileNameBase, bringFolder);
      sheetId = sheetFile.getId();
    }

    const ss = SpreadsheetApp.openById(sheetId);
    const fillResult = fillBringQuoteSpreadsheet_(ss, casePayload, quote, extraction);
    SpreadsheetApp.flush();
    if (fillResult && fillResult.vendor && fillResult.vendor.name) {
      quote.vendor = fillResult.vendor;
      quote.resolvedVendorInfo = fillResult.vendor;
      quote.vendorName = fillResult.vendor.name;
      quote.vendorInfoSource = fillResult.businessApplied ? "business_registration" : quote.vendorInfoSource;
    }
    const sheetAmounts = readBringQuoteAmounts_(ss);
    if (sheetAmounts.totalAmount) {
      quote.bringQuoteTotalAmount = sheetAmounts.totalAmount;
      quote.bringQuoteSupplyAmount = sheetAmounts.supplyAmount || "";
      quote.bringQuoteVatAmount = sheetAmounts.vatAmount || "";
      quote.bringQuoteBaseTotalAmount = Number(quote.confirmedTotalAmount || quote.bringQuoteBaseTotalAmount || quote.totalAmount || amounts.totalAmount || 0);
      quote.bringQuoteBaseSupplyAmount = Number(quote.confirmedSupplyAmount || quote.bringQuoteBaseSupplyAmount || quote.supplyAmount || amounts.supplyAmount || 0);
      quote.bringQuoteBaseVatAmount = Number(quote.confirmedVatAmount || quote.bringQuoteBaseVatAmount || quote.vatAmount || amounts.vatAmount || 0);
      quote.bringQuoteMarkupRate = BRING_QUOTE_MARKUP_RATE;
      quote.bringQuoteMarkupAmount = Math.max(0, sheetAmounts.totalAmount - quote.bringQuoteBaseTotalAmount);
      quote.bringQuoteItems = fillResult && fillResult.bringItems || quote.bringQuoteItems || [];
      quote.bringQuoteAmountSyncedAt = confirmedAt;
    }

    quote.bringQuoteStatus = "confirmed_rewritten";
    quote.bringQuoteType = "confirmed";
    quote.bringQuoteSheetName = "";
    quote.bringQuoteSheetUrl = "";
    quote.bringQuoteSheetId = "";
    quote.extractionStatus = "추출완료";
    quote.extractionMemo = appendQuoteMemo_(removeQuoteMemo_(quote.extractionMemo, "금액 확인 필요"), "관리자 확정 금액으로 브링 양식 재작성");
    if (fillResult && fillResult.businessApplied) {
      quote.extractionMemo = appendQuoteMemo_(quote.extractionMemo, "사업자등록증 정보로 브링 엑셀 빈칸 보충");
      quote.businessRegistrationAppliedAt = confirmedAt;
      quote.businessRegistrationDocId = fillResult.businessVendor && fillResult.businessVendor.docId || quote.businessRegistrationDocId || "";
    }
    if (fillResult && fillResult.mineruSupplementApplied) {
      quote.extractionMemo = appendQuoteMemo_(quote.extractionMemo, fillResult.mineruSupplementMessage || "MinerU OCR로 사업자등록증 빈칸 보충");
    }
    quote.extractedItems = extraction.items;

    const fileNameBase = makeBringQuoteFileNameBase_(quote, extraction);
    const exported = exportBringQuoteXlsx_(sheetId, fileNameBase + ".xlsx", bringFolder);
    if (exported.ok) {
      quote.bringQuoteXlsxName = exported.fileName;
      quote.bringQuoteXlsxUrl = exported.fileUrl;
      quote.bringQuoteXlsxId = exported.fileId;
    } else {
      quote.bringQuoteStatus = "xlsx_failed";
      quote.bringQuoteType = "failed";
      quote.extractionMemo = appendQuoteMemo_(quote.extractionMemo, "XLSX 내보내기 실패: " + exported.message);
    }
    trashDriveFileQuietly_(sheetFile);
    rewriteMessage = "브링 양식 재작성 완료";
  }

  casePayload.quoteFiles[quoteId] = quote;
  casePayload.status = casePayload.status || {};
  if (casePayload.status.c6 !== "done") casePayload.status.c6 = "doing";
  casePayload.note = casePayload.note || {};
  casePayload.note.c6 = makeQuoteComparisonNote_(casePayload);
  casePayload.log = Array.isArray(casePayload.log) ? casePayload.log : [];
  casePayload.log.unshift("견적 합계금액 확정: " + (quote.vendorName || "업체") + " / " + formatCurrencyText_(amounts.totalAmount) + " / " + rewriteMessage);
  if (casePayload.log.length > 30) casePayload.log.length = 30;
  casePayload.updatedAt = confirmedAt;

  putCaseChildToFirebase_(caseId, "quoteFiles/" + quoteId, quote);
  patchCaseChildToFirebase_(caseId, "status", { c6: casePayload.status.c6 });
  patchCaseChildToFirebase_(caseId, "note", { c6: casePayload.note.c6 });
  patchCaseToFirebase_(caseId, {
    log: casePayload.log,
    updatedAt: confirmedAt
  });

  const workflow = advanceCaseWorkflow_(caseId, {
    source: "quote_amount_confirm",
    uploadBatchComplete: true
  });
  return { ok: true, caseId: caseId, quoteId: quoteId, quote: quote, workflow: workflow, message: rewriteMessage };
}

function handleApplyBusinessRegistrationToQuote_(payload) {
  const caseId = String(payload.caseId || "").trim();
  const quoteId = String(payload.quoteId || "").trim();
  if (!caseId) return { ok: false, message: "caseId가 없습니다." };
  if (!quoteId) return { ok: false, message: "quoteId가 없습니다." };

  const timestamp = new Date().toISOString();
  const casePayload = readCaseFromFirebase_(caseId);
  if (!casePayload) return { ok: false, message: "Firebase 케이스를 찾지 못했습니다: " + caseId };

  casePayload.quoteFiles = casePayload.quoteFiles && typeof casePayload.quoteFiles === "object" && !Array.isArray(casePayload.quoteFiles)
    ? casePayload.quoteFiles
    : {};
  const quote = casePayload.quoteFiles[quoteId];
  if (!quote) return { ok: false, caseId: caseId, quoteId: quoteId, message: "견적 파일을 찾지 못했습니다." };

  const templateId = extractDriveId_(COMPLAINT_CONFIG.QUOTE_TEMPLATE_SPREADSHEET_ID);
  let message = "사업자등록증 정보 반영 완료";
  if (!templateId) {
    quote.bringQuoteStatus = "template_missing";
    quote.bringQuoteType = "missing";
    quote.extractionStatus = quote.extractionStatus || "확인필요";
    quote.extractionMemo = appendQuoteMemo_(quote.extractionMemo, "브링 양식 템플릿 설정 필요");
    message = "브링 양식 템플릿 설정 필요";
  } else {
    const businessVendor = findBusinessRegistrationForQuote_(casePayload, quote, quote.vendorName || quote.extractedVendorName || "");
    if (!(businessVendor && (businessVendor.docId || businessVendor.name || businessVendor.businessNo))) {
      quote.extractionMemo = appendQuoteMemo_(quote.extractionMemo, "사업자등록증 매칭 없음");
      message = "사업자등록증 매칭 없음";
    } else {
      const folder = getQuoteDriveFolder_(casePayload);
      const bringFolder = getOrCreateChildFolder_(folder, "브링 양식 견적서");
      const extraction = makeQuoteRewriteExtraction_(quote, casePayload);
      const fileNameBase = makeBringQuoteFileNameBase_(quote, extraction);
      const previousXlsxId = String(quote.bringQuoteXlsxId || "");
      let sheetFile = null;
      try {
        sheetFile = DriveApp.getFileById(templateId).makeCopy(fileNameBase, bringFolder);
        const ss = SpreadsheetApp.openById(sheetFile.getId());
        const fillResult = fillBringQuoteSpreadsheet_(ss, casePayload, quote, extraction);
        SpreadsheetApp.flush();

        if (fillResult && fillResult.vendor && fillResult.vendor.name) {
          quote.vendor = fillResult.vendor;
          quote.resolvedVendorInfo = fillResult.vendor;
          quote.vendorName = fillResult.vendor.name;
          quote.vendorInfoSource = fillResult.businessApplied ? "business_registration" : quote.vendorInfoSource;
        }

        const exported = exportBringQuoteXlsx_(sheetFile.getId(), fileNameBase + ".xlsx", bringFolder);
        if (exported.ok) {
          quote.bringQuoteXlsxName = exported.fileName;
          quote.bringQuoteXlsxUrl = exported.fileUrl;
          quote.bringQuoteXlsxId = exported.fileId;
          if (previousXlsxId && previousXlsxId !== exported.fileId) trashDriveFileByIdQuietly_(previousXlsxId);
        } else {
          quote.bringQuoteStatus = "xlsx_failed";
          quote.bringQuoteType = "failed";
          quote.extractionMemo = appendQuoteMemo_(quote.extractionMemo, "사업자등록증 반영 XLSX 내보내기 실패: " + exported.message);
          message = "XLSX 내보내기 실패";
        }

        const sheetAmounts = readBringQuoteAmounts_(ss);
        if (sheetAmounts.totalAmount) {
          quote.bringQuoteTotalAmount = sheetAmounts.totalAmount;
          quote.bringQuoteSupplyAmount = sheetAmounts.supplyAmount || "";
          quote.bringQuoteVatAmount = sheetAmounts.vatAmount || "";
          quote.bringQuoteBaseTotalAmount = Number(quote.confirmedTotalAmount || quote.bringQuoteBaseTotalAmount || quote.totalAmount || extraction.totalAmount || 0);
          quote.bringQuoteBaseSupplyAmount = Number(quote.confirmedSupplyAmount || quote.bringQuoteBaseSupplyAmount || quote.supplyAmount || extraction.supplyAmount || 0);
          quote.bringQuoteBaseVatAmount = Number(quote.confirmedVatAmount || quote.bringQuoteBaseVatAmount || quote.vatAmount || extraction.vatAmount || 0);
          quote.bringQuoteMarkupRate = BRING_QUOTE_MARKUP_RATE;
          quote.bringQuoteMarkupAmount = Math.max(0, sheetAmounts.totalAmount - quote.bringQuoteBaseTotalAmount);
          quote.bringQuoteItems = fillResult && fillResult.bringItems || quote.bringQuoteItems || [];
          quote.bringQuoteAmountSyncedAt = timestamp;
        }

        if (quote.bringQuoteStatus !== "xlsx_failed") {
          quote.bringQuoteStatus = "business_registration_rewritten";
          quote.bringQuoteType = Number(quote.confirmedTotalAmount || 0) ? "confirmed" : "draft";
        }
        quote.extractionMemo = appendQuoteMemo_(removeQuoteMemo_(quote.extractionMemo, "사업자등록증 매칭 없음"), "사업자등록증 정보 반영 완료");
        quote.businessRegistrationAppliedAt = timestamp;
        quote.businessRegistrationDocId = fillResult && fillResult.businessVendor && fillResult.businessVendor.docId || businessVendor.docId || quote.businessRegistrationDocId || "";
        if (fillResult && fillResult.mineruSupplementApplied) {
          quote.extractionMemo = appendQuoteMemo_(quote.extractionMemo, fillResult.mineruSupplementMessage || "MinerU OCR로 사업자등록증 빈칸 보충");
        }
        quote.extractedItems = extraction.items;
      } catch (err) {
        quote.extractionMemo = appendQuoteMemo_(quote.extractionMemo, "사업자등록증 정보 반영 실패: " + err.message);
        message = "사업자등록증 정보 반영 실패: " + err.message;
      } finally {
        trashDriveFileQuietly_(sheetFile);
      }
    }
  }

  quote.updatedAt = timestamp;
  applyQuoteAmountState_(quote);
  casePayload.quoteFiles[quoteId] = quote;
  casePayload.status = casePayload.status || {};
  if (casePayload.status.c6 !== "done") casePayload.status.c6 = "doing";
  casePayload.note = casePayload.note || {};
  casePayload.note.c6 = makeQuoteComparisonNote_(casePayload);
  casePayload.log = Array.isArray(casePayload.log) ? casePayload.log : [];
  casePayload.log.unshift("사업자등록증 정보 반영: " + (quote.vendorName || "업체") + " / " + message);
  if (casePayload.log.length > 30) casePayload.log.length = 30;
  casePayload.updatedAt = timestamp;

  putCaseChildToFirebase_(caseId, "quoteFiles/" + quoteId, quote);
  patchCaseChildToFirebase_(caseId, "status", { c6: casePayload.status.c6 });
  patchCaseChildToFirebase_(caseId, "note", { c6: casePayload.note.c6 });
  patchCaseToFirebase_(caseId, {
    log: casePayload.log,
    updatedAt: timestamp
  });

  return { ok: message.indexOf("실패") === -1 && message.indexOf("없음") === -1, caseId: caseId, quoteId: quoteId, quote: quote, message: message };
}

const BRING_QUOTE_MARKUP_RATE = 0.10;

function roundToHundred_(value) {
  const number = Number(value || 0);
  return number ? Math.round(number / 100) * 100 : 0;
}

function getBringQuoteBaseAmounts_(quote, extraction) {
  quote = quote || {};
  extraction = extraction || {};
  const total = Math.round(Number(
    quote.confirmedTotalAmount ||
    quote.bringQuoteBaseTotalAmount ||
    quote.totalAmount ||
    extraction.totalAmount ||
    parseMoneyValue_(quote.amount) ||
    0
  ));
  const supply = Math.round(Number(
    quote.confirmedSupplyAmount ||
    quote.bringQuoteBaseSupplyAmount ||
    quote.supplyAmount ||
    extraction.supplyAmount ||
    (total ? Math.round(total / 1.1) : 0)
  ));
  const vat = Math.round(Number(
    quote.confirmedVatAmount ||
    quote.bringQuoteBaseVatAmount ||
    quote.vatAmount ||
    extraction.vatAmount ||
    (total ? total - supply : 0)
  ));
  return { totalAmount: total, supplyAmount: supply, vatAmount: vat };
}

function calculateBringQuoteAmounts_(baseTotalAmount) {
  const baseTotal = Math.round(Number(baseTotalAmount || 0));
  if (!baseTotal || baseTotal < 1000) {
    return { baseTotalAmount: 0, totalAmount: 0, supplyAmount: 0, vatAmount: 0, markupRate: BRING_QUOTE_MARKUP_RATE, markupAmount: 0 };
  }
  const total = roundToHundred_(baseTotal * (1 + BRING_QUOTE_MARKUP_RATE));
  const supply = roundToHundred_(total / 1.1);
  const vat = total - supply;
  return {
    baseTotalAmount: baseTotal,
    totalAmount: total,
    supplyAmount: supply,
    vatAmount: vat,
    markupRate: BRING_QUOTE_MARKUP_RATE,
    markupAmount: total - baseTotal
  };
}

function scaleBringQuoteItems_(items, casePayload, baseAmounts, bringAmounts) {
  const sourceItems = normalizeBringQuoteItems_(items, casePayload, baseAmounts.totalAmount, baseAmounts.supplyAmount, baseAmounts.vatAmount);
  const usableItems = sourceItems.filter(item => item && !item.fallback && Number(item.total || 0));
  if (!bringAmounts.totalAmount || !usableItems.length) {
    return normalizeBringQuoteItems_([], casePayload, bringAmounts.totalAmount, bringAmounts.supplyAmount, bringAmounts.vatAmount);
  }

  const sourceTotal = usableItems.reduce((sum, item) => sum + Number(item.total || 0), 0);
  if (!sourceTotal) return normalizeBringQuoteItems_([], casePayload, bringAmounts.totalAmount, bringAmounts.supplyAmount, bringAmounts.vatAmount);

  let usedTotal = 0;
  let usedSupply = 0;
  return usableItems.map((item, index) => {
    const isLast = index === usableItems.length - 1;
    const ratio = Number(item.total || 0) / sourceTotal;
    const total = isLast ? bringAmounts.totalAmount - usedTotal : roundToHundred_(bringAmounts.totalAmount * ratio);
    const supply = isLast ? bringAmounts.supplyAmount - usedSupply : roundToHundred_(bringAmounts.supplyAmount * ratio);
    const vat = total - supply;
    usedTotal += total;
    usedSupply += supply;
    return {
      product: item.product || "",
      unit: item.unit || "식",
      unitPrice: supply || "",
      vat: vat || "",
      total: total || "",
      note: item.note || "원본 자동추출"
    };
  });
}

function confirmedQuoteAmounts_(totalAmount) {
  const total = Number(totalAmount || 0);
  const supply = total ? Math.round(total / 1.1) : 0;
  return {
    totalAmount: total,
    supplyAmount: supply,
    vatAmount: total ? total - supply : 0
  };
}

function makeConfirmedQuoteExtraction_(quote, casePayload, amounts) {
  const items = getQuoteItemsForRewrite_(quote, casePayload, amounts.totalAmount, amounts.supplyAmount, amounts.vatAmount);
  return {
    status: "추출완료",
    memo: "관리자 확정 금액",
    vendorName: quote.extractedVendorName || quote.vendorName || "",
    supplyAmount: amounts.supplyAmount,
    vatAmount: amounts.vatAmount,
    totalAmount: amounts.totalAmount,
    items: items
  };
}

function appendQuoteMemo_(memo, message) {
  const current = String(memo || "").trim();
  const next = String(message || "").trim();
  if (!next || current.indexOf(next) !== -1) return current;
  return [current, next].filter(Boolean).join(" / ");
}

function removeQuoteMemo_(memo, phrase) {
  const target = String(phrase || "").trim();
  if (!target) return String(memo || "").trim();
  return String(memo || "")
    .split(/\s+\/\s+/)
    .map(part => part.trim())
    .filter(part => part && part !== target)
    .join(" / ");
}

function validateQuoteUpload_(filePayload) {
  const fileName = String(filePayload.fileName || "").trim();
  const mimeType = String(filePayload.mimeType || "").trim();
  const body = String(filePayload.fileBody || "").replace(/^data:[^,]+,/, "");
  const size = Number(filePayload.size || 0);
  const maxSize = 5 * 1024 * 1024;
  const ext = fileName.split(".").pop().toLowerCase();
  const allowedExts = ["pdf", "jpg", "jpeg", "png", "doc", "docx", "xls", "xlsx", "hwp", "hwpx"];
  const allowedMimes = [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/x-hwp",
    "application/haansofthwp",
    "application/vnd.hancom.hwp",
    "application/vnd.hancom.hwpx"
  ];

  if (!fileName) return { ok: false, message: "파일명이 없습니다." };
  if (!body) return { ok: false, message: "파일 내용이 없습니다." };
  if (size > maxSize) return { ok: false, message: "파일 용량이 5MB를 초과했습니다." };
  if (!allowedExts.includes(ext) && !allowedMimes.includes(mimeType)) {
    return { ok: false, message: "지원하지 않는 견적 파일 형식입니다. PDF, JPG, PNG, DOC/DOCX, XLS/XLSX, HWP/HWPX만 업로드할 수 있습니다." };
  }
  return { ok: true };
}

function validateBusinessRegistrationUpload_(filePayload) {
  const validation = validateQuoteUpload_(filePayload || {});
  if (validation.ok) return validation;
  return {
    ok: false,
    message: String(validation.message || "사업자등록증 파일을 확인해주세요.")
      .replace(/견적\s*파일/g, "사업자등록증 파일")
      .replace(/견적/g, "사업자등록증")
  };
}

function updateQuoteUploadFailure_(caseId, casePayload, message) {
  casePayload.status = casePayload.status || {};
  if (casePayload.status.c6 !== "done") casePayload.status.c6 = "doing";
  casePayload.note = casePayload.note || {};
  casePayload.note.c6 = "견적 파일 업로드 실패: " + message;
  casePayload.log = Array.isArray(casePayload.log) ? casePayload.log : [];
  casePayload.log.unshift("견적 파일 업로드 실패: " + message);
  if (casePayload.log.length > 30) casePayload.log.length = 30;
  casePayload.updatedAt = new Date().toISOString();
  patchCaseChildToFirebase_(caseId, "status", { c6: casePayload.status.c6 });
  patchCaseChildToFirebase_(caseId, "note", { c6: casePayload.note.c6 });
  patchCaseToFirebase_(caseId, {
    log: casePayload.log,
    updatedAt: casePayload.updatedAt
  });
  return { ok: false, caseId: caseId, message: message };
}

function updateBusinessRegistrationUploadFailure_(caseId, casePayload, message) {
  casePayload.status = casePayload.status || {};
  if (casePayload.status.c6 !== "done") casePayload.status.c6 = "doing";
  casePayload.note = casePayload.note || {};
  casePayload.note.c6 = "사업자등록증 업로드 실패: " + message;
  casePayload.log = Array.isArray(casePayload.log) ? casePayload.log : [];
  casePayload.log.unshift("사업자등록증 업로드 실패: " + message);
  if (casePayload.log.length > 30) casePayload.log.length = 30;
  casePayload.updatedAt = new Date().toISOString();
  patchCaseChildToFirebase_(caseId, "status", { c6: casePayload.status.c6 });
  patchCaseChildToFirebase_(caseId, "note", { c6: casePayload.note.c6 });
  patchCaseToFirebase_(caseId, {
    log: casePayload.log,
    updatedAt: casePayload.updatedAt
  });
  return { ok: false, caseId: caseId, message: message };
}

function getQuoteDriveFolder_(casePayload) {
  const quoteRoot = getQuoteDriveRootFolder_();
  return getOrCreateChildFolder_(quoteRoot, makeCaseDriveFolderName_(casePayload));
}

function getBusinessRegistrationDriveFolder_(casePayload, vendorName) {
  const caseFolder = getQuoteDriveFolder_(casePayload);
  return getOrCreateChildFolder_(caseFolder, "사업자등록증");
}

function getQuoteDriveRootFolder_() {
  const configured = extractDriveId_(COMPLAINT_CONFIG.QUOTE_DRIVE_FOLDER_ID);
  if (!configured) throw new Error("QUOTE_DRIVE_FOLDER_ID가 비어 있어 견적서 저장 폴더를 찾을 수 없습니다.");
  return DriveApp.getFolderById(configured);
}

function makeCaseDriveFolderName_(casePayload) {
  return safeDriveName_((casePayload.ticketNo || casePayload.id || "case") + "_" + (casePayload.building || "건물"));
}

function getOrCreateChildFolder_(parent, name) {
  const folders = parent.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : parent.createFolder(name);
}

function makeQuoteDriveFileName_(casePayload, vendorName, originalName) {
  const extMatch = String(originalName || "").match(/(\.[A-Za-z0-9]+)$/);
  const ext = extMatch ? extMatch[1] : "";
  const base = [
    casePayload.ticketNo || casePayload.id || "case",
    vendorName || "업체",
    "견적"
  ].join("_");
  return safeDriveName_(base).slice(0, 120 - ext.length) + ext.toLowerCase();
}

function makeBusinessRegistrationDriveFileName_(casePayload, vendorName, originalName) {
  const extMatch = String(originalName || "").match(/(\.[A-Za-z0-9]+)$/);
  const ext = extMatch ? extMatch[1] : "";
  const base = [
    casePayload.ticketNo || casePayload.id || "case",
    vendorName || "업체확인필요",
    "사업자등록증"
  ].join("_");
  return safeDriveName_(base).slice(0, 120 - ext.length) + ext.toLowerCase();
}

function resolveInitialQuoteVendorName_(payload, originalName) {
  const selected = String(payload.vendorName || "").trim();
  if (selected && !isGenericQuoteVendorName_(selected)) return selected;
  const fromFile = extractQuoteVendorNameFromFileName_(originalName);
  if (fromFile) return fromFile;
  return selected && !isGenericQuoteVendorName_(selected) ? selected : "업체 확인 필요";
}

function extractQuoteVendorNameFromFileName_(fileName) {
  const raw = String(fileName || "").replace(/\.[^.]+$/, "");
  if (!raw) return "";
  const withoutCase = raw
    .replace(/^BR-\d{4}-\d{4}[_\-\s]*/i, "")
    .replace(/^\d{1,3}[_\-\s]*/, "");
  const parts = withoutCase.split(/[_\-]+/).map(part => part.trim()).filter(Boolean);
  const filtered = parts.filter(part => !/^(견적서?|견적|최종|수정|업로드|회신|원본|브링|양식|확인|필요)$/i.test(part));
  const candidate = filtered[0] || withoutCase;
  const cleaned = cleanExtractedVendorName_(candidate);
  return isGenericQuoteVendorName_(cleaned) ? "" : cleaned;
}

function normalizeQuoteVendor_(vendor, fallbackName) {
  vendor = vendor || {};
  const fallback = isGenericQuoteVendorValue_(fallbackName) ? "" : fallbackName;
  return {
    id: String(vendor.id || ""),
    category: String(vendor.category || ""),
    no: String(vendor.no || ""),
    type: String(vendor.type || ""),
    name: String(isGenericQuoteVendorValue_(vendor.name) ? fallback || "업체 미지정" : vendor.name || fallback || "업체 미지정"),
    address: String(vendor.address || ""),
    phone: String(vendor.phone || ""),
    email: String(vendor.email || vendor.mail || ""),
    businessNo: String(vendor.businessNo || vendor.bizNo || vendor.no || ""),
    ceo: String(vendor.ceo || vendor.owner || ""),
    note: String(vendor.note || "")
  };
}

function isGenericQuoteVendorName_(value) {
  return isGenericQuoteVendorValue_(value);
}

function isGenericQuoteVendorValue_(value) {
  const raw = String(value || "").replace(/\s+/g, " ").trim();
  if (!raw) return true;
  const compact = raw.replace(/\s+/g, "").toLowerCase();
  if (/^(test|sample|quote|vendor|company)$/i.test(raw)) return true;
  if (/^(테스트|샘플|견적|견적서|업체|업체명|업체미지정|업체확인필요|확인필요|미지정|자동|수동|원본|브링|양식)$/.test(compact)) return true;
  if (/업체(미지정|확인|자동|명없음)/.test(compact)) return true;
  if (/^br-\d{4}-\d{4}$/i.test(raw)) return true;
  if (/^\d+$/.test(compact)) return true;
  return false;
}

function extractQuoteVendorInfo_(text, mineruResult, fileName) {
  const structured = extractQuoteVendorInfoFromObject_(mineruResult || {});
  const fromText = extractQuoteVendorInfoFromText_(text || "");
  const merged = mergeVendorInfoObjects_(structured, fromText);
  const cleaned = cleanVendorInfo_(merged);
  cleaned.source = Object.keys(cleanVendorInfo_(fromText)).some(key => key !== "source" && cleanVendorInfo_(fromText)[key])
    ? "quote_text"
    : Object.keys(cleanVendorInfo_(structured)).some(key => key !== "source" && cleanVendorInfo_(structured)[key])
      ? "mineru_structured"
      : "";
  cleaned.fileNameVendorName = extractQuoteVendorNameFromFileName_(fileName);
  return cleaned;
}

function extractQuoteVendorInfoFromText_(text) {
  const source = String(text || "");
  return {
    name: extractQuoteVendorName_(source),
    phone: extractQuotePhone_(source),
    businessNo: extractQuoteBusinessNo_(source),
    ceo: extractFieldNearLabels_(source, ["대표자", "대표", "성명"]),
    address: extractFieldNearLabels_(source, ["주소", "사업장주소", "소재지"]),
    type: extractFieldNearLabels_(source, ["업태"]),
    category: extractFieldNearLabels_(source, ["업종", "종목"]),
    email: extractQuoteEmail_(source),
    source: "quote_text"
  };
}

function extractQuoteVendorInfoFromObject_(data) {
  const roots = [
    data && data.vendorInfo,
    data && data.supplier,
    data && data.company,
    data && data.vendor,
    data && data.provider,
    data && data.json,
    data
  ].filter(Boolean);
  const root = { roots: roots };
  return cleanVendorInfo_({
    name: deepFindValueByKeys_(root, ["vendorName", "supplierName", "companyName", "corpName", "businessName", "상호", "회사명", "업체명", "공급자"]),
    phone: deepFindValueByKeys_(root, ["phone", "tel", "telephone", "mobile", "contact", "전화", "연락처", "TEL"]),
    businessNo: deepFindValueByKeys_(root, ["businessNo", "bizNo", "registrationNo", "사업자번호", "사업자등록번호", "등록번호"]),
    ceo: deepFindValueByKeys_(root, ["ceo", "owner", "representative", "대표", "대표자"]),
    address: deepFindValueByKeys_(root, ["address", "addr", "소재지", "주소", "사업장주소"]),
    type: deepFindValueByKeys_(root, ["businessType", "업태"]),
    category: deepFindValueByKeys_(root, ["businessCategory", "industry", "업종", "종목"]),
    email: deepFindValueByKeys_(root, ["email", "mail", "이메일"]),
    source: "mineru_structured"
  });
}

function mergeQuoteVendorInfo_(fileInfo, selectedVendor, fileNameCandidate) {
  const file = cleanVendorInfo_(fileInfo || {});
  const selected = cleanVendorInfo_(normalizeQuoteVendor_(selectedVendor || {}, ""));
  const fileNameInfo = cleanVendorInfo_({ name: fileNameCandidate || "" });
  const merged = mergeVendorInfoObjects_(selected, file);
  const quoteName = chooseBestVendorName_(file.name, fileNameInfo.name, selected.name);
  const matchedVendorListAddress = resolveVendorListAddress_(quoteName, selected);
  merged.name = quoteName || "";
  merged.address = file.address || "";
  merged.addressFromVendorList = matchedVendorListAddress;
  merged.source = file.name || file.phone || file.businessNo || file.ceo || file.address || file.type || file.category || file.email
    ? (file.source || "quote_text")
    : fileNameInfo.name
      ? "file_name"
      : selected.phone || selected.businessNo || selected.ceo || selected.type || selected.category || selected.email || matchedVendorListAddress
        ? "vendor_list"
        : "missing";
  return {
    vendor: cleanVendorInfo_(merged),
    source: merged.source
  };
}

function resolveVendorListAddress_(quoteVendorName, selectedVendor) {
  const selected = cleanVendorInfo_(selectedVendor || {});
  if (!selected.address) return "";
  if (!quoteVendorName || !isSimilarVendorName_(quoteVendorName, selected.name)) return "";
  return selected.address;
}

function isSimilarVendorName_(left, right) {
  const a = vendorMatchKey_(left);
  const b = vendorMatchKey_(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;
  return a.indexOf(b) !== -1 || b.indexOf(a) !== -1;
}

function chooseBestVendorName_() {
  const names = Array.prototype.slice.call(arguments)
    .map(cleanExtractedVendorName_)
    .filter(Boolean)
    .filter(name => !isGenericQuoteVendorName_(name));
  if (!names.length) return "";
  const unique = [];
  names.forEach(name => {
    if (!unique.some(item => vendorMatchKey_(item) === vendorMatchKey_(name))) unique.push(name);
  });
  const sorted = unique.slice().sort((a, b) => a.length - b.length);
  for (const shortName of sorted) {
    const shortKey = vendorMatchKey_(shortName);
    if (!shortKey) continue;
    const contained = unique.some(name => {
      const key = vendorMatchKey_(name);
      return key && key !== shortKey && key.indexOf(shortKey) !== -1;
    });
    if (contained) return shortName;
  }
  return unique[0];
}

function mergeVendorInfoObjects_(base, override) {
  base = cleanVendorInfo_(base || {});
  override = cleanVendorInfo_(override || {});
  return {
    id: override.id || base.id || "",
    docId: override.docId || base.docId || "",
    category: override.category || base.category || "",
    no: override.no || base.no || "",
    type: override.type || base.type || "",
    name: override.name || base.name || "",
    address: override.address || base.address || "",
    addressFromVendorList: override.addressFromVendorList || base.addressFromVendorList || "",
    phone: override.phone || base.phone || "",
    email: override.email || base.email || "",
    businessNo: override.businessNo || base.businessNo || "",
    ceo: override.ceo || base.ceo || "",
    note: override.note || base.note || "",
    source: override.source || base.source || ""
  };
}

function cleanVendorInfo_(info) {
  info = info || {};
  const name = cleanExtractedVendorName_(info.name || info.vendorName || info.companyName || "");
  return {
    id: String(info.id || ""),
    docId: String(info.docId || ""),
    category: cleanSimpleVendorField_(info.category || info.industry || ""),
    no: String(info.no || ""),
    type: cleanSimpleVendorField_(info.type || info.businessType || ""),
    name: isGenericQuoteVendorValue_(name) ? "" : name,
    address: cleanQuoteAddress_(info.address || ""),
    addressFromVendorList: cleanQuoteAddress_(info.addressFromVendorList || ""),
    phone: cleanQuotePhone_(info.phone || info.tel || info.mobile || ""),
    email: cleanQuoteEmail_(info.email || info.mail || ""),
    businessNo: cleanBusinessNo_(info.businessNo || info.bizNo || info.registrationNo || ""),
    ceo: cleanSimpleVendorField_(info.ceo || info.owner || info.representative || ""),
    note: String(info.note || "").trim(),
    source: String(info.source || "")
  };
}

function chooseQuoteSelectedVendor_(payload, fileInfo, initialName, fileName) {
  const vendors = Array.isArray(payload.vendors) ? payload.vendors.map(v => normalizeQuoteVendor_(v, "")).filter(v => v.name || v.phone) : [];
  const fallback = normalizeQuoteVendor_(payload.vendor || {}, initialName);
  const targetNames = [
    fileInfo && fileInfo.name,
    initialName,
    extractQuoteVendorNameFromFileName_(fileName)
  ].map(cleanExtractedVendorName_).filter(name => name && !isGenericQuoteVendorName_(name));
  for (const target of targetNames) {
    const key = vendorMatchKey_(target);
    const exact = vendors.filter(v => vendorMatchKey_(v.name) === key);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) continue;
    const loose = vendors.filter(v => {
      const vk = vendorMatchKey_(v.name);
      return vk && key && (vk.indexOf(key) !== -1 || key.indexOf(vk) !== -1);
    });
    if (loose.length === 1) return loose[0];
  }
  if (vendors.length === 1) return vendors[0];
  return fallback;
}

function vendorMatchKey_(value) {
  return String(value || "")
    .replace(/주식회사|\(주\)|㈜/g, "")
    .replace(/[^가-힣a-zA-Z0-9]/g, "")
    .toLowerCase();
}

function vendorMatchKey_(value) {
  return String(value || "")
    .replace(/(\(\s*\uC8FC\s*\)|\u3231|\uC8FC\uC2DD\uD68C\uC0AC|\uC720\uD55C\uD68C\uC0AC|\uD569\uC790\uD68C\uC0AC|\uD569\uBA85\uD68C\uC0AC)/g, "")
    .replace(/[^\uAC00-\uD7A3a-zA-Z0-9]/g, "")
    .toLowerCase();
}

function vendorNameLooseMatch_(left, right) {
  const a = vendorMatchKey_(left);
  const b = vendorMatchKey_(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;
  if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) return true;
  return isSimilarVendorName_(left, right);
}

function extractBusinessRegistrationVendorNameFromFileName_(fileName) {
  let value = String(fileName || "").replace(/\.[^.]+$/, "");
  value = value
    .replace(/^BR-\d{4}-\d{4}[_\s-]*/i, "")
    .replace(/^\d+[_\s.-]*/, "")
    .replace(/\s*\uC0AC\uC5C5\uC790\s*\uB4F1\uB85D\uC99D.*$/g, "")
    .replace(/\s*\uC0AC\uC5C5\uC790\uB4F1\uB85D.*$/g, "")
    .replace(/\s*business\s*registration.*$/ig, "")
    .replace(/[_-]+$/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleanExtractedVendorName_(value);
}

function extractFieldNearLabels_(text, labels) {
  const lines = normalizeQuoteTextLines_(text);
  const normalizedLabels = labels.map(label => String(label).replace(/\s+/g, ""));
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const compact = line.replace(/\s+/g, "");
    for (let j = 0; j < labels.length; j++) {
      if (compact.indexOf(normalizedLabels[j]) === -1) continue;
      const value = cleanFieldValueAfterLabel_(line, labels[j]);
      if (value) return value;
      const next = cleanFieldValueAfterLabel_(lines[i + 1] || "", "");
      if (next && !labels.some(label => (lines[i + 1] || "").indexOf(label) !== -1)) return next;
    }
  }
  return "";
}

function cleanFieldValueAfterLabel_(line, label) {
  let value = String(line || "").trim();
  if (label) value = value.replace(new RegExp("^.*?" + escapeRegex_(label) + "\\s*[:：=\\-]?\\s*"), "");
  value = value
    .replace(/^[\s:：=\-]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  return value.slice(0, 140);
}

function extractBusinessRegistrationVendorInfoFromText_(text) {
  const source = String(text || "");
  const typeAndCategory = extractBusinessRegistrationTypeCategory_(source);
  return cleanVendorInfo_({
    name: extractBusinessRegistrationField_(source, ["상호", "상호명", "법인명", "회사명", "업체명", "사업체명"]),
    phone: extractBusinessRegistrationPhone_(source),
    businessNo: extractBusinessRegistrationBusinessNo_(source),
    ceo: extractBusinessRegistrationField_(source, ["대표자", "대표자명", "대표", "성명"]),
    address: extractBusinessRegistrationAddress_(source),
    type: typeAndCategory.type || extractBusinessRegistrationField_(source, ["업태"]),
    category: typeAndCategory.category || extractBusinessRegistrationField_(source, ["종목", "업종"]),
    email: extractQuoteEmail_(source),
    source: "business_registration"
  });
}

function extractBusinessRegistrationBusinessNo_(text) {
  const source = String(text || "");
  const labeled = extractBusinessRegistrationField_(source, ["사업자등록번호", "사업자 번호", "등록번호"]);
  const cleaned = cleanBusinessNo_(labeled);
  if (cleaned) return cleaned;
  const match = source.match(/[0-9]{3}[-.\s]?[0-9]{2}[-.\s]?[0-9]{5}/);
  return cleanBusinessNo_(match ? match[0] : "");
}

function extractBusinessRegistrationPhone_(text) {
  const labeled = extractBusinessRegistrationField_(text, ["전화번호", "전화", "연락처", "TEL", "Tel", "tel"]);
  return cleanQuotePhone_(labeled) || cleanQuotePhone_(text);
}

function extractBusinessRegistrationAddress_(text) {
  const value = extractBusinessRegistrationField_(text, ["사업장 소재지", "사업장 주소", "사업장소재지", "사업장주소", "본점 소재지", "본점소재지", "소재지", "주소"]);
  return cleanQuoteAddress_(value);
}

function extractBusinessRegistrationTypeCategory_(text) {
  const lines = normalizeQuoteTextLines_(text);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const type = restoreBusinessTypeSuffix_(extractBusinessRegistrationValueFromLine_(line, ["업태"], ["종목", "업종"]), line);
    const category = extractBusinessRegistrationValueFromLine_(line, ["종목", "업종"], ["업태"]);
    if (type || category) {
      return {
        type: cleanSimpleVendorField_(type),
        category: cleanSimpleVendorField_(category)
      };
    }
  }
  return { type: "", category: "" };
}

function restoreBusinessTypeSuffix_(type, line) {
  const cleaned = cleanSimpleVendorField_(type);
  if (!cleaned || /업$/.test(cleaned)) return cleaned;
  const compactLine = String(line || "").replace(/\s+/g, "");
  const compactType = cleaned.replace(/\s+/g, "");
  if (compactType && (compactLine.indexOf(compactType + "업종목") !== -1 || compactLine.indexOf(compactType + "업업종") !== -1)) {
    return cleaned + "업";
  }
  return cleaned;
}

function extractBusinessRegistrationField_(text, labels) {
  const lines = normalizeQuoteTextLines_(text);
  const labelsArray = sortBusinessRegistrationLabels_(Array.isArray(labels) ? labels : [labels]);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const value = extractBusinessRegistrationValueFromLine_(line, labelsArray);
    if (value) return cleanBusinessRegistrationFieldValue_(value);
    if (!lineHasBusinessRegistrationLabel_(line, labelsArray)) continue;
    const next = lines[i + 1] || "";
    if (next && !lineHasBusinessRegistrationLabel_(next, businessRegistrationStopLabels_())) {
      const nextValue = cleanBusinessRegistrationFieldValue_(next);
      if (nextValue) return nextValue;
    }
  }
  return "";
}

function extractBusinessRegistrationValueFromLine_(line, labels, extraStopLabels) {
  const labelsArray = sortBusinessRegistrationLabels_(Array.isArray(labels) ? labels : [labels]);
  for (let i = 0; i < labelsArray.length; i++) {
    const label = labelsArray[i];
    const pattern = flexibleLabelPattern_(label);
    const regex = new RegExp(pattern + "\\s*[:：=\\-]?\\s*([\\s\\S]*)", "i");
    const match = String(line || "").match(regex);
    if (!match) continue;
    const stopLabels = businessRegistrationStopLabels_()
      .concat(extraStopLabels || [])
      .filter(stop => businessRegistrationLabelKey_(stop) !== businessRegistrationLabelKey_(label));
    const trimmed = trimBusinessRegistrationValueAtNextLabel_(match[1], stopLabels);
    const cleaned = cleanBusinessRegistrationFieldValue_(trimmed);
    if (cleaned) return cleaned;
  }
  return "";
}

function lineHasBusinessRegistrationLabel_(line, labels) {
  const compact = String(line || "").replace(/\s+/g, "");
  return (Array.isArray(labels) ? labels : [labels]).some(label => compact.indexOf(businessRegistrationLabelKey_(label)) !== -1);
}

function sortBusinessRegistrationLabels_(labels) {
  return (labels || []).slice().sort((a, b) => businessRegistrationLabelKey_(b).length - businessRegistrationLabelKey_(a).length);
}

function trimBusinessRegistrationValueAtNextLabel_(value, stopLabels) {
  let result = String(value || "");
  let cutAt = result.length;
  (stopLabels || []).forEach(label => {
    const pattern = businessRegistrationStopLabelPattern_(label);
    const regex = new RegExp(pattern + "\\s*[:：=\\-]?", "i");
    const match = result.match(regex);
    if (match && typeof match.index === "number" && match.index >= 0) {
      cutAt = Math.min(cutAt, match.index);
    }
  });
  return result.slice(0, cutAt);
}

function cleanBusinessRegistrationFieldValue_(value) {
  return String(value || "")
    .replace(/^[\s:：=\-·ㆍ|/\\]+/, "")
    .replace(/[□■✓✔]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function businessRegistrationStopLabels_() {
  return [
    "사업자등록번호", "사업자 번호", "등록번호", "상호", "상호명", "법인명", "회사명", "업체명",
    "대표자", "대표자명", "대표", "성명", "사업장 소재지", "사업장 주소", "사업장소재지",
    "사업장주소", "본점 소재지", "본점소재지", "소재지", "주소", "사업의 종류", "업태",
    "종목", "업종", "전화번호", "전화", "연락처", "TEL", "Tel", "tel", "팩스", "이메일",
    "전자우편", "개업연월일", "발급사유", "공동사업자"
  ];
}

function businessRegistrationLabelKey_(label) {
  return String(label || "").replace(/\s+/g, "");
}

function flexibleLabelPattern_(label) {
  return businessRegistrationLabelKey_(label).split("").map(escapeRegex_).join("\\s*");
}

function businessRegistrationStopLabelPattern_(label) {
  return escapeRegex_(String(label || "").trim()).replace(/\s+/g, "\\s*");
}

function extractQuoteBusinessNo_(text) {
  const source = String(text || "");
  const labeled = source.match(/(?:사업자\s*(?:등록)?\s*번호|등록번호)\s*[:：]?\s*([0-9]{3}[-.\s]?[0-9]{2}[-.\s]?[0-9]{5})/);
  return cleanBusinessNo_(labeled ? labeled[1] : "");
}

function extractQuotePhone_(text) {
  const labeled = extractFieldNearLabels_(text, ["전화번호", "전화", "연락처", "TEL", "Tel", "tel"]);
  return cleanQuotePhone_(labeled) || cleanQuotePhone_(text);
}

function extractQuoteEmail_(text) {
  const match = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : "";
}

function cleanQuotePhone_(value) {
  const phones = extractPhones_(value);
  const digits = phones.find(phone => /^01[016789]\d{7,8}$/.test(phone)) || phones[0] || "";
  if (!digits) return "";
  if (digits.length === 11) return digits.replace(/(\d{3})(\d{4})(\d{4})/, "$1-$2-$3");
  if (digits.length === 10 && digits.indexOf("02") === 0) return digits.replace(/(\d{2})(\d{4})(\d{4})/, "$1-$2-$3");
  if (digits.length === 10) return digits.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3");
  return digits;
}

function cleanBusinessNo_(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 10) return "";
  return digits.replace(/(\d{3})(\d{2})(\d{5})/, "$1-$2-$3");
}

function cleanQuoteEmail_(value) {
  const match = String(value || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : "";
}

function cleanQuoteAddress_(value) {
  const cleaned = String(value || "")
    .replace(/^[\s:：=\-]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*(전화|TEL|Tel|tel|연락처|대표자|대표|사업자|이메일|업태|업종|종목)\s*[:：]?.*$/g, "")
    .trim();
  if (!cleaned || isGenericQuoteVendorValue_(cleaned)) return "";
  return cleaned.slice(0, 120);
}

function cleanSimpleVendorField_(value) {
  const cleaned = String(value || "")
    .replace(/^[\s:：=\-]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || isGenericQuoteVendorValue_(cleaned)) return "";
  return cleaned
    .replace(/\s*(사업자등록번호|사업자번호|전화번호|전화|TEL|이메일|주소)\s*[:：]?.*$/g, "")
    .trim()
    .slice(0, 80);
}

function deepFindValueByKeys_(obj, keys) {
  const wanted = keys.map(key => String(key).replace(/[\s_\-]/g, "").toLowerCase());
  const queue = [obj];
  let visited = 0;
  while (queue.length && visited < 300) {
    const current = queue.shift();
    visited++;
    if (!current || typeof current !== "object") continue;
    for (const key in current) {
      const normalized = String(key).replace(/[\s_\-]/g, "").toLowerCase();
      const value = current[key];
      if (wanted.some(item => normalized === item || normalized.indexOf(item) !== -1)) {
        if (value !== null && value !== undefined && typeof value !== "object") return String(value);
      }
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return "";
}

function makeBringQuoteFileNameBase_(quote, extraction) {
  const rawVendor = !isGenericQuoteVendorName_(quote.vendorName)
    ? quote.vendorName
    : extraction.vendorName;
  const vendorName = String(rawVendor || "").trim() || "업체확인필요";
  const dateSource = quote.uploadedAt ? new Date(quote.uploadedAt) : new Date();
  const date = Utilities.formatDate(dateSource, "Asia/Seoul", "yyyyMMdd");
  return safeDriveName_(vendorName + "_" + date);
}

function createBringQuoteFromUpload_(casePayload, quote, blob, payload, bringFolder, analysisFolder) {
  const templateId = extractDriveId_(COMPLAINT_CONFIG.QUOTE_TEMPLATE_SPREADSHEET_ID);
  const extraction = extractQuoteDataFromUpload_(blob, quote.mimeType, quote.fileName, payload.amount, casePayload, analysisFolder);
  const selectedVendor = chooseQuoteSelectedVendor_(payload, extraction.vendorInfo, quote.vendorName, quote.fileName);
  const resolvedVendor = mergeQuoteVendorInfo_(extraction.vendorInfo, selectedVendor, extraction.fileNameVendorName || extractQuoteVendorNameFromFileName_(quote.fileName));
  extraction.items = normalizeBringQuoteItems_(extraction.items, casePayload, extraction.totalAmount, extraction.supplyAmount, extraction.vatAmount);
  const baseAmounts = getBringQuoteBaseAmounts_(quote, extraction);
  quote.vendor = resolvedVendor.vendor;
  quote.resolvedVendorInfo = resolvedVendor.vendor;
  quote.vendorInfoSource = resolvedVendor.source;
  quote.vendorName = resolvedVendor.vendor.name || "업체 확인 필요";
  const result = {
    extractionStatus: extraction.status,
    extractionMemo: extraction.memo,
    extractionTextPreview: extraction.textPreview,
    amount: formatMoney_(baseAmounts.totalAmount),
    sourceTotalAmount: baseAmounts.totalAmount || "",
    supplyAmount: baseAmounts.supplyAmount || "",
    vatAmount: baseAmounts.vatAmount || "",
    totalAmount: baseAmounts.totalAmount || "",
    extractedVendorName: extraction.vendorName || "",
    extractedVendorInfo: extraction.vendorInfo || {},
    resolvedVendorInfo: resolvedVendor.vendor,
    vendorInfoSource: resolvedVendor.source,
    extractedItems: extraction.items || [],
    analysisEngine: extraction.analysisEngine || "",
    analysisStatus: extraction.analysisStatus || "",
    analysisStatusCode: extraction.analysisStatusCode || "",
    analysisConfidence: extraction.analysisConfidence || "",
    analysisWarnings: extraction.analysisWarnings || [],
    analysisMarkdownUrl: extraction.analysisMarkdownUrl || "",
    analysisMarkdownFileId: extraction.analysisMarkdownFileId || "",
    analysisJsonUrl: extraction.analysisJsonUrl || "",
    analysisJsonFileId: extraction.analysisJsonFileId || ""
  };

  if (!templateId) {
    result.extractionStatus = extraction.status === "추출실패" ? "추출실패" : "확인필요";
    result.extractionMemo = [result.extractionMemo, "QUOTE_TEMPLATE_SPREADSHEET_ID가 비어 있어 브링 양식 파일은 생성하지 않았습니다."].filter(Boolean).join(" / ");
    result.bringQuoteStatus = "template_missing";
    result.bringQuoteType = "missing";
    return result;
  }

  let copied = null;
  try {
    const fileNameBase = makeBringQuoteFileNameBase_(quote, extraction);
    const templateFile = DriveApp.getFileById(templateId);
    copied = templateFile.makeCopy(fileNameBase, bringFolder);
    const ss = SpreadsheetApp.openById(copied.getId());
    const fillResult = fillBringQuoteSpreadsheet_(ss, casePayload, quote, extraction);
    SpreadsheetApp.flush();
    const sheetAmounts = readBringQuoteAmounts_(ss);

    result.bringQuoteStatus = "draft_created";
    result.bringQuoteType = "draft";
    result.bringQuoteSheetName = "";
    result.bringQuoteSheetUrl = "";
    result.bringQuoteSheetId = "";
    if (sheetAmounts.totalAmount) {
      result.bringQuoteTotalAmount = sheetAmounts.totalAmount;
      result.bringQuoteSupplyAmount = sheetAmounts.supplyAmount || "";
      result.bringQuoteVatAmount = sheetAmounts.vatAmount || "";
      result.bringQuoteBaseTotalAmount = baseAmounts.totalAmount || "";
      result.bringQuoteBaseSupplyAmount = baseAmounts.supplyAmount || "";
      result.bringQuoteBaseVatAmount = baseAmounts.vatAmount || "";
      result.bringQuoteMarkupRate = BRING_QUOTE_MARKUP_RATE;
      result.bringQuoteMarkupAmount = Math.max(0, sheetAmounts.totalAmount - baseAmounts.totalAmount);
      result.bringQuoteItems = fillResult && fillResult.bringItems || [];
      result.amountSource = "bring_sheet";
      result.amountStatus = "확인필요";
      result.bringQuoteAmountSyncedAt = new Date().toISOString();
      result.extractionMemo = removeQuoteMemo_(result.extractionMemo, "금액 확인 필요");
    }
    if (fillResult && fillResult.businessApplied) {
      if (fillResult.vendor && fillResult.vendor.name) {
        result.vendor = fillResult.vendor;
        result.resolvedVendorInfo = fillResult.vendor;
        result.vendorName = fillResult.vendor.name;
        result.vendorInfoSource = "business_registration";
      }
      result.businessRegistrationAppliedAt = new Date().toISOString();
      result.businessRegistrationDocId = fillResult.businessVendor && fillResult.businessVendor.docId || "";
      result.extractionMemo = appendQuoteMemo_(result.extractionMemo, "사업자등록증 정보로 브링 엑셀 빈칸 보충");
    }
    if (fillResult && fillResult.mineruSupplementApplied) {
      result.extractionMemo = appendQuoteMemo_(result.extractionMemo, fillResult.mineruSupplementMessage || "MinerU OCR로 사업자등록증 빈칸 보충");
    }

    const exported = exportBringQuoteXlsx_(copied.getId(), fileNameBase + ".xlsx", bringFolder);
    if (exported.ok) {
      result.bringQuoteXlsxName = exported.fileName;
      result.bringQuoteXlsxUrl = exported.fileUrl;
      result.bringQuoteXlsxId = exported.fileId;
    } else {
      result.bringQuoteStatus = "xlsx_failed";
      result.bringQuoteType = "failed";
      result.extractionMemo = [result.extractionMemo, "XLSX 내보내기 실패: " + exported.message].filter(Boolean).join(" / ");
    }
  } catch (err) {
    result.bringQuoteStatus = "template_failed";
    result.bringQuoteType = "failed";
    result.extractionStatus = result.extractionStatus === "추출완료" ? "확인필요" : result.extractionStatus;
    result.extractionMemo = [result.extractionMemo, "브링 양식 생성 실패: " + err.message].filter(Boolean).join(" / ");
  } finally {
    trashDriveFileQuietly_(copied);
  }
  return result;
}

function extractQuoteDataFromUpload_(blob, mimeType, fileName, fallbackAmount, casePayload, analysisFolder) {
  const mineruResult = analyzeQuoteWithMinerU_(blob, mimeType, fileName, casePayload, analysisFolder);
  if (mineruResult.ok) {
    const text = mineruResult.markdown || mineruResult.text || "";
    const amounts = extractQuoteAmountsFromMinerU_(mineruResult, fallbackAmount, text);
    const items = extractQuoteItemsFromMinerU_(mineruResult, amounts, casePayload, text);
    const vendorInfo = extractQuoteVendorInfo_(text, mineruResult, fileName);
    const vendorName = vendorInfo.name || cleanExtractedVendorName_(mineruResult.vendorName) || extractQuoteVendorName_(text);
    let status = "확인필요";
    if (amounts.totalAmount && items.length && !amounts.usedFallbackOnly) status = "추출완료";

    const memo = [
      "MinerU 분석완료",
      mineruResult.warnings && mineruResult.warnings.length ? "주의: " + mineruResult.warnings.join(", ") : "",
      amounts.usedFallbackOnly ? "분석 결과에서 금액을 확정하지 못해 입력 금액을 사용했습니다." : "",
      !amounts.totalAmount ? "금액 확인 필요" : "",
      items.length && items[0].fallback ? "품목 추출이 어려워 기본 품목 1줄로 생성했습니다." : ""
    ].filter(Boolean).join(" / ");

    return {
      status: status,
      memo: memo,
      text: text,
      textPreview: text.replace(/\s+/g, " ").trim().slice(0, 5000),
      vendorName: vendorName,
      vendorInfo: vendorInfo,
      fileNameVendorName: vendorInfo.fileNameVendorName || extractQuoteVendorNameFromFileName_(fileName),
      supplyAmount: amounts.supplyAmount || "",
      vatAmount: amounts.vatAmount || "",
      totalAmount: amounts.totalAmount || "",
      items: items,
      analysisEngine: "mineru",
      analysisStatus: "MinerU 분석완료",
      analysisStatusCode: "mineru_ok",
      analysisConfidence: mineruResult.confidence || "",
      analysisWarnings: mineruResult.warnings || [],
      analysisMarkdownUrl: mineruResult.markdownUrl || "",
      analysisMarkdownFileId: mineruResult.markdownFileId || "",
      analysisJsonUrl: mineruResult.jsonUrl || "",
      analysisJsonFileId: mineruResult.jsonFileId || ""
    };
  }

  const textResult = extractQuoteText_(blob, mimeType, fileName);
  const text = textResult.text || "";
  const amounts = extractQuoteAmounts_(text, fallbackAmount);
  const items = extractQuoteItems_(text, amounts, casePayload);
  const vendorInfo = extractQuoteVendorInfo_(text, mineruResult, fileName);
  const vendorName = vendorInfo.name || extractQuoteVendorName_(text);
  let status = "확인필요";
  if (!textResult.ok) {
    status = "추출실패";
  } else if (amounts.totalAmount && items.length && !amounts.usedFallbackOnly) {
    status = "추출완료";
  }

  const memo = [
    mineruResult.message || "",
    textResult.message || "",
    amounts.usedFallbackOnly ? "파일에서 금액을 찾지 못해 입력 금액을 사용했습니다." : "",
    !amounts.totalAmount ? "금액 확인 필요" : "",
    items.length && items[0].fallback ? "품목 추출이 어려워 기본 품목 1줄로 생성했습니다." : ""
  ].filter(Boolean).join(" / ");
  const fallbackSucceeded = !!(textResult.ok && (vendorName || amounts.totalAmount || (items.length && !items[0].fallback)));
  const fallbackStatus = mineruResult.manual
    ? "수동확인"
    : fallbackSucceeded || mineruResult.skipped
      ? "기본 분석"
      : "MinerU 분석실패";
  const fallbackStatusCode = mineruResult.manual
    ? "manual_required"
    : fallbackSucceeded || mineruResult.skipped
      ? "local_fallback"
      : (mineruResult.statusCode || "mineru_failed");

  return {
    status: status,
    memo: memo,
    text: text,
    textPreview: text.replace(/\s+/g, " ").trim().slice(0, 5000),
    vendorName: vendorName,
    vendorInfo: vendorInfo,
    fileNameVendorName: vendorInfo.fileNameVendorName || extractQuoteVendorNameFromFileName_(fileName),
    supplyAmount: amounts.supplyAmount || "",
    vatAmount: amounts.vatAmount || "",
    totalAmount: amounts.totalAmount || "",
    items: items,
    analysisEngine: mineruResult.skipped ? "local_fallback" : "mineru_fallback",
    analysisStatus: fallbackStatus,
    analysisStatusCode: fallbackStatusCode,
    analysisConfidence: "",
    analysisWarnings: mineruResult.message ? [mineruResult.message] : [],
    analysisMarkdownUrl: "",
    analysisMarkdownFileId: "",
    analysisJsonUrl: "",
    analysisJsonFileId: ""
  };
}

function extractBusinessRegistrationData_(blob, mimeType, fileName, casePayload, analysisFolder) {
  const mineruResult = analyzeQuoteWithMinerU_(blob, mimeType, fileName, casePayload, analysisFolder);
  let text = "";
  let textMessage = "";
  let analysisEngine = mineruResult.skipped ? "local_fallback" : "mineru_fallback";
  let analysisStatus = mineruResult.ok ? "MinerU 분석완료" : (mineruResult.manual ? "수동확인" : "기본 분석");
  let analysisStatusCode = mineruResult.ok ? "mineru_ok" : (mineruResult.statusCode || "local_fallback");

  if (mineruResult.ok) {
    text = mineruResult.markdown || mineruResult.text || "";
    analysisEngine = "mineru";
  } else {
    const textResult = extractQuoteText_(blob, mimeType, fileName);
    text = textResult.text || "";
    textMessage = textResult.message || "";
    if (!textResult.ok && !mineruResult.message) analysisStatus = "추출실패";
  }

  let vendorInfo = extractBusinessRegistrationVendorInfo_(text, mineruResult, fileName);
  const mineruSupplement = analyzeBusinessRegistrationWithMinerUIfNeeded_(blob, mimeType, fileName, casePayload, vendorInfo, mineruResult);
  if (mineruSupplement && mineruSupplement.vendorInfo) {
    vendorInfo = mineruSupplement.vendorInfo;
  }
  const hasImportantInfo = !!(vendorInfo.name || vendorInfo.businessNo || vendorInfo.ceo || vendorInfo.address || vendorInfo.type || vendorInfo.category || vendorInfo.phone);
  const status = hasImportantInfo ? "추출완료" : "확인필요";
  const memo = [
    mineruResult.ok ? "MinerU 분석완료" : (mineruResult.message || ""),
    mineruSupplement && mineruSupplement.message ? mineruSupplement.message : "",
    textMessage,
    hasImportantInfo ? "" : "사업자등록증 핵심 정보를 자동 확인하지 못했습니다."
  ].filter(Boolean).join(" / ");

  return {
    status: status,
    memo: memo,
    text: text,
    textPreview: text.replace(/\s+/g, " ").trim().slice(0, 5000),
    vendorInfo: vendorInfo,
    analysisEngine: analysisEngine,
    analysisStatus: analysisStatus,
    analysisStatusCode: analysisStatusCode,
    analysisWarnings: (mineruResult.warnings || (mineruResult.message ? [mineruResult.message] : [])).concat(mineruSupplement && mineruSupplement.warnings || []),
    analysisMarkdownUrl: mineruResult.markdownUrl || "",
    analysisMarkdownFileId: mineruResult.markdownFileId || "",
    analysisJsonUrl: mineruResult.jsonUrl || "",
    analysisJsonFileId: mineruResult.jsonFileId || "",
    mineruSupplementUsed: !!(mineruSupplement && mineruSupplement.used),
    mineruSupplementMessage: mineruSupplement && mineruSupplement.message || "",
    supplierMissingFields: getMissingBringSupplierFields_(vendorInfo)
  };
}

function extractBusinessRegistrationVendorInfo_(text, mineruResult, fileName) {
  const source = String(text || "");
  const quoteInfo = extractQuoteVendorInfo_(source, mineruResult || {}, fileName);
  const structuredInfo = extractQuoteVendorInfoFromObject_(mineruResult || {});
  const businessInfo = extractBusinessRegistrationVendorInfoFromText_(source);
  const fileNameInfo = cleanVendorInfo_({
    name: extractBusinessRegistrationVendorNameFromFileName_(fileName) || extractQuoteVendorNameFromFileName_(fileName)
  });
  let merged = mergeVendorInfoObjects_(quoteInfo, structuredInfo);
  merged = mergeVendorInfoObjects_(merged, businessInfo);
  if (!merged.name) merged.name = fileNameInfo.name || "";
  merged.source = businessInfo.name || businessInfo.businessNo || businessInfo.ceo || businessInfo.address || businessInfo.type || businessInfo.category || businessInfo.phone
    ? "business_registration"
    : structuredInfo.name || structuredInfo.businessNo || structuredInfo.ceo || structuredInfo.address || structuredInfo.type || structuredInfo.category || structuredInfo.phone
      ? "mineru_structured"
      : quoteInfo.source || (fileNameInfo.name ? "file_name" : "");
  return cleanVendorInfo_(merged);
}

function getMissingBringSupplierFields_(vendorInfo) {
  vendorInfo = cleanVendorInfo_(vendorInfo || {});
  const missing = [];
  if (!vendorInfo.businessNo) missing.push("businessNo");
  if (!vendorInfo.name) missing.push("name");
  if (!vendorInfo.ceo) missing.push("ceo");
  if (!vendorInfo.address && !vendorInfo.addressFromVendorList) missing.push("address");
  if (!vendorInfo.type) missing.push("type");
  if (!vendorInfo.category) missing.push("category");
  if (!vendorInfo.phone) missing.push("phone");
  if (!vendorInfo.email) missing.push("email");
  return missing;
}

function hasMissingSupplierFields_(vendorInfo) {
  return getMissingBringSupplierFields_(vendorInfo).length > 0;
}

function fillVendorInfoMissingFields_(base, supplement) {
  return mergeVendorInfoObjects_(cleanVendorInfo_(supplement || {}), cleanVendorInfo_(base || {}));
}

function analyzeBusinessRegistrationWithMinerUIfNeeded_(blob, mimeType, fileName, casePayload, vendorInfo, currentMineruResult) {
  const current = cleanVendorInfo_(vendorInfo || {});
  const missingBefore = getMissingBringSupplierFields_(current);
  if (!missingBefore.length) {
    return { vendorInfo: current, used: false, message: "", warnings: [] };
  }
  if (currentMineruResult && currentMineruResult.ok) {
    return { vendorInfo: current, used: false, message: "", warnings: [] };
  }

  const config = getMineruConfig_();
  if (!config.enabled || !config.apiKey) {
    return {
      vendorInfo: current,
      used: false,
      message: "MinerU 토큰 없음",
      warnings: ["MinerU 토큰 없음"],
      missingFields: missingBefore
    };
  }

  const mineruResult = analyzeQuoteWithMinerU_(blob, mimeType, fileName, casePayload, null, { forceSync: true });
  if (!mineruResult.ok) {
    const message = mineruResult.message ? "MinerU OCR 보충 실패: " + mineruResult.message : "MinerU OCR 보충 실패";
    return {
      vendorInfo: current,
      used: false,
      message: message,
      warnings: [message],
      missingFields: missingBefore
    };
  }

  const ocrText = mineruResult.markdown || mineruResult.text || "";
  const ocrInfo = extractBusinessRegistrationVendorInfo_(ocrText, mineruResult, fileName);
  const merged = fillVendorInfoMissingFields_(current, ocrInfo);
  const missingAfter = getMissingBringSupplierFields_(merged);
  const filledFields = missingBefore.filter(field => missingAfter.indexOf(field) === -1);
  if (!filledFields.length) {
    return {
      vendorInfo: merged,
      used: false,
      message: "MinerU OCR 보충값 없음",
      warnings: mineruResult.warnings || [],
      missingFields: missingAfter
    };
  }

  merged.source = current.source || "business_registration";
  return {
    vendorInfo: cleanVendorInfo_(merged),
    used: true,
    message: "MinerU OCR로 사업자등록증 빈칸 보충",
    warnings: mineruResult.warnings || [],
    filledFields: filledFields,
    missingFields: missingAfter
  };
}

function matchBusinessRegistrationVendor_(vendorInfo, payload, casePayload) {
  const targetName = cleanExtractedVendorName_(vendorInfo && vendorInfo.name || "");
  const targetBusinessNo = cleanBusinessNo_(vendorInfo && vendorInfo.businessNo || "");
  const candidates = collectBusinessRegistrationVendorCandidates_(payload, casePayload);
  if (!targetName && !targetBusinessNo) {
    return { status: "unmatched", vendorId: "", vendorName: "", memo: "업체명/사업자번호를 찾지 못했습니다." };
  }

  const businessMatches = targetBusinessNo
    ? candidates.filter(v => cleanBusinessNo_(v.businessNo || "") === targetBusinessNo)
    : [];
  if (businessMatches.length === 1) return businessRegistrationMatchResult_(businessMatches[0], "사업자번호 일치");
  if (businessMatches.length > 1) return { status: "multiple", vendorId: "", vendorName: targetName, memo: "사업자번호가 같은 후보가 여러 개입니다." };

  const targetKey = vendorMatchKey_(targetName);
  const exact = targetKey ? candidates.filter(v => vendorMatchKey_(v.name) === targetKey) : [];
  if (exact.length === 1) return businessRegistrationMatchResult_(exact[0], "업체명 일치");
  if (exact.length > 1) return { status: "multiple", vendorId: "", vendorName: targetName, memo: "같은 업체명 후보가 여러 개입니다." };

  const similar = targetName ? candidates.filter(v => vendorNameLooseMatch_(targetName, v.name)) : [];
  if (similar.length === 1) return businessRegistrationMatchResult_(similar[0], "유사 업체명 일치");
  if (similar.length > 1) return { status: "multiple", vendorId: "", vendorName: targetName, memo: "유사 업체명 후보가 여러 개입니다." };

  return { status: "unmatched", vendorId: "", vendorName: targetName, memo: "일치하는 업체 후보를 찾지 못했습니다." };
}

function collectBusinessRegistrationVendorCandidates_(payload, casePayload) {
  const rows = [];
  if (Array.isArray(payload && payload.vendors)) {
    payload.vendors.forEach(v => rows.push(normalizeQuoteVendor_(v, "")));
  }
  Object.values((casePayload && casePayload.quoteFiles) || {}).filter(Boolean).forEach(quote => {
    const vendor = cleanVendorInfo_(quote.resolvedVendorInfo || quote.vendor || {});
    if (!vendor.name) vendor.name = cleanExtractedVendorName_(quote.vendorName || "");
    if (vendor.name || vendor.businessNo || vendor.phone) rows.push(vendor);
  });
  const seen = {};
  return rows
    .map(v => cleanVendorInfo_(v))
    .filter(v => v.name || v.businessNo || v.phone)
    .filter(v => {
      const key = [v.id, vendorMatchKey_(v.name), v.businessNo, v.phone].join("|");
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
}

function businessRegistrationMatchResult_(candidate, memo) {
  return {
    status: "matched",
    vendorId: candidate.id || "",
    vendorName: candidate.name || "",
    memo: memo || "자동 연결"
  };
}

function getMineruConfig_() {
  const props = PropertiesService.getScriptProperties();
  const apiKey = String(props.getProperty("MINERU_API_KEY") || "").trim();
  const apiUrl = String(props.getProperty("MINERU_API_URL") || (apiKey ? "https://mineru.net" : "")).trim().replace(/\/$/, "");
  const modelVersion = String(props.getProperty("MINERU_MODEL_VERSION") || "vlm").trim();
  const language = String(props.getProperty("MINERU_LANGUAGE") || "korean").trim();
  const syncEnabled = String(props.getProperty("MINERU_SYNC_ENABLED") || "").toLowerCase() === "true";
  const maxWaitSeconds = Number(props.getProperty("MINERU_MAX_WAIT_SECONDS") || 20);
  return {
    apiUrl: apiUrl,
    apiKey: apiKey,
    modelVersion: modelVersion,
    language: language,
    maxWaitSeconds: maxWaitSeconds,
    syncEnabled: syncEnabled,
    enabled: !!apiUrl
  };
}

function isMineruNetEndpoint_(apiUrl) {
  return /(^https:\/\/)?([^\/]+\.)?mineru\.net$/i.test(String(apiUrl || "").replace(/\/$/, ""));
}

function mineruNetUrl_(config, path) {
  return String(config.apiUrl || "https://mineru.net").replace(/\/$/, "") + path;
}

function mineruNetFetchJson_(url, method, token, payload) {
  const options = {
    method: method,
    headers: {
      Authorization: "Bearer " + token,
      Accept: "*/*"
    },
    muteHttpExceptions: true
  };
  if (payload !== undefined && payload !== null) {
    options.contentType = "application/json; charset=utf-8";
    options.payload = JSON.stringify(payload);
  }
  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  const text = response.getContentText() || "{}";
  let data = {};
  try {
    data = JSON.parse(text);
  } catch (err) {
    data = { code: -1, msg: text.slice(0, 300) };
  }
  data.httpCode = code;
  return data;
}

function safeMineruDataId_(value) {
  return String(value || Utilities.getUuid())
    .replace(/[^A-Za-z0-9_.-]/g, "_")
    .slice(0, 120) || Utilities.getUuid();
}

function isOcrFriendlyFile_(fileName, mimeType) {
  const ext = String(fileName || "").split(".").pop().toLowerCase();
  return ["pdf", "jpg", "jpeg", "png", "bmp", "webp"].includes(ext) || /^image\//.test(String(mimeType || ""));
}

function analyzeQuoteWithMineruNet_(blob, mimeType, fileName, casePayload, analysisFolder, config) {
  if (!config.apiKey) {
    return {
      ok: false,
      statusCode: "mineru_failed",
      message: "MinerU 토큰 미설정: MINERU_API_KEY를 스크립트 속성에 넣어주세요."
    };
  }

  try {
    const dataId = safeMineruDataId_((casePayload.ticketNo || casePayload.id || "case") + "_" + Utilities.getUuid().slice(0, 8));
    const createPayload = {
      files: [{
        name: fileName,
        data_id: dataId,
        is_ocr: isOcrFriendlyFile_(fileName, mimeType)
      }],
      model_version: config.modelVersion || "vlm",
      language: config.language || "korean",
      enable_table: true,
      enable_formula: false
    };
    const created = mineruNetFetchJson_(mineruNetUrl_(config, "/api/v4/file-urls/batch"), "post", config.apiKey, createPayload);
    if (created.httpCode < 200 || created.httpCode >= 300 || created.code !== 0) {
      return {
        ok: false,
        statusCode: "mineru_failed",
        message: "MinerU 업로드 URL 생성 실패: " + (created.msg || ("HTTP " + created.httpCode))
      };
    }

    const batchId = created.data && created.data.batch_id;
    const uploadUrl = created.data && created.data.file_urls && created.data.file_urls[0];
    if (!batchId || !uploadUrl) {
      return {
        ok: false,
        statusCode: "mineru_failed",
        message: "MinerU 업로드 URL 응답이 비어 있습니다."
      };
    }

    const uploadBlob = blob.copyBlob()
      .setContentType("application/octet-stream")
      .setName(fileName || "quote");
    const putResponse = UrlFetchApp.fetch(uploadUrl, {
      method: "put",
      contentType: "application/octet-stream",
      payload: uploadBlob,
      muteHttpExceptions: true
    });
    const putCode = putResponse.getResponseCode();
    if (putCode < 200 || putCode >= 300) {
      return {
        ok: false,
        statusCode: "mineru_failed",
        message: "MinerU 파일 업로드 실패: HTTP " + putCode
      };
    }

    const started = Date.now();
    const maxWaitMs = Math.max(15, Number(config.maxWaitSeconds || 75)) * 1000;
    let lastState = "";
    let lastMessage = "";
    while (Date.now() - started < maxWaitMs) {
      Utilities.sleep(3500);
      const checked = mineruNetFetchJson_(mineruNetUrl_(config, "/api/v4/extract-results/batch/" + encodeURIComponent(batchId)), "get", config.apiKey);
      if (checked.httpCode < 200 || checked.httpCode >= 300 || checked.code !== 0) {
        lastMessage = checked.msg || ("HTTP " + checked.httpCode);
        continue;
      }
      const results = checked.data && checked.data.extract_result;
      const result = Array.isArray(results) ? results[0] : results;
      if (!result) {
        lastMessage = "결과가 아직 비어 있습니다.";
        continue;
      }
      lastState = result.state || "";
      if (lastState === "failed") {
        return {
          ok: false,
          statusCode: "mineru_failed",
          message: "MinerU 분석 실패: " + (result.err_msg || "분석 실패")
        };
      }
      if (lastState === "done" && result.full_zip_url) {
        const parsed = downloadMineruNetZipResult_(result.full_zip_url);
        const data = {
          markdown: parsed.markdown,
          json: parsed.json,
          tables: parsed.tables || [],
          vendorName: "",
          items: [],
          supplyAmount: "",
          vatAmount: "",
          totalAmount: "",
          confidence: parsed.markdown ? "mineru-net" : "",
          warnings: parsed.warnings || [],
          mineruNet: {
            batchId: batchId,
            dataId: dataId,
            fullZipUrl: result.full_zip_url,
            state: lastState
          }
        };
        const saved = saveMineruAnalysisFiles_(analysisFolder, fileName, casePayload, data);
        return {
          ok: true,
          markdown: parsed.markdown,
          json: parsed.json,
          tables: parsed.tables || [],
          vendorName: "",
          items: [],
          supplyAmount: "",
          vatAmount: "",
          totalAmount: "",
          confidence: "mineru.net",
          warnings: parsed.warnings || [],
          markdownUrl: saved.markdownUrl || "",
          markdownFileId: saved.markdownFileId || "",
          jsonUrl: saved.jsonUrl || "",
          jsonFileId: saved.jsonFileId || ""
        };
      }
    }

    return {
      ok: false,
      statusCode: "mineru_failed",
      message: "MinerU 분석 대기 시간 초과: " + (lastState || lastMessage || "처리중")
    };
  } catch (err) {
    return {
      ok: false,
      statusCode: "mineru_failed",
      message: "MinerU 직접 연결 실패: " + err.message
    };
  }
}

function downloadMineruNetZipResult_(zipUrl) {
  const result = { markdown: "", json: {}, tables: [], warnings: [] };
  try {
    const response = UrlFetchApp.fetch(zipUrl, { method: "get", muteHttpExceptions: true });
    const code = response.getResponseCode();
    if (code < 200 || code >= 300) {
      result.warnings.push("MinerU 결과 ZIP 다운로드 실패: HTTP " + code);
      return result;
    }
    const files = Utilities.unzip(response.getBlob());
    const mdFiles = files
      .filter(file => /\.md$/i.test(file.getName()))
      .sort((a, b) => b.getBytes().length - a.getBytes().length);
    if (mdFiles.length) {
      result.markdown = mdFiles[0].getDataAsString("UTF-8");
    }

    const jsonFiles = files.filter(file => /\.json$/i.test(file.getName()));
    const parsedJson = {};
    jsonFiles.forEach(file => {
      try {
        parsedJson[file.getName()] = JSON.parse(file.getDataAsString("UTF-8"));
      } catch (err) {
        parsedJson[file.getName()] = file.getDataAsString("UTF-8").slice(0, 1000);
      }
    });
    result.json = parsedJson;
    return result;
  } catch (err) {
    result.warnings.push("MinerU 결과 ZIP 처리 실패: " + err.message);
    return result;
  }
}

function analyzeQuoteWithMinerU_(blob, mimeType, fileName, casePayload, analysisFolder, options) {
  options = options || {};
  const forceSync = !!options.forceSync;
  const ext = String(fileName || "").split(".").pop().toLowerCase();
  if (ext === "hwp") {
    return {
      ok: false,
      manual: true,
      statusCode: "manual_required",
      message: "HWP는 MinerU 자동 분석 미지원 파일입니다. 원본 확인이 필요합니다."
    };
  }

  const config = getMineruConfig_();
  if (!config.enabled) {
    return {
      ok: false,
      skipped: true,
      statusCode: "mineru_not_configured",
      message: "MinerU API URL 미설정"
    };
  }
  if (!config.syncEnabled && !forceSync) {
    return {
      ok: false,
      skipped: true,
      statusCode: "mineru_sync_disabled",
      message: "빠른 업로드 모드: MinerU 실시간 분석 생략"
    };
  }
  if (isMineruNetEndpoint_(config.apiUrl) && ext === "hwpx") {
    return {
      ok: false,
      skipped: true,
      statusCode: "mineru_not_supported",
      message: "mineru.net API는 HWPX 직접 업로드를 지원하지 않아 HWPX 텍스트 추출로 처리합니다."
    };
  }
  if (isMineruNetEndpoint_(config.apiUrl)) {
    return analyzeQuoteWithMineruNet_(blob, mimeType, fileName, casePayload, analysisFolder, config);
  }

  try {
    const payload = {
      fileName: fileName,
      mimeType: mimeType || inferQuoteMimeType_(fileName),
      fileBase64: Utilities.base64Encode(blob.getBytes()),
      caseId: casePayload.ticketNo || casePayload.id || ""
    };
    const headers = {};
    if (config.apiKey) headers.Authorization = "Bearer " + config.apiKey;

    const endpoint = /\/analyze-quote$/i.test(config.apiUrl)
      ? config.apiUrl
      : config.apiUrl + "/analyze-quote";
    const response = UrlFetchApp.fetch(endpoint, {
      method: "post",
      contentType: "application/json; charset=utf-8",
      headers: headers,
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    const body = response.getContentText() || "{}";
    if (code < 200 || code >= 300) {
      return {
        ok: false,
        statusCode: "mineru_failed",
        message: "MinerU 분석실패: HTTP " + code + " / " + body.slice(0, 180)
      };
    }

    const data = JSON.parse(body);
    if (data && data.ok === false) {
      return {
        ok: false,
        statusCode: "mineru_failed",
        message: "MinerU 분석실패: " + (data.message || "응답 실패")
      };
    }

    const saved = saveMineruAnalysisFiles_(analysisFolder, fileName, casePayload, data);
    return {
      ok: true,
      markdown: String(data.markdown || data.text || ""),
      json: data.json || data.result || data,
      tables: Array.isArray(data.tables) ? data.tables : [],
      vendorName: data.vendorName || "",
      items: Array.isArray(data.items) ? data.items : [],
      supplyAmount: data.supplyAmount || data.supply || "",
      vatAmount: data.vatAmount || data.vat || "",
      totalAmount: data.totalAmount || data.total || data.amount || "",
      confidence: data.confidence || "",
      warnings: Array.isArray(data.warnings) ? data.warnings.map(String).filter(Boolean) : [],
      markdownUrl: saved.markdownUrl || "",
      markdownFileId: saved.markdownFileId || "",
      jsonUrl: saved.jsonUrl || "",
      jsonFileId: saved.jsonFileId || ""
    };
  } catch (err) {
    return {
      ok: false,
      statusCode: "mineru_failed",
      message: "MinerU 분석실패: " + err.message
    };
  }
}

function saveMineruAnalysisFiles_(folder, fileName, casePayload, data) {
  return {};
}

function extractQuoteAmountsFromMinerU_(mineruResult, fallbackAmount, text) {
  let supply = parseMoneyValue_(mineruResult.supplyAmount);
  let vat = parseMoneyValue_(mineruResult.vatAmount);
  let total = parseMoneyValue_(mineruResult.totalAmount);
  const local = extractQuoteAmounts_(text, fallbackAmount);

  if (!total && supply && vat) total = supply + vat;
  if (!total) total = local.totalAmount || "";
  if (!supply) supply = local.supplyAmount || "";
  if (!vat) vat = local.vatAmount || "";
  if (!supply && total && vat) supply = total - vat;
  if (!vat && total && supply) vat = total - supply;
  if (!supply && !vat && total) {
    supply = Math.round(total / 1.1);
    vat = total - supply;
  }

  return {
    supplyAmount: supply || "",
    vatAmount: vat || "",
    totalAmount: total || "",
    usedFallbackOnly: !parseMoneyValue_(mineruResult.totalAmount) && !!local.usedFallbackOnly
  };
}

function extractQuoteItemsFromMinerU_(mineruResult, amounts, casePayload, text) {
  const rawItems = Array.isArray(mineruResult.items) ? mineruResult.items : [];
  const items = rawItems
    .map(item => normalizeMineruItem_(item))
    .filter(item => item.product)
    .slice(0, 12);
  if (items.length) return items;
  return extractQuoteItems_(text, amounts, casePayload);
}

function normalizeMineruItem_(item) {
  if (!item || typeof item !== "object") return {};
  const total = parseMoneyValue_(item.total || item.totalAmount || item.amount || item.price);
  const unitPrice = parseMoneyValue_(item.unitPrice || item.supplyAmount || item.supply || "");
  const vat = parseMoneyValue_(item.vat || item.vatAmount || "");
  return {
    product: String(item.product || item.name || item.item || item.description || "").replace(/\s+/g, " ").trim().slice(0, 80),
    unit: String(item.unit || item.quantity || item.qty || "식").replace(/\s+/g, " ").trim().slice(0, 20),
    unitPrice: unitPrice || (total ? Math.round(total / 1.1) : ""),
    vat: vat || (total ? total - Math.round(total / 1.1) : ""),
    total: total || "",
    note: String(item.note || "MinerU 자동추출").slice(0, 60)
  };
}

function extractQuoteText_(blob, mimeType, fileName) {
  const ext = String(fileName || "").split(".").pop().toLowerCase();
  if (ext === "xlsx" || mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    const text = extractXlsxText_(blob);
    return text
      ? { ok: true, text: text, message: "XLSX 텍스트 추출 완료" }
      : { ok: false, text: "", message: "XLSX 텍스트를 추출하지 못했습니다." };
  }
  if (ext === "docx" || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const text = extractDocxTextFromBlob_(blob);
    return text
      ? { ok: true, text: text, message: "DOCX 텍스트 추출 완료" }
      : { ok: false, text: "", message: "DOCX 텍스트를 추출하지 못했습니다." };
  }
  if (ext === "hwpx" || mimeType === "application/vnd.hancom.hwpx") {
    const text = extractHwpxText_(blob);
    return text
      ? { ok: true, text: text, message: "HWPX 텍스트 추출 완료" }
      : { ok: false, text: "", message: "HWPX 텍스트를 추출하지 못했습니다. 원본 확인이 필요합니다." };
  }
  if (ext === "hwp" || ["application/x-hwp", "application/haansofthwp", "application/vnd.hancom.hwp"].includes(mimeType)) {
    return { ok: true, text: "", message: "HWP는 자동 추출 미지원 파일입니다. 원본을 저장했고 견적 내용은 수동 확인이 필요합니다." };
  }
  if (["pdf", "jpg", "jpeg", "png"].includes(ext) || /^image\//.test(mimeType) || mimeType === "application/pdf") {
    return extractTextWithDriveOcr_(blob, fileName);
  }
  return { ok: false, text: "", message: "이 파일 형식은 자동 텍스트 추출을 지원하지 않아 원본만 저장했습니다." };
}

function extractXlsxText_(blob) {
  try {
    const blobs = unzipOfficeBlob_(blob);
    return blobs
      .filter(item => /^xl\/(?:sharedStrings|worksheets\/sheet\d+)\.xml$/.test(item.getName()))
      .map(item => decodeSpreadsheetXmlText_(item.getDataAsString("UTF-8")))
      .filter(Boolean)
      .join("\n");
  } catch (err) {
    Logger.log("XLSX 텍스트 추출 실패: " + err.message);
    return "";
  }
}

function extractDocxTextFromBlob_(blob) {
  try {
    const blobs = unzipOfficeBlob_(blob);
    const xml = blobs
      .filter(item => /^word\/(?:document|header\d*|footer\d*)\.xml$/.test(item.getName()))
      .map(item => item.getDataAsString("UTF-8"))
      .join("\n");
    return decodeXmlText_(xml);
  } catch (err) {
    Logger.log("업로드 DOCX 본문 추출 실패: " + err.message);
    return "";
  }
}

function extractHwpxText_(blob) {
  try {
    const blobs = unzipOfficeBlob_(blob);
    const previewText = blobs
      .filter(item => /^Preview\/PrvText\.txt$/i.test(item.getName()))
      .map(item => item.getDataAsString("UTF-8"))
      .join("\n")
      .replace(/\s+/g, " ")
      .trim();
    if (previewText) return previewText;

    const xml = blobs
      .filter(item => /^Contents\/(?:section\d+|header\d*|footer\d*)\.xml$/i.test(item.getName()))
      .map(item => item.getDataAsString("UTF-8"))
      .join("\n");
    return decodeXmlText_(xml);
  } catch (err) {
    Logger.log("HWPX 텍스트 추출 실패: " + err.message);
    return "";
  }
}

function unzipOfficeBlob_(blob) {
  const name = typeof blob.getName === "function" && blob.getName()
    ? blob.getName()
    : "office-file.zip";
  return Utilities.unzip(Utilities.newBlob(blob.getBytes(), "application/zip", name));
}

function decodeSpreadsheetXmlText_(xml) {
  return String(xml || "")
    .replace(/<row[^>]*>/g, "\n")
    .replace(/<\/c>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function extractTextWithDriveOcr_(blob, fileName) {
  if (typeof Drive === "undefined" || !Drive.Files || !Drive.Files.create) {
    return {
      ok: false,
      text: "",
      message: "PDF/이미지 추출에는 Apps Script 고급 Google 서비스의 Drive API(v3)가 필요합니다."
    };
  }

  let tempId = "";
  try {
    const resource = {
      name: "BRING OCR " + safeDriveName_(fileName || "quote"),
      mimeType: "application/vnd.google-apps.document"
    };
    const copiedBlob = blob.copyBlob().setName(fileName || "quote");
    const created = Drive.Files.create(resource, copiedBlob, { fields: "id" });
    tempId = created && created.id ? created.id : "";
    if (!tempId) return { ok: false, text: "", message: "Drive OCR 임시 문서 ID를 받지 못했습니다." };
    const text = DocumentApp.openById(tempId).getBody().getText();
    return text
      ? { ok: true, text: text, message: "Drive OCR 텍스트 추출 완료" }
      : { ok: false, text: "", message: "Drive OCR 결과 텍스트가 비어 있습니다." };
  } catch (err) {
    return { ok: false, text: "", message: "Drive OCR 추출 실패: " + err.message };
  } finally {
    if (tempId) {
      try { DriveApp.getFileById(tempId).setTrashed(true); } catch (err) {}
    }
  }
}

function extractQuoteAmounts_(text, fallbackAmount) {
  let supply = extractAmountNearLabels_(text, ["공급가액", "공급가", "공급 금액", "공급가격"]);
  let vat = extractAmountNearLabels_(text, ["부가세", "VAT", "세액", "부가 가치세"]);
  let total = extractTotalQuoteAmount_(text);
  const fallback = parseMoneyValue_(fallbackAmount);
  let usedFallbackOnly = false;

  if (!total && supply && vat) total = supply + vat;
  if (!total) total = bestQuoteAmountCandidate_(text);
  if (!total && fallback) {
    total = fallback;
    usedFallbackOnly = true;
  }
  if (total && total < 1000) total = 0;
  if (!supply && total && vat) supply = total - vat;
  if (!vat && total && supply) vat = total - supply;
  if (!supply && !vat && total) {
    supply = Math.round(total / 1.1);
    vat = total - supply;
  }
  if (!total && supply && vat) total = supply + vat;

  return {
    supplyAmount: supply || "",
    vatAmount: vat || "",
    totalAmount: total || "",
    usedFallbackOnly: usedFallbackOnly
  };
}

function extractTotalQuoteAmount_(text) {
  const totalLabels = ["합계금액", "합계 금액", "총 합계", "총계", "총액", "견적금액", "견적 금액", "청구금액", "청구 금액", "총 견적", "합계", "합 계"];
  const lines = normalizeQuoteTextLines_(text);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const compactLine = line.replace(/\s+/g, "");
    if (!totalLabels.some(label => compactLine.indexOf(label.replace(/\s+/g, "")) !== -1)) continue;

    const value = bestMoneyValueFromSegment_(line);
    if (value >= 1000) return value;

    for (let offset = 1; offset <= 2; offset++) {
      const nextLine = lines[i + offset] || "";
      if (!nextLine || isNonTotalAmountLine_(nextLine)) continue;
      const nextValue = bestMoneyValueFromSegment_(nextLine);
      if (nextValue >= 1000) return nextValue;
    }
  }

  return extractAmountNearLabels_(text, totalLabels);
}

function normalizeQuoteTextLines_(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[|｜]/g, " ")
    .split(/\n+/)
    .map(line => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function bestMoneyValueFromSegment_(segment) {
  const candidates = extractMoneyCandidates_(segment);
  if (!candidates.length) return 0;
  return candidates.reduce((best, item) => item.value > best.value ? item : best, candidates[0]).value;
}

function isNonTotalAmountLine_(line) {
  const compact = String(line || "").replace(/\s+/g, "");
  if (/공급가|공급금액|부가세|VAT|세액|단가|수량|규격|품목|사업자|전화|연락처/.test(compact)) return true;
  return false;
}

function extractAmountNearLabels_(text, labels) {
  const source = String(text || "").replace(/\s+/g, " ");
  for (const label of labels) {
    const pattern = new RegExp(escapeRegex_(label) + "[^0-9]{0,40}((?:\\d{1,3}(?:,\\d{3})+|\\d{4,})(?:\\.\\d+)?\\s*(?:만원|만|원)?)", "i");
    const match = source.match(pattern);
    const value = match ? parseMoneyValue_(match[1]) : 0;
    if (value >= 1000) return value;
  }
  return 0;
}

function extractMoneyValues_(text) {
  return extractMoneyCandidates_(text).map(item => item.value);
}

function bestQuoteAmountCandidate_(text) {
  const candidates = extractMoneyCandidates_(text);
  if (!candidates.length) return 0;
  return candidates.reduce((best, item) => item.value > best.value ? item : best, candidates[0]).value;
}

function extractMoneyCandidates_(text) {
  const source = String(text || "");
  const pattern = /(?:\d{1,3}(?:,\d{3})+|\d{4,})(?:\.\d+)?\s*(?:만원|만|원)?/g;
  const results = [];
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const raw = match[0];
    const value = parseMoneyValue_(raw);
    if (value < 1000 || value > 300000000) continue;
    const start = Math.max(0, match.index - 18);
    const end = Math.min(source.length, pattern.lastIndex + 18);
    const context = source.slice(start, end);
    if (isNonMoneyContext_(raw, context, value)) continue;
    results.push({ raw: raw, value: value, context: context });
  }
  return results;
}

function isNonMoneyContext_(raw, context, value) {
  const compactRaw = String(raw || "").replace(/\s+/g, "");
  const compactContext = String(context || "").replace(/\s+/g, "");
  if (isLikelyYmdDateNumber_(compactRaw)) return true;
  if (/^\d{4}[.\-\/]\d{1,2}[.\-\/]\d{1,2}$/.test(compactRaw)) return true;
  if (/^\d{6,8}$/.test(compactRaw) && /일자|날짜|작성|발행|견적일/.test(compactContext)) return true;
  if (/BR-\d{4}-\d{4}/i.test(compactContext)) return true;
  if (value < 10000 && !/원|만원|만|금액|합계|견적|공급|부가|세액|총액|청구/.test(compactContext)) return true;
  if (/수량|규격|호실|전화|연락처|사업자|등록번호|팩스|우편|페이지|No\.?/i.test(compactContext) && !/원|만원|만/.test(compactRaw)) return true;
  return false;
}

function isLikelyYmdDateNumber_(value) {
  const raw = String(value || "").replace(/[^\d]/g, "");
  if (!/^20\d{6}$/.test(raw)) return false;
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6));
  const day = Number(raw.slice(6, 8));
  if (year < 2020 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function extractQuoteVendorName_(text) {
  const source = String(text || "").replace(/\s+/g, " ").trim();
  if (!source) return "";
  const patterns = [
    /(?:상호|업체명|회사명|공급자|견적업체)\s*[:：]?\s*([가-힣A-Za-z0-9㈜주식회사\.\-\s]{2,30})/,
    /([가-힣A-Za-z0-9㈜주식회사\.\-\s]{2,30})\s*(?:귀하|대표자|사업자번호)/
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    const name = match ? cleanExtractedVendorName_(match[1]) : "";
    if (name) return name;
  }
  return "";
}

function cleanExtractedVendorName_(value) {
  let name = String(value || "")
    .replace(/^(주식회사|\(주\)|㈜)\s*/g, "")
    .replace(/\s*(대표자|대표|사업자등록번호|사업자번호|등록번호|주소|전화번호|전화|연락처|TEL|Tel|tel|이메일|업태|업종|종목|견적|공급자).*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  name = trimQuoteVendorNoise_(name);
  if (!name || name.length < 2 || /견적서|합계|공급가액|부가세|주소|전화|이메일/.test(name) || isGenericQuoteVendorValue_(name)) return "";
  return name.slice(0, 30);
}

function trimQuoteVendorNoise_(value) {
  let name = String(value || "").replace(/\s+/g, " ").trim();
  [
    /\s*(?:대상\s*건물|대상건물|건물명|현장명|현장|민원|호실|호수|객실).*/i,
    /\s+(?:강원도|강원|서울특별시|서울|경기도|경기|인천|부산|대구|대전|광주|울산|세종|충북|충남|전북|전남|경북|경남|제주|원주시|춘천시|강릉시|흥업면|단구동|무실동|문막읍|상지대).*/i,
    /\s+(?:[A-Za-z]?\s*상가|[A-Za-z]?\s*원룸|[A-Za-z]?\s*호실|\d+\s*호).*/i
  ].forEach(pattern => {
    name = name.replace(pattern, "").trim();
  });
  return name;
}

function parseMoneyValue_(value) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const compact = raw.replace(/,/g, "").replace(/\s+/g, "");
  const match = compact.match(/(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  let amount = Number(match[1]);
  if (!Number.isFinite(amount)) return 0;
  if (/만원|만$/.test(compact)) amount *= 10000;
  return Math.round(amount);
}

function extractQuoteItems_(text, amounts, casePayload) {
  const lines = String(text || "")
    .split(/\n| {2,}/)
    .map(line => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const tableItems = extractQuoteTableItems_(text, amounts, casePayload);
  if (tableItems.length && !tableItems[0].fallback) return tableItems;

  const items = [];
  for (const line of lines) {
    if (items.length >= 12) break;
    if (!/[가-힣A-Za-z]/.test(line)) continue;
    if (/합계|총액|부가세|공급가액|사업자|대표자|전화|주소|이메일|견적\s*일자/i.test(line)) continue;
    const moneyMatch = line.match(/(?:\d{1,3}(?:,\d{3})+|\d{4,})(?:\.\d+)?\s*(?:만원|만|원)?(?!.*(?:\d{1,3}(?:,\d{3})+|\d{4,}))/);
    const total = moneyMatch ? parseMoneyValue_(moneyMatch[0]) : 0;
    if (!total) continue;
    const supply = Math.round(total / 1.1);
    const vat = total - supply;
    const product = line
      .replace(moneyMatch[0], "")
      .replace(/^\d+[\).\-]?\s*/, "")
      .replace(/단가|금액|합계|원/g, "")
      .trim();
    if (product.length < 2) continue;
    items.push({
      product: product.slice(0, 80),
      unit: "식",
      unitPrice: supply,
      vat: vat,
      total: total,
      note: "원본 자동추출"
    });
  }

  if (items.length) return normalizeBringQuoteItems_(items, casePayload, amounts.totalAmount, amounts.supplyAmount, amounts.vatAmount);

  const totalAmount = Number(amounts.totalAmount || 0);
  const supplyAmount = Number(amounts.supplyAmount || (totalAmount ? Math.round(totalAmount / 1.1) : 0));
  const vatAmount = Number(amounts.vatAmount || (totalAmount ? totalAmount - supplyAmount : 0));
  return [makeFallbackQuoteItem_(casePayload, supplyAmount, vatAmount, totalAmount, "추출 확인 필요")];
}

function extractQuoteTableItems_(text, amounts, casePayload) {
  const source = String(text || "").replace(/\r/g, "\n");
  if (!source || !/(품\s*명|품목|내역|규격|수량|단가|금액)/i.test(source)) return [];

  const sections = buildQuoteItemCandidateSections_(source);
  for (const section of sections) {
    const rows = parseQuoteItemRowsFromSection_(section);
    if (!rows.length) continue;
    const items = buildQuoteItemsFromParsedRows_(rows, amounts);
    const normalized = normalizeBringQuoteItems_(items, casePayload, amounts.totalAmount, amounts.supplyAmount, amounts.vatAmount);
    if (normalized.length && !normalized[0].fallback) return normalized;
  }
  return [];
}

function buildQuoteItemCandidateSections_(source) {
  const compact = String(source || "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return [];

  const sections = [];
  const headerPattern = /(품\s*명\s*\(?\s*규격\s*\)?|품목|내역|규격)\s*(?:수량|단위)?\s*(?:단위|수량)?\s*(?:단가)?\s*(?:금액|합계)?\s*(?:비고)?/gi;
  let match;
  while ((match = headerPattern.exec(compact)) !== null) {
    let section = compact.slice(match.index + match[0].length);
    const stop = section.search(/(?:공급\s*가액|공급가|부가\s*세|부가세|합계\s*금액|총\s*액|총액|견적\s*유효|입금|사업자\s*등록|사업자번호|대표자|주소|전화|이메일|상호\s*:|회사명\s*:)/i);
    if (stop > 0) section = section.slice(0, stop);
    if (section.trim()) sections.push(section.trim());
  }

  if (!sections.length) {
    let section = compact;
    const firstHeader = section.search(/(?:품\s*명|품목|내역|규격)/i);
    if (firstHeader >= 0) section = section.slice(firstHeader);
    const stop = section.search(/(?:공급\s*가액|부가\s*세|합계\s*금액|총\s*액|견적\s*유효|사업자\s*등록|대표자|주소|전화|이메일)/i);
    if (stop > 0) section = section.slice(0, stop);
    sections.push(section);
  }
  return sections;
}

function parseQuoteItemRowsFromSection_(section) {
  let text = String(section || "")
    .replace(/품\s*명\s*\(?\s*규격\s*\)?|품목|내역|규격|수량|단위|단가|금액|합계|비고/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const rows = [];
  const money = "(?:\\d{1,3}(?:,\\d{3})+|\\d{4,})(?:\\.\\d+)?";
  const formula = "(?:[A-Z]{1,3}\\d+\\s*[*+\\-/]\\s*[A-Z]{1,3}\\d+)";
  const rowPattern = new RegExp("([^\\d]{1}[^\\n]{1,90}?)\\s+(\\d+(?:\\.\\d+)?)\\s+(" + money + ")(?:\\s*원)?(?:\\s+" + formula + ")?(?:\\s+(" + money + ")(?:\\s*원)?)?", "g");
  let match;
  while ((match = rowPattern.exec(text)) !== null) {
    if (rows.length >= 12) break;
    const product = cleanQuoteItemProduct_(match[1]);
    if (!product) continue;
    const qty = Number(match[2] || 1) || 1;
    const unitPrice = parseMoneyValue_(match[3]);
    const lineAmount = parseMoneyValue_(match[4] || match[3]);
    if (!lineAmount || lineAmount < 1000) continue;
    rows.push({ product: product, qty: qty, unitPrice: unitPrice, lineAmount: lineAmount });
  }
  return rows;
}

function cleanQuoteItemProduct_(value) {
  let product = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^\d+[\).\-]?\s*/, "")
    .replace(/^(No|NO|no)\s*\d+\s*/i, "")
    .replace(/^[\s:;,\-–—·ㆍ|()[\]{}]+|[\s:;,\-–—·ㆍ|()[\]{}]+$/g, "")
    .trim();
  product = product.replace(/^(품\s*명\s*\(?\s*규격\s*\)?|품목|내역|규격|수량|단위|단가|금액|합계|비고)\s*/i, "").trim();
  if (product.length < 2) return "";
  if (!/[가-힣A-Za-z]/.test(product)) return "";
  if (/공급\s*가액|부가\s*세|합계|총액|사업자|대표자|주소|전화|이메일|견적\s*일자/i.test(product)) return "";
  return product.slice(0, 80);
}

function buildQuoteItemsFromParsedRows_(rows, amounts) {
  rows = Array.isArray(rows) ? rows : [];
  if (!rows.length) return [];
  const totalAmount = Number(amounts && amounts.totalAmount || 0);
  const supplyAmount = Number(amounts && amounts.supplyAmount || (totalAmount ? Math.round(totalAmount / 1.1) : 0));
  const vatAmount = Number(amounts && amounts.vatAmount || (totalAmount ? totalAmount - supplyAmount : 0));
  const rowSum = rows.reduce((sum, row) => sum + Number(row.lineAmount || 0), 0);
  const tolerance = Math.max(1000, Math.round((totalAmount || rowSum) * 0.08));
  const rowAmountsAreSupply = supplyAmount && Math.abs(rowSum - supplyAmount) <= tolerance;
  const rowAmountsAreTotal = totalAmount && Math.abs(rowSum - totalAmount) <= tolerance;
  if (totalAmount && !rowAmountsAreSupply && !rowAmountsAreTotal) return [];

  let remainingVat = vatAmount || Math.round(rowSum * 0.1);
  let remainingTotal = totalAmount || (rowAmountsAreSupply ? rowSum + remainingVat : rowSum);
  return rows.map((row, index) => {
    let supply;
    let vat;
    let total;
    if (rowAmountsAreSupply) {
      supply = Number(row.lineAmount || 0);
      vat = index === rows.length - 1
        ? remainingVat
        : Math.round(supply * (vatAmount || Math.round(rowSum * 0.1)) / Math.max(1, rowSum));
      total = supply + vat;
    } else {
      total = Number(row.lineAmount || 0);
      supply = Math.round(total / 1.1);
      vat = total - supply;
    }
    remainingVat -= vat;
    remainingTotal -= total;
    if (index === rows.length - 1 && totalAmount && Math.abs(remainingTotal) <= 1000) {
      total += remainingTotal;
      vat = total - supply;
    }
    return {
      product: row.product,
      unit: "식",
      unitPrice: supply || "",
      vat: vat || "",
      total: total || "",
      note: "표 자동추출"
    };
  });
}

function makeFallbackQuoteItem_(casePayload, supplyAmount, vatAmount, totalAmount, note) {
  return {
    product: [(casePayload.issueType || casePayload.vendorType || "현장"), "점검 및 공사 견적"].join(" "),
    unit: "식",
    unitPrice: supplyAmount || "",
    vat: vatAmount || "",
    total: totalAmount || "",
    note: note || "추출 확인 필요",
    fallback: true
  };
}

function normalizeBringQuoteItems_(items, casePayload, totalAmount, supplyAmount, vatAmount) {
  const total = Number(totalAmount || 0);
  const supply = Number(supplyAmount || (total ? Math.round(total / 1.1) : 0));
  const vat = Number(vatAmount || (total ? total - supply : 0));
  const fallback = [makeFallbackQuoteItem_(casePayload, supply, vat, total, "추출 확인 필요")];
  const rawItems = Array.isArray(items) ? items : [];
  if (!rawItems.length) return fallback;

  const normalized = rawItems.map(item => {
    item = item || {};
    const itemTotal = parseMoneyValue_(item.total || item.totalAmount || item.amount || "");
    const itemSupply = parseMoneyValue_(item.unitPrice || item.supplyAmount || item.supply || "");
    const itemVat = parseMoneyValue_(item.vat || item.vatAmount || "");
    let finalTotal = itemTotal || (itemSupply && itemVat ? itemSupply + itemVat : 0);
    let finalSupply = itemSupply || (finalTotal ? Math.round(finalTotal / 1.1) : 0);
    let finalVat = itemVat || (finalTotal ? finalTotal - finalSupply : 0);
    if (!finalTotal && finalSupply && finalVat) finalTotal = finalSupply + finalVat;
    const product = String(item.product || item.name || item.item || item.description || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    return {
      product: product,
      unit: String(item.unit || "식").replace(/\s+/g, " ").trim().slice(0, 20) || "식",
      unitPrice: finalSupply || "",
      vat: finalVat || "",
      total: finalTotal || "",
      note: String(item.note || "원본 자동추출").replace(/\s+/g, " ").trim().slice(0, 60)
    };
  }).filter(item => {
    if (!item.product || item.product.length < 2) return false;
    if (/합계|총액|공급가액|부가세|사업자|대표자|전화|주소|이메일|견적일자/i.test(item.product)) return false;
    if (!Number(item.total || 0)) return false;
    if (total && Number(item.total || 0) > Math.round(total * 1.05)) return false;
    return true;
  }).slice(0, 12);

  if (!normalized.length) return fallback;
  if (total) {
    const sum = normalized.reduce((acc, item) => acc + Number(item.total || 0), 0);
    const tolerance = Math.max(1000, Math.round(total * 0.08));
    if (!sum || Math.abs(sum - total) > tolerance) return fallback;
  }
  return normalized;
}

function findBusinessRegistrationForQuote_(casePayload, quote, vendorName) {
  const docs = Object.values((casePayload && casePayload.businessRegistrationFiles) || {})
    .filter(Boolean)
    .map(businessRegistrationVendorInfoFromDoc_)
    .filter(v => v.name || v.businessNo || v.phone);
  if (!docs.length) return {};

  const quoteVendor = cleanVendorInfo_(quote && (quote.resolvedVendorInfo || quote.vendor) || {});
  const targetNames = [
    vendorName,
    quoteVendor.name,
    quote && quote.vendorName,
    quote && quote.extractedVendorName,
    quote && quote.extractedVendorInfo && quote.extractedVendorInfo.name,
    quote && extractQuoteVendorNameFromFileName_(quote.fileName || quote.originalFileName || "")
  ].map(cleanExtractedVendorName_).filter(Boolean);
  const targetBusinessNo = cleanBusinessNo_(quoteVendor.businessNo || (quote && quote.businessNo) || (quote && quote.extractedVendorInfo && quote.extractedVendorInfo.businessNo) || "");

  if (targetBusinessNo) {
    const businessMatches = docs.filter(doc => cleanBusinessNo_(doc.businessNo || "") === targetBusinessNo);
    const selectedByBusinessNo = selectBusinessRegistrationMatch_(businessMatches);
    if (selectedByBusinessNo) return selectedByBusinessNo;
  }

  for (const target of targetNames) {
    const exact = docs.filter(doc => vendorMatchKey_(doc.name) === vendorMatchKey_(target));
    const selectedExact = selectBusinessRegistrationMatch_(exact);
    if (selectedExact) return selectedExact;
  }
  for (const target of targetNames) {
    const similar = docs.filter(doc => vendorNameLooseMatch_(target, doc.name));
    const selectedSimilar = selectBusinessRegistrationMatch_(similar);
    if (selectedSimilar) return selectedSimilar;
  }
  return {};
}

function selectBusinessRegistrationMatch_(matches) {
  matches = (matches || []).filter(Boolean);
  if (!matches.length) return null;
  if (matches.length === 1) return matches[0];
  const nameKeys = new Set(matches.map(item => vendorMatchKey_(item.name || "")).filter(Boolean));
  const businessNos = new Set(matches.map(item => cleanBusinessNo_(item.businessNo || "")).filter(Boolean));
  if (nameKeys.size > 1 && businessNos.size > 1) return null;
  return matches.slice().sort((a, b) => {
    const scoreDiff = businessRegistrationCompletenessScore_(b) - businessRegistrationCompletenessScore_(a);
    if (scoreDiff) return scoreDiff;
    return String(b.uploadedAt || b.updatedAt || "").localeCompare(String(a.uploadedAt || a.updatedAt || ""));
  })[0];
}

function businessRegistrationCompletenessScore_(info) {
  info = info || {};
  return ["businessNo", "ceo", "address", "type", "category", "phone", "email"].reduce((score, key) => {
    return score + (String(info[key] || "").trim() ? 1 : 0);
  }, 0);
}

function businessRegistrationVendorInfoFromDoc_(doc) {
  const fileNameVendorName = extractBusinessRegistrationVendorNameFromFileName_(doc.originalFileName || doc.fileName || "");
  const info = cleanVendorInfo_({
    docId: doc.id || "",
    id: doc.vendorId || "",
    name: doc.vendorName || doc.matchedVendorName || fileNameVendorName || "",
    businessNo: doc.businessNo || "",
    ceo: doc.ceo || "",
    address: doc.address || "",
    type: doc.type || "",
    category: doc.category || "",
    phone: doc.phone || "",
    email: doc.email || "",
    source: "business_registration"
  });
  info.driveFileId = doc.driveFileId || "";
  info.fileName = doc.fileName || "";
  info.originalFileName = doc.originalFileName || doc.fileName || "";
  info.mimeType = doc.mimeType || "";
  info.extractionStatus = doc.extractionStatus || "";
  info.extractionMemo = doc.extractionMemo || "";
  info.uploadedAt = doc.uploadedAt || "";
  info.updatedAt = doc.updatedAt || "";
  info.mineruSupplementAttempted = !!doc.mineruSupplementAttempted || !!doc.mineruSupplementMessage;
  info.mineruSupplementUsed = !!doc.mineruSupplementUsed;
  info.mineruSupplementMessage = doc.mineruSupplementMessage || "";
  info.supplierMissingFields = doc.supplierMissingFields || [];
  return info;
}

function supplementBusinessRegistrationVendorFromDriveIfNeeded_(casePayload, businessVendor) {
  businessVendor = businessVendor || {};
  const current = cleanVendorInfo_(businessVendor);
  current.docId = businessVendor.docId || current.docId || "";
  if (!hasMissingSupplierFields_(current)) {
    return { vendorInfo: current, used: false, message: "" };
  }
  if (businessVendor.mineruSupplementAttempted) {
    return { vendorInfo: current, used: false, message: businessVendor.mineruSupplementMessage || "" };
  }

  const docId = businessVendor.docId || "";
  const docs = casePayload && casePayload.businessRegistrationFiles || {};
  const doc = docId && docs[docId] ? docs[docId] : null;
  const driveFileId = businessVendor.driveFileId || (doc && doc.driveFileId) || "";
  if (!driveFileId) {
    return { vendorInfo: current, used: false, message: "" };
  }

  try {
    const file = DriveApp.getFileById(driveFileId);
    const blob = file.getBlob();
    const fileName = businessVendor.originalFileName || businessVendor.fileName || (doc && (doc.originalFileName || doc.fileName)) || file.getName();
    const mimeType = businessVendor.mimeType || (doc && doc.mimeType) || blob.getContentType();
    const result = analyzeBusinessRegistrationWithMinerUIfNeeded_(blob, mimeType, fileName, casePayload, current, null);
    if (result && result.vendorInfo) {
      result.vendorInfo.docId = current.docId || docId;
      result.vendorInfo.driveFileId = driveFileId;
      result.vendorInfo.fileName = businessVendor.fileName || (doc && doc.fileName) || file.getName();
      result.vendorInfo.originalFileName = fileName;
      result.vendorInfo.mimeType = mimeType;
      if (doc) {
        doc.mineruSupplementAttempted = true;
        doc.mineruSupplementUsed = !!result.used;
        doc.mineruSupplementMessage = result.message || "";
        doc.supplierMissingFields = result.missingFields || getMissingBringSupplierFields_(result.vendorInfo);
        ["businessNo", "ceo", "address", "type", "category", "phone", "email"].forEach(field => {
          if (!doc[field] && result.vendorInfo[field]) doc[field] = result.vendorInfo[field];
        });
        if (!doc.vendorName && result.vendorInfo.name) doc.vendorName = result.vendorInfo.name;
      }
    }
    return result || { vendorInfo: current, used: false, message: "" };
  } catch (err) {
    return {
      vendorInfo: current,
      used: false,
      message: "MinerU OCR 보충 실패: " + err.message,
      warnings: ["MinerU OCR 보충 실패: " + err.message]
    };
  }
}

function resolveBringQuoteVendorInfo_(casePayload, quote, extraction) {
  quote = quote || {};
  extraction = extraction || {};
  const quoteVendor = cleanVendorInfo_(quote.resolvedVendorInfo || quote.vendor || {});
  if (!quoteVendor.name) quoteVendor.name = cleanExtractedVendorName_(quote.vendorName || extraction.vendorName || "");
  let businessVendor = findBusinessRegistrationForQuote_(casePayload, quote, quoteVendor.name || quote.vendorName || extraction.vendorName || "");
  const mineruSupplement = supplementBusinessRegistrationVendorFromDriveIfNeeded_(casePayload, businessVendor);
  if (mineruSupplement && mineruSupplement.vendorInfo) {
    businessVendor = mineruSupplement.vendorInfo;
  }
  const vendor = mergeVendorInfoObjects_(businessVendor, quoteVendor);
  const businessName = cleanExtractedVendorName_(businessVendor.name || "");
  if (businessName && (!quoteVendor.name || vendorNameLooseMatch_(quoteVendor.name, businessName))) {
    vendor.name = businessName;
  }
  if (!vendor.name) vendor.name = cleanExtractedVendorName_(quote.vendorName || extraction.vendorName || businessVendor.name || "");

  const businessFields = ["name", "businessNo", "ceo", "address", "type", "category", "phone", "email"];
  let businessApplied = businessFields.some(field => {
    const businessValue = String(businessVendor[field] || "").trim();
    if (!businessValue) return false;
    const quoteValue = String(quoteVendor[field] || "").trim();
    const finalValue = String(vendor[field] || "").trim();
    if (field === "name") return finalValue === businessValue && finalValue !== quoteValue;
    return !quoteValue && finalValue === businessValue;
  });
  businessApplied = businessApplied || !!(mineruSupplement && mineruSupplement.used);

  return {
    vendor: cleanVendorInfo_(vendor),
    quoteVendor: quoteVendor,
    businessVendor: businessVendor,
    businessApplied: businessApplied,
    mineruSupplementApplied: !!(mineruSupplement && mineruSupplement.used),
    mineruSupplementMessage: mineruSupplement && mineruSupplement.message || ""
  };
}

function refreshBringQuotesFromBusinessRegistration_(caseId, casePayload, businessDoc, timestamp) {
  const result = { updated: 0, skipped: 0 };
  const templateId = extractDriveId_(COMPLAINT_CONFIG.QUOTE_TEMPLATE_SPREADSHEET_ID);
  if (!templateId) return result;
  const quoteFiles = casePayload && casePayload.quoteFiles && typeof casePayload.quoteFiles === "object" && !Array.isArray(casePayload.quoteFiles)
    ? casePayload.quoteFiles
    : {};
  const quoteIds = Object.keys(quoteFiles);
  if (!quoteIds.length) return result;

  const businessVendor = businessRegistrationVendorInfoFromDoc_(businessDoc);
  const bringFolder = getOrCreateChildFolder_(getQuoteDriveFolder_(casePayload), "브링 양식 견적서");

  quoteIds.forEach(quoteId => {
    const quote = quoteFiles[quoteId];
    if (!businessRegistrationMatchesQuote_(businessVendor, quote)) {
      result.skipped++;
      return;
    }

    let sheetFile = null;
    try {
      const extraction = makeQuoteRewriteExtraction_(quote, casePayload);
      const fileNameBase = makeBringQuoteFileNameBase_(quote, extraction);
      sheetFile = DriveApp.getFileById(templateId).makeCopy(fileNameBase, bringFolder);
      const ss = SpreadsheetApp.openById(sheetFile.getId());
      const fillResult = fillBringQuoteSpreadsheet_(ss, casePayload, quote, extraction);
      SpreadsheetApp.flush();
      if (fillResult && fillResult.vendor && fillResult.vendor.name) {
        quote.vendor = fillResult.vendor;
        quote.resolvedVendorInfo = fillResult.vendor;
        quote.vendorName = fillResult.vendor.name;
        quote.vendorInfoSource = fillResult.businessApplied ? "business_registration" : quote.vendorInfoSource;
      }

      const previousXlsxId = String(quote.bringQuoteXlsxId || "");
      const exported = exportBringQuoteXlsx_(sheetFile.getId(), fileNameBase + ".xlsx", bringFolder);
      if (exported.ok) {
        quote.bringQuoteXlsxName = exported.fileName;
        quote.bringQuoteXlsxUrl = exported.fileUrl;
        quote.bringQuoteXlsxId = exported.fileId;
        if (previousXlsxId && previousXlsxId !== exported.fileId) trashDriveFileByIdQuietly_(previousXlsxId);
      } else {
        quote.bringQuoteStatus = "xlsx_failed";
        quote.bringQuoteType = "failed";
        quote.extractionMemo = appendQuoteMemo_(quote.extractionMemo, "사업자등록증 반영 XLSX 내보내기 실패: " + exported.message);
      }

      const sheetAmounts = readBringQuoteAmounts_(ss);
      if (sheetAmounts.totalAmount) {
        quote.bringQuoteTotalAmount = sheetAmounts.totalAmount;
        quote.bringQuoteSupplyAmount = sheetAmounts.supplyAmount || "";
        quote.bringQuoteVatAmount = sheetAmounts.vatAmount || "";
        quote.bringQuoteBaseTotalAmount = Number(quote.confirmedTotalAmount || quote.bringQuoteBaseTotalAmount || quote.totalAmount || extraction.totalAmount || 0);
        quote.bringQuoteBaseSupplyAmount = Number(quote.confirmedSupplyAmount || quote.bringQuoteBaseSupplyAmount || quote.supplyAmount || extraction.supplyAmount || 0);
        quote.bringQuoteBaseVatAmount = Number(quote.confirmedVatAmount || quote.bringQuoteBaseVatAmount || quote.vatAmount || extraction.vatAmount || 0);
        quote.bringQuoteMarkupRate = BRING_QUOTE_MARKUP_RATE;
        quote.bringQuoteMarkupAmount = Math.max(0, sheetAmounts.totalAmount - quote.bringQuoteBaseTotalAmount);
        quote.bringQuoteItems = fillResult && fillResult.bringItems || quote.bringQuoteItems || [];
        quote.bringQuoteAmountSyncedAt = timestamp;
      }
      quote.bringQuoteStatus = quote.bringQuoteStatus === "xlsx_failed" ? quote.bringQuoteStatus : "business_registration_rewritten";
      quote.bringQuoteType = Number(quote.confirmedTotalAmount || 0) ? "confirmed" : "draft";
      if (fillResult && fillResult.businessApplied) {
        quote.extractionMemo = appendQuoteMemo_(quote.extractionMemo, "사업자등록증 정보 반영 완료");
        quote.businessRegistrationAppliedAt = timestamp;
        quote.businessRegistrationDocId = businessDoc.id || "";
      }
      if (fillResult && fillResult.mineruSupplementApplied) {
        quote.extractionMemo = appendQuoteMemo_(quote.extractionMemo, fillResult.mineruSupplementMessage || "MinerU OCR로 사업자등록증 빈칸 보충");
      }
      quote.extractedItems = extraction.items;
      quote.updatedAt = timestamp;
      applyQuoteAmountState_(quote);

      casePayload.quoteFiles[quoteId] = quote;
      putCaseChildToFirebase_(caseId, "quoteFiles/" + quoteId, quote);
      result.updated++;
    } catch (err) {
      quote.extractionMemo = appendQuoteMemo_(quote.extractionMemo, "사업자등록증 정보 반영 실패: " + err.message);
      casePayload.quoteFiles[quoteId] = quote;
      putCaseChildToFirebase_(caseId, "quoteFiles/" + quoteId, quote);
    } finally {
      trashDriveFileQuietly_(sheetFile);
    }
  });

  return result;
}

function businessRegistrationMatchesQuote_(businessVendor, quote) {
  businessVendor = cleanVendorInfo_(businessVendor || {});
  quote = quote || {};
  const quoteVendor = cleanVendorInfo_(quote.resolvedVendorInfo || quote.vendor || {});
  const businessNo = cleanBusinessNo_(businessVendor.businessNo || "");
  const quoteBusinessNo = cleanBusinessNo_(quoteVendor.businessNo || quote.businessNo || (quote.extractedVendorInfo && quote.extractedVendorInfo.businessNo) || "");
  if (businessNo && quoteBusinessNo && businessNo === quoteBusinessNo) return true;

  const businessName = cleanExtractedVendorName_(businessVendor.name || "");
  if (!businessName) return false;
  const quoteNames = [
    quoteVendor.name,
    quote.vendorName,
    quote.extractedVendorName,
    quote.extractedVendorInfo && quote.extractedVendorInfo.name,
    extractQuoteVendorNameFromFileName_(quote.fileName || quote.originalFileName || "")
  ].map(cleanExtractedVendorName_).filter(Boolean);
  if (!quoteNames.length) return false;
  return quoteNames.some(name => vendorNameLooseMatch_(name, businessName));
}

function makeQuoteRewriteExtraction_(quote, casePayload) {
  quote = quote || {};
  const baseAmounts = getBringQuoteBaseAmounts_(quote, {});
  const total = baseAmounts.totalAmount;
  const supply = baseAmounts.supplyAmount;
  const vat = baseAmounts.vatAmount;
  const items = getQuoteItemsForRewrite_(quote, casePayload, total, supply, vat);
  return {
    status: quote.extractionStatus || "확인필요",
    memo: quote.extractionMemo || "",
    vendorName: quote.extractedVendorName || quote.vendorName || "",
    supplyAmount: supply,
    vatAmount: vat,
    totalAmount: total,
    items: items
  };
}

function getQuoteItemsForRewrite_(quote, casePayload, total, supply, vat) {
  quote = quote || {};
  const amounts = {
    totalAmount: Number(total || 0),
    supplyAmount: Number(supply || (total ? Math.round(total / 1.1) : 0)),
    vatAmount: Number(vat || (total ? total - Math.round(total / 1.1) : 0))
  };
  const text = getQuoteTextForRewrite_(quote);
  if (text) {
    const fromText = extractQuoteItems_(text, amounts, casePayload);
    if (hasUsableQuoteItems_(fromText)) return fromText;
  }
  const existing = normalizeBringQuoteItems_(quote.extractedItems, casePayload, amounts.totalAmount, amounts.supplyAmount, amounts.vatAmount);
  if (hasUsableQuoteItems_(existing)) return existing;
  return [makeFallbackQuoteItem_(casePayload, amounts.supplyAmount, amounts.vatAmount, amounts.totalAmount, "추출 확인 필요")];
}

function hasUsableQuoteItems_(items) {
  items = Array.isArray(items) ? items : [];
  return items.some(item => item && !item.fallback && String(item.product || "").trim().length >= 2);
}

function getQuoteTextForRewrite_(quote) {
  quote = quote || {};
  const storedText = [
    quote.extractionText || "",
    quote.extractionTextPreview || "",
    quote.textPreview || "",
    quote.analysisText || ""
  ].filter(Boolean).join(" ");
  if (storedText && /(품\s*명|품목|내역|규격|수량|단가|금액)/i.test(storedText)) return storedText;

  const fileId = extractDriveId_(quote.originalDriveFileId || quote.driveFileId || quote.originalFileUrl || quote.fileUrl || "");
  if (!fileId) return storedText;
  try {
    const file = DriveApp.getFileById(fileId);
    const fileName = file.getName();
    const blob = file.getBlob();
    const mimeType = quote.mimeType || blob.getContentType() || inferQuoteMimeType_(fileName);
    const result = extractQuoteText_(blob, mimeType, fileName);
    const freshText = result && result.text ? String(result.text) : "";
    return [storedText, freshText].filter(Boolean).join(" ");
  } catch (err) {
    return storedText;
  }
}

function fillBringQuoteSpreadsheet_(ss, casePayload, quote, extraction) {
  const sheet = ss.getSheets()[0];
  extraction = extraction || {};
  const vendorResult = resolveBringQuoteVendorInfo_(casePayload, quote, extraction);
  const vendor = vendorResult.vendor;
  const vendorName = cleanExtractedVendorName_(vendor.name || quote.vendorName || extraction.vendorName || "");
  const vendorAddress = cleanQuoteAddress_(vendor.address || vendor.addressFromVendorList || "");
  const baseAmounts = getBringQuoteBaseAmounts_(quote, extraction);
  const bringAmounts = calculateBringQuoteAmounts_(baseAmounts.totalAmount);
  const total = bringAmounts.totalAmount;
  const supply = bringAmounts.supplyAmount;
  const vat = bringAmounts.vatAmount;
  if (quote && bringAmounts.totalAmount) {
    quote.sourceTotalAmount = baseAmounts.totalAmount;
    quote.bringQuoteBaseTotalAmount = baseAmounts.totalAmount;
    quote.bringQuoteBaseSupplyAmount = baseAmounts.supplyAmount;
    quote.bringQuoteBaseVatAmount = baseAmounts.vatAmount;
    quote.bringQuoteMarkupRate = bringAmounts.markupRate;
    quote.bringQuoteMarkupAmount = bringAmounts.markupAmount;
  }
  setSheetValue_(sheet, "D5", Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd"));
  setSheetValue_(sheet, "D6", vendor.businessNo || "");
  setSheetValue_(sheet, "D7", vendorName || "");
  setSheetValue_(sheet, "I7", vendor.ceo || "");
  setSheetValue_(sheet, "D8", vendorAddress || "");
  setSheetValue_(sheet, "D9", vendor.type || vendor.category || "");
  setSheetValue_(sheet, "I9", vendor.category || "");
  setSheetValue_(sheet, "D10", vendor.phone || "");
  setSheetValue_(sheet, "I10", vendor.email || "");
  setSheetValue_(sheet, "D11", vendorName || "");
  setSheetNumber_(sheet, "D13", supply);
  setSheetNumber_(sheet, "I13", vat);
  setSheetNumber_(sheet, "D15", total);

  for (let row = 18; row <= 29; row++) {
    ["C", "E", "G", "H", "I", "K"].forEach(col => setSheetValue_(sheet, col + row, ""));
  }
  const items = scaleBringQuoteItems_(extraction.items || [], casePayload, baseAmounts, bringAmounts);
  items.slice(0, 12).forEach((item, index) => {
    const row = 18 + index;
    setSheetValue_(sheet, "C" + row, item.product || "");
    setSheetValue_(sheet, "E" + row, item.unit || "식");
    setSheetNumber_(sheet, "G" + row, item.unitPrice || "");
    setSheetNumber_(sheet, "H" + row, item.vat || "");
    setSheetNumber_(sheet, "I" + row, item.total || "");
    setSheetValue_(sheet, "K" + row, item.note || "");
  });
  setSheetValue_(sheet, "C30", items.length || 1);
  setSheetNumber_(sheet, "E30", supply);
  setSheetNumber_(sheet, "H30", vat);
  setSheetNumber_(sheet, "J30", total);
  vendorResult.bringAmounts = bringAmounts;
  vendorResult.bringItems = items;
  return vendorResult;
}

function readBringQuoteAmounts_(ss) {
  const sheet = ss.getSheets()[0];
  const supply = readBringSheetMoney_(sheet, "D13") || readBringSheetMoney_(sheet, "E30");
  const vat = readBringSheetMoney_(sheet, "I13") || readBringSheetMoney_(sheet, "H30");
  let total = readBringSheetMoney_(sheet, "D15") || readBringSheetMoney_(sheet, "J30");
  if (!total && supply && vat) total = normalizeBringSheetMoney_(supply + vat);
  if (!total) return { supplyAmount: "", vatAmount: "", totalAmount: "" };
  const finalSupply = supply || Math.round(total / 1.1);
  const finalVat = vat || (total - finalSupply);
  return {
    supplyAmount: finalSupply,
    vatAmount: finalVat,
    totalAmount: total
  };
}

function readBringSheetMoney_(sheet, a1) {
  try {
    const range = sheet.getRange(a1);
    return normalizeBringSheetMoney_(range.getDisplayValue()) || normalizeBringSheetMoney_(range.getValue());
  } catch (err) {
    return 0;
  }
}

function normalizeBringSheetMoney_(value) {
  if (isLikelyDateText_(value)) return 0;
  const amount = parseMoneyValue_(value);
  if (!amount || amount < 1000) return 0;
  if (isLikelyYmdDateNumber_(String(amount))) return 0;
  return amount;
}

function isLikelyDateText_(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (/^20\d{2}[-./년\s]+\d{1,2}[-./월\s]+\d{1,2}/.test(raw)) return true;
  return isLikelyYmdDateNumber_(raw);
}

function setSheetValue_(sheet, a1, value) {
  try { sheet.getRange(a1).setValue(value); } catch (err) {}
}

function setSheetNumber_(sheet, a1, value) {
  try {
    const range = sheet.getRange(a1);
    if (value === "" || value == null || Number(value) === 0) {
      range.setValue(value === 0 ? 0 : "");
    } else {
      range.setValue(Number(value)).setNumberFormat("#,##0");
    }
  } catch (err) {}
}

function exportBringQuoteXlsx_(spreadsheetId, fileName, folder) {
  try {
    const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const url = "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(spreadsheetId) +
      "/export?mimeType=" + encodeURIComponent(mime);
    const response = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    if (code < 200 || code >= 300) {
      return { ok: false, message: "HTTP " + code + " / " + response.getContentText().slice(0, 160) };
    }
    const file = folder.createFile(response.getBlob().setName(fileName));
    return { ok: true, fileName: file.getName(), fileUrl: file.getUrl(), fileId: file.getId() };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

function trashDriveFileQuietly_(file) {
  if (!file) return;
  try {
    file.setTrashed(true);
  } catch (err) {
    Logger.log("임시 브링 양식 Google Sheet 정리 실패: " + err.message);
  }
}

function trashDriveFileByIdQuietly_(fileId) {
  if (!fileId) return;
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
  } catch (err) {
    Logger.log("이전 브링 엑셀 파일 정리 실패: " + err.message);
  }
}

function formatMoney_(value) {
  const num = Number(value || 0);
  return num ? String(num) : "";
}

function formatCurrencyText_(value) {
  const num = Number(value || 0);
  return num ? Utilities.formatString("%s원", String(num).replace(/\B(?=(\d{3})+(?!\d))/g, ",")) : "금액 미입력";
}

function escapeRegex_(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeDriveName_(value) {
  return String(value || "")
    .replace(/[\\/:*?"<>|#{}\[\]%~&]/g, "_")
    .replace(/\s+/g, " ")
    .trim() || "file";
}

function inferQuoteMimeType_(fileName) {
  const ext = String(fileName || "").split(".").pop().toLowerCase();
  const map = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    hwp: "application/x-hwp",
    hwpx: "application/vnd.hancom.hwpx"
  };
  return map[ext] || "application/octet-stream";
}

function isBusinessRegistrationLikeQuote_(quote) {
  const text = [
    quote && quote.fileName,
    quote && quote.originalFileName
  ].filter(Boolean).join(" ");
  return /사업자\s*등록|사업자등록증|business[-_\s]*registration|biz[-_\s]*reg/i.test(text);
}

function makeQuoteComparisonNote_(casePayload) {
  const quotes = Object.values(casePayload.quoteFiles || {}).filter(quote => quote && !isBusinessRegistrationLikeQuote_(quote));
  if (!quotes.length) return "";
  const lines = ["[견적 비교]", "업로드 견적: " + quotes.length + "건", ""];
  quotes.forEach(quote => {
    const confirmed = Number(quote.confirmedTotalAmount || 0);
    const baseAmount = confirmed || Number(quote.bringQuoteBaseTotalAmount || 0) || Number(quote.totalAmount || 0) || parseMoneyValue_(quote.amount);
    const bringSheetAmount = Number(quote.bringQuoteTotalAmount || 0);
    const bringLabel = quote.bringQuoteType === "confirmed" || quote.bringQuoteStatus === "confirmed_rewritten"
      ? "브링 엑셀 확정"
      : quote.bringQuoteXlsxUrl
        ? "브링 엑셀 초안"
        : "브링 엑셀 확인 필요";
    const amountLabel = baseAmount
      ? "원본합계 " + formatCurrencyText_(baseAmount) + (bringSheetAmount ? " / 브링양식 " + formatCurrencyText_(bringSheetAmount) : "")
      : quote.amount ? "금액 " + quote.amount : "금액 미입력";
    lines.push("- " + [
      quote.vendorName || "업체 미지정",
      amountLabel,
      quote.fileName || "파일명 없음",
      quote.extractionStatus ? "추출 " + quote.extractionStatus : "",
      bringLabel
    ].join(" / "));
  });
  lines.push("");
  lines.push("비교 후 ⑥ 단계를 직접 완료하면 ⑦ 최적 추천으로 넘어갑니다.");
  return lines.join("\n");
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

  const filePathMatch = v.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (filePathMatch) return filePathMatch[1];

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
  const deletedCase = readCaseFromFirebase_(ticketNo);
  if (deletedCase && deletedCase.deleted === true) {
    Logger.log("삭제된 케이스 재처리 생략: " + ticketNo);
    return;
  }
  const analysis = analyzeComplaint_(record);
  const contractMatch = matchDriveOnboardingFile_(record);
  const casePayload = buildCasePayload_(ticketNo, record, analysis, contractMatch, row, sheet);
  writeCaseToFirebase_(ticketNo, casePayload);

  const existingCase = readCaseFromFirebase_(ticketNo) || {};
  let smsResult;
  if (contractMatch.status !== "matched") {
    smsResult = {
      ok: false,
      status: "매칭대기",
      statusText: "온보딩 수집서 매칭이 완료되지 않아 접수확인 문자를 발송하지 않았습니다.",
      skipped: true
    };
  } else if (isSmsCompleteStatus_(existingCase.sms && existingCase.sms.status)) {
    smsResult = Object.assign({ skipped: true }, existingCase.sms);
  } else {
    smsResult = sendComplaintSms_(ticketNo, record, analysis, contractMatch);
  }
  applySmsResultToCase_(casePayload, smsResult);

  writeAnalysisToSheet_(sheet, row, headers, ticketNo, analysis, casePayload, contractMatch, smsResult);
  writeCaseToFirebase_(ticketNo, casePayload);
  advanceCaseWorkflow_(ticketNo, { source: "form_submit" });
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

function formatEnglishDateTextForCase_(raw) {
  const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const match = String(raw || "").trim().match(/^(?:[A-Za-z]{3}\s+)?([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (!match) return "";
  const month = months[String(match[1]).toLowerCase()];
  if (!month) return "";
  return match[3] + "년 " + month + "월 " + Number(match[2]) + "일 " + String(match[4]).padStart(2, "0") + ":" + match[5];
}

function formatKoreanDateOnlyForCase_(value) {
  if (value === undefined || value === null || String(value).trim() === "") return "";
  const raw = String(value).trim();
  const korean = raw.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (korean && Number(korean[1]) > 1901) {
    return Number(korean[1]) + "년 " + Number(korean[2]) + "월 " + Number(korean[3]) + "일";
  }
  const parsed = value instanceof Date ? value : new Date(raw);
  if (isNaN(parsed.getTime())) return "";
  const year = Number(Utilities.formatDate(parsed, "Asia/Seoul", "yyyy"));
  return year > 1901 ? Utilities.formatDate(parsed, "Asia/Seoul", "yyyy년 M월 d일") : "";
}

function timeOnlyPartsForCase_(value) {
  const raw = String(value || "").trim();
  const english = raw.match(/^(?:[A-Za-z]{3}\s+)?[A-Za-z]{3}\s+\d{1,2}\s+(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (english && Number(english[1]) <= 1901) {
    return { hour: String(english[2]).padStart(2, "0"), minute: english[3] };
  }
  const korean = raw.match(/^(\d{4})년\s*\d{1,2}월\s*\d{1,2}일\s*(\d{1,2}):(\d{2})/);
  if (korean && Number(korean[1]) <= 1901) {
    return { hour: String(korean[2]).padStart(2, "0"), minute: korean[3] };
  }
  const parsed = value instanceof Date ? value : new Date(raw);
  if (isNaN(parsed.getTime())) return null;
  const year = Number(Utilities.formatDate(parsed, "Asia/Seoul", "yyyy"));
  if (year > 1901) return null;
  return {
    hour: Utilities.formatDate(parsed, "Asia/Seoul", "HH"),
    minute: Utilities.formatDate(parsed, "Asia/Seoul", "mm")
  };
}

function formatKoreanDateTimeForCase_(value, fallbackDate) {
  if (value === undefined || value === null || String(value).trim() === "") return "";
  const timeOnly = timeOnlyPartsForCase_(value);
  if (timeOnly) {
    const dateText = formatKoreanDateOnlyForCase_(fallbackDate);
    return (dateText ? dateText + " " : "") + timeOnly.hour + ":" + timeOnly.minute;
  }
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, "Asia/Seoul", "yyyy년 M월 d일 HH:mm");
  }
  const raw = String(value).trim();
  const englishDate = formatEnglishDateTextForCase_(raw);
  if (englishDate) return englishDate;
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, "Asia/Seoul", "yyyy년 M월 d일 HH:mm");
  }
  return raw;
}

function formatVisitTimeFromRecord_(record, fallbackDate) {
  const visitTime = readRawField_(record, ["방문 가능 시간"]);
  const visitDate = readRawField_(record, ["방문 가능 날짜", "방문 날짜", "방문일"]);
  const submittedAt = readRawField_(record, ["타임스탬프", "Timestamp"]);
  return formatKoreanDateTimeForCase_(visitTime, visitDate || fallbackDate || submittedAt);
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
    source: "drive_ranked",
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

  const candidatesResult = listDriveOnboardingCandidates_();
  if (!candidatesResult.ok) {
    return Object.assign(base, {
      statusText: candidatesResult.error || "Drive 폴더 접근 실패: 폴더 공유 권한 또는 폴더 ID를 확인하세요."
    });
  }
  if (!candidatesResult.candidates.length) {
    return Object.assign(base, {
      statusText: "Drive 폴더에 매칭할 DOCX 온보딩 수집서가 없습니다."
    });
  }
  const ranked = candidatesResult.candidates.map(candidate => rankDriveOnboardingCandidate_(candidate, inputBuilding, inputAddress));
  ranked.sort((a, b) => {
    if (a.matchRank !== b.matchRank) return b.matchRank - a.matchRank;
    if (a.matchScore !== b.matchScore) return b.matchScore - a.matchScore;
    if (a.addressScore !== b.addressScore) return b.addressScore - a.addressScore;
    return b.lastUpdatedMs - a.lastUpdatedMs;
  });
  const winner = ranked[0];
  const levelText = winner.matchRank === 3
    ? "건물명과 주소 정확 일치"
    : winner.matchRank === 2
      ? "정규화 건물명 일치"
      : "건물명 60%·주소 40% 유사도 최고 후보";
  return makeDriveMatchPayload_(winner.file, inputBuilding, inputAddress, {
    matchKey: buildingKey + "|" + addressKey,
    candidateCount: ranked.length,
    statusText: levelText + "로 자동 매칭했습니다.",
    source: "drive_ranked",
    matchLevel: levelText,
    matchScore: winner.matchScore,
    buildingScore: winner.buildingScore,
    addressScore: winner.addressScore,
    matchedBuilding: winner.building,
    matchedAddress: winner.address,
    ownerName: winner.ownerName,
    candidates: ranked.slice(0, 5).map(candidate => ({
      fileName: candidate.file.getName(),
      fileUrl: candidate.file.getUrl(),
      driveFileId: candidate.file.getId(),
      building: candidate.building,
      address: candidate.address,
      ownerName: candidate.ownerName,
      matchScore: candidate.matchScore
    }))
  });
}

function listDriveOnboardingCandidates_() {
  const folderId = extractDriveId_(COMPLAINT_CONFIG.CONTRACT_DRIVE_FOLDER_ID);
  if (!folderId) return { ok: false, candidates: [], error: "Drive 폴더 ID가 설정되지 않았습니다." };
  try {
    const folder = DriveApp.getFolderById(folderId);
    const files = folder.getFiles();
    const candidates = [];
    while (files.hasNext()) {
      const file = files.next();
      if (file.isTrashed() || file.getMimeType() !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document") continue;
      let text = "";
      try { text = extractDocxText_(file.getId()) || ""; } catch (err) { Logger.log("온보딩 DOCX 본문 추출 실패: " + file.getName() + " / " + err.message); }
      candidates.push({
        file: file,
        text: text,
        building: extractOnboardingField_(text, ["건물명", "건물"]) || onboardingBuildingFromFileName_(file.getName()),
        address: extractOnboardingField_(text, ["건물 주소", "주소", "소재지"]),
        ownerName: extractOnboardingOwnerName_(text),
        lastUpdatedMs: file.getLastUpdated().getTime()
      });
    }
    return { ok: true, candidates: candidates };
  } catch (err) {
    return { ok: false, candidates: [], error: "Drive 온보딩 목록 조회 실패: " + err.message };
  }
}

function extractOnboardingField_(text, labels) {
  const source = String(text || "").replace(/\r/g, "\n").replace(/[\t ]+/g, " ").replace(/\n+/g, " ").trim();
  const stopLabels = "(?:건물명|건물 주소|주소|소재지|건물주명|건물주 성명|건물주|소유자명|소유자|임대인명|임대인|대표자|연락처|전화번호|전화|휴대폰|등급|비고)";
  const isInstruction = value => /(?:주소로\s*계약\s*건물을?\s*확인|계약\s*건물\s*인덱스|확인하기\s*위한|간단\s*기록용|응답\s*시트|동일하게\s*입력|입력하면|자동\s*매칭)/i.test(String(value || ""));
  for (const label of labels || []) {
    const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const separator = "(?:\\s*[:：]\\s*|[ \\t]+)";
    const matcher = new RegExp("(?:^|\\s)" + escaped + separator + "(.{2,120}?)(?=\\s+" + stopLabels + "(?:\\s*[:：]|[ \\t]+)|$)", "ig");
    let match;
    while ((match = matcher.exec(source)) !== null) {
      const value = String(match[1] || "").trim();
      if (!isInstruction(value)) return value;
    }
  }
  return "";
}

function extractOnboardingOwnerName_(text) {
  const value = extractOnboardingField_(text, ["건물주명", "건물주 성명", "소유자명", "임대인명", "건물주", "소유자", "임대인"]);
  if (!value || /(?:연락처|전화|휴대폰|번호)/.test(value) || /\d{2,}[-.\s]?\d{3,}/.test(value)) return "";
  return value.slice(0, 60).trim();
}

function onboardingBuildingFromFileName_(fileName) {
  return String(fileName || "")
    .replace(/(?:\.(?:docx?|hwp|hwpx|pdf))+$/i, "")
    .replace(/[_-]*(온보딩|수집서|계약|계약서).*$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
}

function syncPaymentBuildings() {
  const result = syncPaymentBuildingsFromOnboarding_();
  Logger.log(JSON.stringify(result));
  return result;
}

function setupPaymentScheduleSheet() {
  const result = setupPaymentScheduleSheet_();
  const trigger = ensurePaymentScheduleEditTrigger_();
  const output = Object.assign({}, result, { autoSync: true, trigger: trigger });
  Logger.log(JSON.stringify(output));
  return output;
}

function paymentScheduleSpreadsheetId_() {
  return PropertiesService.getScriptProperties().getProperty("PAYMENT_SCHEDULE_SPREADSHEET_ID")
    || COMPLAINT_CONFIG.SPREADSHEET_ID;
}

function ensurePaymentScheduleEditTrigger_() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === "onPaymentScheduleSheetEdit") {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  const trigger = ScriptApp.newTrigger("onPaymentScheduleSheetEdit")
    .forSpreadsheet(paymentScheduleSpreadsheetId_())
    .onEdit()
    .create();
  return {
    handler: trigger.getHandlerFunction(),
    spreadsheetId: paymentScheduleSpreadsheetId_()
  };
}

function setupPaymentScheduleAutoSync() {
  const result = setupPaymentScheduleSheet_();
  const trigger = ensurePaymentScheduleEditTrigger_();
  const output = Object.assign({}, result, { autoSync: true, trigger: trigger });
  Logger.log(JSON.stringify(output));
  return output;
}

function onPaymentScheduleSheetEdit(e) {
  const range = e && e.range;
  if (!range) return;
  const sheet = range.getSheet();
  if (!sheet || sheet.getName() !== PAYMENT_SCHEDULE_SHEET_NAME) return;
  if (sheet.getParent().getId() !== paymentScheduleSpreadsheetId_()) return;
  if (range.getLastRow() < 2 || range.getColumn() > PAYMENT_SCHEDULE_HEADERS.length) return;

  firebaseWriteRequest_(
    firebaseCaseSettingsUrl_("paymentScheduleSheet"),
    "patch",
    {
      lastEditedAt: new Date().toISOString(),
      autoSyncEnabled: true,
      build: AUTOMATION_BUILD
    },
    "세입자 월세 관리대장 자동 반영 신호 저장 실패"
  );
}

function movePaymentScheduleSheetToBringCareFolder() {
  const props = PropertiesService.getScriptProperties();
  const currentId = props.getProperty("PAYMENT_SCHEDULE_SPREADSHEET_ID");
  let targetSpreadsheet;
  if (currentId) {
    targetSpreadsheet = SpreadsheetApp.openById(currentId);
  } else {
    targetSpreadsheet = SpreadsheetApp.create(COMPLAINT_CONFIG.PAYMENT_SCHEDULE_SPREADSHEET_NAME);
    const targetFile = DriveApp.getFileById(targetSpreadsheet.getId());
    const targetFolder = DriveApp.getFolderById(COMPLAINT_CONFIG.PAYMENT_SCHEDULE_DRIVE_FOLDER_ID);
    targetFile.moveTo(targetFolder);

    const sourceSpreadsheet = SpreadsheetApp.openById(COMPLAINT_CONFIG.SPREADSHEET_ID);
    const sourceSheet = sourceSpreadsheet.getSheetByName(PAYMENT_SCHEDULE_SHEET_NAME);
    if (sourceSheet) {
      const copiedSheet = sourceSheet.copyTo(targetSpreadsheet).setName(PAYMENT_SCHEDULE_SHEET_NAME);
      targetSpreadsheet.getSheets().forEach(sheet => {
        if (sheet.getSheetId() !== copiedSheet.getSheetId() && targetSpreadsheet.getSheets().length > 1) {
          targetSpreadsheet.deleteSheet(sheet);
        }
      });
    } else {
      targetSpreadsheet.getSheets()[0].setName(PAYMENT_SCHEDULE_SHEET_NAME);
    }
    props.setProperty("PAYMENT_SCHEDULE_SPREADSHEET_ID", targetSpreadsheet.getId());
  }

  const result = setupPaymentScheduleSheet_();
  ensurePaymentScheduleEditTrigger_();
  const sourceSpreadsheet = SpreadsheetApp.openById(COMPLAINT_CONFIG.SPREADSHEET_ID);
  const sourceSheet = sourceSpreadsheet.getSheetByName(PAYMENT_SCHEDULE_SHEET_NAME);
  const targetSheet = targetSpreadsheet.getSheetByName(PAYMENT_SCHEDULE_SHEET_NAME);
  if (sourceSheet && targetSheet && targetSpreadsheet.getId() !== sourceSpreadsheet.getId()) {
    const sourceHeaders = sourceSheet.getRange(1, 1, 1, PAYMENT_SCHEDULE_HEADERS.length).getDisplayValues()[0];
    const targetHeaders = targetSheet.getRange(1, 1, 1, PAYMENT_SCHEDULE_HEADERS.length).getDisplayValues()[0];
    if (JSON.stringify(sourceHeaders) !== JSON.stringify(targetHeaders)) {
      throw new Error("새 관리대장 파일의 열을 확인하지 못해 기존 탭을 유지했습니다.");
    }
    sourceSpreadsheet.deleteSheet(sourceSheet);
  }
  const output = Object.assign({}, result, {
    moved: true,
    spreadsheetId: targetSpreadsheet.getId(),
    folderId: COMPLAINT_CONFIG.PAYMENT_SCHEDULE_DRIVE_FOLDER_ID,
    fileName: targetSpreadsheet.getName()
  });
  Logger.log(JSON.stringify(output));
  return output;
}

function setupPaymentScheduleSheet_() {
  const spreadsheet = SpreadsheetApp.openById(paymentScheduleSpreadsheetId_());
  let sheet = spreadsheet.getSheetByName(PAYMENT_SCHEDULE_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(PAYMENT_SCHEDULE_SHEET_NAME);

  const existingHeaderCount = Math.max(sheet.getLastColumn(), PAYMENT_SCHEDULE_HEADERS.length - 1);
  const existingHeaders = sheet.getRange(1, 1, 1, existingHeaderCount).getDisplayValues()[0]
    .map(value => String(value || "").trim());
  if (existingHeaders.indexOf("연락처") === -1 && existingHeaders[4] === "입금자명") {
    sheet.insertColumnAfter(4);
  }

  const headerCount = PAYMENT_SCHEDULE_HEADERS.length;
  if (sheet.getMaxColumns() < headerCount) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headerCount - sheet.getMaxColumns());
  }
  sheet.getRange(1, 1, 1, headerCount).setValues([PAYMENT_SCHEDULE_HEADERS]);
  sheet.setFrozenRows(1);
  sheet.setTabColor("#1b335f");
  sheet.getRange(1, 1, 1, headerCount)
    .setBackground("#1b335f")
    .setFontColor("#ffffff")
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(1, 34);

  const widths = [120, 190, 90, 110, 135, 110, 120, 105, 115, 115, 90, 240];
  widths.forEach((width, index) => sheet.setColumnWidth(index + 1, width));
  sheet.getRange("E2:E").setNumberFormat("@");
  sheet.getRange("G2:G").setNumberFormat("#,##0").setHorizontalAlignment("right");
  sheet.getRange("H2:H").setNumberFormat("0").setHorizontalAlignment("center");
  sheet.getRange("I2:J").setNumberFormat("yyyy-mm-dd").setHorizontalAlignment("center");
  sheet.getRange("K2:K").setHorizontalAlignment("center");
  sheet.getRange("L2:L").setWrap(true);

  const statusValidation = SpreadsheetApp.newDataValidation()
    .requireValueInList(["계약중", "종료", "보류"], true)
    .setAllowInvalid(false)
    .setHelpText("계약중, 종료, 보류 중 하나를 선택하세요.")
    .build();
  sheet.getRange("K2:K").setDataValidation(statusValidation);

  const buildingNames = paymentBuildingRegistryRecords_().map(item => item.name);
  if (buildingNames.length) {
    const buildingValidation = SpreadsheetApp.newDataValidation()
      .requireValueInList(buildingNames, true)
      .setAllowInvalid(false)
      .setHelpText("입금확인 캘린더에 등록된 건물을 선택하세요.")
      .build();
    sheet.getRange("B2:B").setDataValidation(buildingValidation);
  }

  if (!sheet.getFilter()) sheet.getRange(1, 1, sheet.getMaxRows(), headerCount).createFilter();
  sheet.getRange("A2:A").setBackground("#f3f6fb").setFontColor("#6b7686");
  sheet.getRange("A1").setNote("자동 동기화용 번호입니다. 직접 수정하지 마세요.");
  sheet.getRange("E1").setNote("납부 당일·미입금 안내 문자를 받을 세입자 휴대폰 번호를 입력하세요.");
  sheet.getRange("F1").setNote("은행 통장에 실제로 표시되는 입금자명을 입력하세요. 세입자명과 다를 수 있습니다.");
  sheet.getRange("H1").setNote("매월 납부일을 1~31 사이 숫자로 입력하세요. 31일이 없는 달은 말일로 표시됩니다.");

  const sheetUrl = spreadsheet.getUrl() + "#gid=" + sheet.getSheetId();
  firebaseWriteRequest_(
    firebaseCaseSettingsUrl_("paymentScheduleSheet"),
    "patch",
    { name: PAYMENT_SCHEDULE_SHEET_NAME, url: sheetUrl, updatedAt: new Date().toISOString(), autoSyncEnabled: true, build: AUTOMATION_BUILD },
    "세입자 월세 관리대장 연결정보 저장 실패"
  );
  return { ok: true, sheetName: PAYMENT_SCHEDULE_SHEET_NAME, sheetUrl: sheetUrl, build: AUTOMATION_BUILD };
}

function paymentBuildingRegistryRecords_() {
  const registry = firebaseReadJson_(firebaseCaseSettingsUrl_("paymentBuildings"), "입금 캘린더 건물 조회 실패") || {};
  return Object.keys(registry).map(key => {
    const item = registry[key] || {};
    return {
      id: String(item.id || item.driveFileId || key),
      name: String(item.building || item.name || "").trim(),
      address: String(item.address || "").trim()
    };
  }).filter(item => item.id && item.name);
}

function paymentScheduleSheetText_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, "Asia/Seoul", "yyyy-MM-dd");
  }
  return String(value == null ? "" : value).trim();
}

function paymentScheduleSheetMonth_(value, fallbackMonth) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, "Asia/Seoul", "yyyy-MM");
  }
  const text = paymentScheduleSheetText_(value);
  const match = text.match(/^(\d{4})[-./년\s]+(\d{1,2})/);
  if (!match) return fallbackMonth || "";
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? match[1] + "-" + String(month).padStart(2, "0") : (fallbackMonth || "");
}

function paymentScheduleSheetNumber_(value) {
  if (typeof value === "number" && isFinite(value)) return Math.round(value);
  const digits = paymentScheduleSheetText_(value).replace(/[^0-9.-]/g, "");
  const number = Number(digits);
  return isFinite(number) ? Math.round(number) : 0;
}

function paymentScheduleSheetId_() {
  return "sheet_" + Utilities.getUuid().replace(/-/g, "").slice(0, 20);
}

function paymentScheduleHeaderMap_(headers) {
  const out = {};
  (headers || []).forEach((header, index) => { out[paymentScheduleSheetText_(header)] = index; });
  return out;
}

function paymentScheduleRowValue_(row, headerMap, header) {
  const index = headerMap[header];
  return index === undefined ? "" : row[index];
}

function paymentScheduleRecordFromSheetRow_(row, headerMap, byName, currentMonth, id, rowNumber, requestedAt) {
  const buildingName = paymentScheduleSheetText_(paymentScheduleRowValue_(row, headerMap, "건물명"));
  const unit = paymentScheduleSheetText_(paymentScheduleRowValue_(row, headerMap, "호실"));
  const tenantName = paymentScheduleSheetText_(paymentScheduleRowValue_(row, headerMap, "세입자명"));
  const tenantPhoneRaw = paymentScheduleSheetText_(paymentScheduleRowValue_(row, headerMap, "연락처"));
  const tenantPhone = tenantPhoneRaw.replace(/\D/g, "");
  const payerName = paymentScheduleSheetText_(paymentScheduleRowValue_(row, headerMap, "입금자명")) || tenantName;
  const amount = paymentScheduleSheetNumber_(paymentScheduleRowValue_(row, headerMap, "월 납부금액"));
  const dueDay = paymentScheduleSheetNumber_(paymentScheduleRowValue_(row, headerMap, "매월 납부일"));
  const startMonth = paymentScheduleSheetMonth_(paymentScheduleRowValue_(row, headerMap, "계약 시작일"), currentMonth);
  const endMonth = paymentScheduleSheetMonth_(paymentScheduleRowValue_(row, headerMap, "계약 종료일"), "");
  const status = paymentScheduleSheetText_(paymentScheduleRowValue_(row, headerMap, "상태")) || "계약중";
  const note = paymentScheduleSheetText_(paymentScheduleRowValue_(row, headerMap, "비고"));
  const matches = byName[normalizeText_(buildingName)] || [];
  const problems = [];
  if (!buildingName) problems.push("건물명");
  else if (!matches.length) problems.push("등록된 건물명과 불일치");
  else if (matches.length > 1) problems.push("같은 이름의 건물이 여러 곳임");
  if (!unit) problems.push("호실");
  if (!tenantName) problems.push("세입자명");
  if (tenantPhoneRaw && !/^01[016789]\d{7,8}$/.test(tenantPhone)) problems.push("연락처(휴대폰 번호)");
  if (!payerName) problems.push("입금자명");
  if (amount <= 0) problems.push("월 납부금액");
  if (dueDay < 1 || dueDay > 31) problems.push("매월 납부일(1~31)");
  if (endMonth && endMonth < startMonth) problems.push("계약 종료일");
  if (["계약중", "종료", "보류"].indexOf(status) === -1) problems.push("상태");
  if (problems.length) return { id: id, problems: problems, schedule: null };

  const building = matches[0];
  return {
    id: id,
    problems: [],
    schedule: {
      id: id,
      buildingId: building.id,
      buildingName: building.name,
      unit: unit,
      tenantName: tenantName,
      tenantPhone: tenantPhone,
      payerName: payerName,
      amount: amount,
      dueDay: dueDay,
      startMonth: startMonth,
      endMonth: endMonth,
      active: status === "계약중" || (status === "종료" && !!endMonth),
      contractStatus: status,
      note: note,
      source: "tenant_sheet",
      sourceSheetName: PAYMENT_SCHEDULE_SHEET_NAME,
      sourceSheetRow: rowNumber,
      updatedAt: requestedAt
    }
  };
}

function firebasePaymentCalendarUrl_(uid, childPath, idToken) {
  const safeUid = String(uid || "").trim();
  if (!/^[A-Za-z0-9:_-]{6,160}$/.test(safeUid)) throw new Error("로그인 사용자 ID가 올바르지 않습니다.");
  const base = COMPLAINT_CONFIG.FIREBASE_DATABASE_URL.replace(/\/$/, "");
  const child = String(childPath || "").split("/").filter(Boolean).map(part => encodeURIComponent(part)).join("/");
  const token = String(idToken || "").trim();
  if (!token) throw new Error("로그인 인증정보가 없습니다. 다시 로그인해 주세요.");
  return base + "/paymentCalendars/" + encodeURIComponent(safeUid) + (child ? "/" + child : "") + ".json?auth=" + encodeURIComponent(token);
}

function firebaseReadJson_(url, label) {
  const response = UrlFetchApp.fetch(url, { method: "get", muteHttpExceptions: true });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) throw new Error(label + ": HTTP " + code + " / " + response.getContentText());
  const body = response.getContentText();
  return body && body !== "null" ? JSON.parse(body) : null;
}

function writePaymentSheetSyncStatus_(payload, status) {
  try {
    firebaseAuthorizedWriteRequest_(
      firebasePaymentCalendarUrl_(payload.uid, "sheetSync", payload.idToken),
      "put",
      status,
      "세입자 자료 동기화 상태 저장 실패"
    );
  } catch (err) {
    Logger.log("세입자 자료 동기화 상태 저장 실패: " + err.message);
  }
}

function firebaseAuthorizedWriteRequest_(url, method, payload, label) {
  return firebaseWriteRequest_(url, method, payload, label);
}

function syncPaymentSchedulesFromSheet_(payload) {
  payload = payload || {};
  const requestedAt = new Date().toISOString();
  const currentMonth = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM");
  try {
    const sheet = SpreadsheetApp.openById(paymentScheduleSpreadsheetId_()).getSheetByName(PAYMENT_SCHEDULE_SHEET_NAME);
    if (!sheet) throw new Error("세입자 월세 관리대장 탭을 찾지 못했습니다.");
    const lastRow = sheet.getLastRow();
    const lastColumn = Math.max(sheet.getLastColumn(), PAYMENT_SCHEDULE_HEADERS.length);
    const values = sheet.getRange(1, 1, Math.max(lastRow, 1), lastColumn).getValues();
    const headerMap = paymentScheduleHeaderMap_(values[0] || []);
    const missingHeaders = PAYMENT_SCHEDULE_HEADERS.filter(header => headerMap[header] === undefined);
    if (missingHeaders.length) throw new Error("관리대장 필수 열이 없습니다: " + missingHeaders.join(", "));

    const buildings = paymentBuildingRegistryRecords_();
    const byName = {};
    buildings.forEach(building => {
      const key = normalizeText_(building.name);
      byName[key] = byName[key] || [];
      byName[key].push(building);
    });

    const schedules = {};
    const errors = [];
    const errorIds = {};
    for (let index = 1; index < values.length; index += 1) {
      const row = values[index];
      const rowNumber = index + 1;
      const hasContent = row.slice(1, PAYMENT_SCHEDULE_HEADERS.length).some(value => paymentScheduleSheetText_(value));
      if (!hasContent) continue;

      let id = paymentScheduleSheetText_(paymentScheduleRowValue_(row, headerMap, "관리번호"));
      if (!id) {
        id = paymentScheduleSheetId_();
        sheet.getRange(rowNumber, headerMap["관리번호"] + 1).setValue(id);
      }
      const parsed = paymentScheduleRecordFromSheetRow_(row, headerMap, byName, currentMonth, id, rowNumber, requestedAt);
      if (parsed.problems.length) {
        errors.push({ row: rowNumber, message: parsed.problems.join(" · ") });
        errorIds[id] = true;
        continue;
      }
      schedules[id] = parsed.schedule;
    }

    const schedulesUrl = firebasePaymentCalendarUrl_(payload.uid, "schedules", payload.idToken);
    const existing = firebaseReadJson_(schedulesUrl, "기존 월 납부 일정 조회 실패") || {};
    const merged = {};
    Object.keys(existing).forEach(id => {
      const item = existing[id] || {};
      if (item.source !== "tenant_sheet" || (errors.length && errorIds[id])) merged[id] = item;
    });
    Object.keys(schedules).forEach(id => {
      schedules[id].createdAt = existing[id] && existing[id].createdAt || requestedAt;
      merged[id] = schedules[id];
    });
    firebaseAuthorizedWriteRequest_(schedulesUrl, "put", merged, "세입자 월 납부 일정 저장 실패");

    const status = {
      ok: true,
      count: Object.keys(schedules).length,
      errorCount: errors.length,
      errors: errors.slice(0, 20),
      updatedAt: new Date().toISOString(),
      requestedBy: String(payload.adminEmail || ""),
      build: AUTOMATION_BUILD
    };
    writePaymentSheetSyncStatus_(payload, status);
    return status;
  } catch (err) {
    const status = {
      ok: false,
      count: 0,
      errorCount: 1,
      errors: [{ row: 0, message: err.message }],
      updatedAt: new Date().toISOString(),
      requestedBy: String(payload.adminEmail || ""),
      build: AUTOMATION_BUILD
    };
    writePaymentSheetSyncStatus_(payload, status);
    throw err;
  }
}

function paymentReminderDueDate_(month, dueDay) {
  const match = String(month || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) throw new Error("납부월이 올바르지 않습니다.");
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) throw new Error("납부월이 올바르지 않습니다.");
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const day = Math.min(Math.max(1, Number(dueDay) || 1), lastDay);
  return match[1] + "-" + match[2] + "-" + String(day).padStart(2, "0");
}

function paymentReminderSmsContent_(schedule, dueDate, reminderType) {
  const dateParts = String(dueDate || "").split("-");
  const displayDate = Number(dateParts[0]) + "년 " + Number(dateParts[1]) + "월 " + Number(dateParts[2]) + "일";
  const amount = Number(schedule.amount) || 0;
  return [
    "[BRING Care]",
    schedule.tenantName ? schedule.tenantName + "님, 안녕하세요." : "안녕하세요.",
    reminderType === "due" ? "오늘은 월세 납부일입니다." : "월세 입금이 아직 확인되지 않아 안내드립니다.",
    schedule.buildingName ? "건물: " + schedule.buildingName : "",
    schedule.unit ? "호실: " + schedule.unit : "",
    amount ? "납부금액: " + Math.round(amount).toLocaleString("ko-KR") + "원" : "",
    "납부일: " + displayDate,
    "이미 납부하셨다면 확인에 시간이 걸릴 수 있으니 이 문자는 무시해 주세요."
  ].filter(Boolean).join("\n");
}

function handlePaymentReminderSms_(payload) {
  payload = payload || {};
  const scheduleId = String(payload.scheduleId || "").trim();
  const month = String(payload.month || "").trim();
  if (!/^[A-Za-z0-9_-]{6,160}$/.test(scheduleId)) throw new Error("월 납부 일정 ID가 올바르지 않습니다.");
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("납부월이 올바르지 않습니다.");

  const scheduleUrl = firebasePaymentCalendarUrl_(payload.uid, "schedules/" + scheduleId, payload.idToken);
  const schedule = firebaseReadJson_(scheduleUrl, "월 납부 일정 조회 실패");
  if (!schedule || schedule.active === false) throw new Error("발송할 월 납부 일정을 찾지 못했습니다.");

  const tenantPhone = normalizePhoneForSms_(schedule.tenantPhone || "");
  if (!isSendableSmsPhone_(tenantPhone)) throw new Error("관리대장의 세입자 연락처를 확인해 주세요.");
  const dueDate = paymentReminderDueDate_(month, schedule.dueDay);
  const today = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
  const status = String(payload.status || "");
  const reminderType = dueDate === today ? "due" : "unpaid";
  if (reminderType !== "due" && ["overdue", "manual_unpaid"].indexOf(status) === -1) {
    throw new Error("납부 당일 또는 미입금 일정에만 안내 문자를 보낼 수 있습니다.");
  }

  const recordUrl = firebasePaymentCalendarUrl_(payload.uid, "rentSms/" + month + "/" + scheduleId, payload.idToken);
  const existing = firebaseReadJson_(recordUrl, "기존 월세 안내 문자 기록 조회 실패") || {};
  if (existing.ok === true && payload.force !== true) {
    return Object.assign({}, existing, { skipped: true, message: "이미 발송된 기록이 있습니다." });
  }

  const content = paymentReminderSmsContent_(schedule, dueDate, reminderType);
  const result = sendSensSms_(tenantPhone, content, "월세 안내");
  const record = {
    ok: result.ok === true,
    status: result.ok === true ? "발송요청 완료" : "발송실패",
    message: result.message || "",
    requestId: result.requestId || "",
    reminderType: reminderType,
    scheduleId: scheduleId,
    month: month,
    dueDate: dueDate,
    phoneMasked: maskPhone_(tenantPhone),
    sentAt: new Date().toISOString(),
    sentBy: String(payload.adminEmail || ""),
    build: AUTOMATION_BUILD
  };
  firebaseAuthorizedWriteRequest_(recordUrl, "put", record, "월세 안내 문자 기록 저장 실패");
  if (!result.ok) throw new Error(result.message || "월세 안내 문자 발송에 실패했습니다.");
  return record;
}

function syncPaymentBuildingsFromOnboarding_() {
  const result = listDriveOnboardingCandidates_();
  if (!result.ok) throw new Error(result.error || "온보딩 건물 목록을 읽지 못했습니다.");

  const syncedAt = new Date().toISOString();
  const registry = {};
  result.candidates.forEach(candidate => {
    const file = candidate.file;
    const driveFileId = file.getId();
    const building = String(candidate.building || onboardingBuildingFromFileName_(file.getName()) || "").trim();
    if (!building) return;
    registry[driveFileId] = {
      id: driveFileId,
      driveFileId: driveFileId,
      building: building,
      address: String(candidate.address || "").trim(),
      ownerName: String(candidate.ownerName || "").trim(),
      fileName: file.getName(),
      fileUrl: file.getUrl(),
      source: "onboarding_drive",
      lastUpdatedAt: file.getLastUpdated().toISOString(),
      syncedAt: syncedAt
    };
  });

  firebaseWriteRequest_(
    firebaseCaseSettingsUrl_("paymentBuildings"),
    "put",
    registry,
    "입금 캘린더 건물 동기화 실패"
  );
  return { ok: true, count: Object.keys(registry).length, syncedAt: syncedAt, build: AUTOMATION_BUILD };
}

function diceSimilarity_(left, right) {
  left = String(left || "");
  right = String(right || "");
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return left === right ? 1 : 0;
  const counts = {};
  for (let i = 0; i < left.length - 1; i += 1) {
    const pair = left.slice(i, i + 2);
    counts[pair] = (counts[pair] || 0) + 1;
  }
  let overlap = 0;
  for (let i = 0; i < right.length - 1; i += 1) {
    const pair = right.slice(i, i + 2);
    if (counts[pair]) { overlap += 1; counts[pair] -= 1; }
  }
  return (2 * overlap) / ((left.length - 1) + (right.length - 1));
}

function rankDriveOnboardingCandidate_(candidate, inputBuilding, inputAddress) {
  const buildingKey = normalizeText_(inputBuilding);
  const addressKey = normalizeAddress_(inputAddress);
  const candidateBuildingKey = normalizeText_(candidate.building);
  const candidateAddressKey = normalizeAddress_(candidate.address);
  const fullTextKey = normalizeText_(candidate.text);
  const fullAddressKey = normalizeAddress_(candidate.text);
  const buildingExact = candidateBuildingKey === buildingKey || (!!buildingKey && fullTextKey.indexOf(buildingKey) >= 0);
  const addressExact = !!addressKey && (candidateAddressKey === addressKey || fullAddressKey.indexOf(addressKey) >= 0);
  const buildingScore = buildingExact ? 1 : Math.max(diceSimilarity_(buildingKey, candidateBuildingKey), diceSimilarity_(buildingKey, fullTextKey.slice(0, Math.max(buildingKey.length * 3, 80))));
  const addressScore = addressExact ? 1 : diceSimilarity_(addressKey, candidateAddressKey);
  candidate.matchRank = buildingExact && addressExact ? 3 : buildingExact ? 2 : 1;
  candidate.buildingScore = Math.round(buildingScore * 1000) / 1000;
  candidate.addressScore = Math.round(addressScore * 1000) / 1000;
  candidate.matchScore = Math.round((buildingScore * 0.6 + addressScore * 0.4) * 1000) / 1000;
  return candidate;
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
    source: options.source || "drive_ranked",
    status: "matched",
    statusText: options.statusText,
    fileName: fileName,
    fileUrl: fileUrl,
    driveFileId: driveFileId,
    candidateCount: options.candidateCount,
    matchLevel: options.matchLevel || "",
    matchScore: Number(options.matchScore || 0),
    buildingScore: Number(options.buildingScore || 0),
    addressScore: Number(options.addressScore || 0),
    matchedBuilding: options.matchedBuilding || inputBuilding,
    matchedAddress: options.matchedAddress || inputAddress,
    ownerName: options.ownerName || "",
    candidates: options.candidates || [],
    contract: {
      building: options.matchedBuilding || inputBuilding,
      address: options.matchedAddress || inputAddress,
      ownerName: options.ownerName || "",
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

function isSmsCompleteStatus_(status) {
  return /발송\s*완료/.test(String(status || ""));
}

function isSmsPartialStatus_(status) {
  return /일부\s*발송/.test(String(status || ""));
}

function isSmsSentStatus_(status) {
  return isSmsCompleteStatus_(status) || isSmsPartialStatus_(status);
}

function sendComplaintSms_(ticketNo, record, analysis, contractMatch, options) {
  const force = options && options.force === true;
  const existingStatus = readField_(record, ["문자 발송 상태"]);
  if (!force && isSmsSentStatus_(existingStatus)) {
    return {
      status: existingStatus,
      statusText: readField_(record, ["문자 발송 메모"]) || "이미 발송된 문자 기록이 있어 재발송하지 않았습니다.",
      skipped: true
    };
  }

  const config = getSensConfig_();
  if (!config.enabled) {
    return { status: "설정필요", statusText: "NCP SENS Script Properties 설정 후 문자 발송이 가능합니다.", skipped: true };
  }

  const tenantPhoneRaw = normalizePhoneForSms_(readField_(record, ["연락처", "전화번호", "휴대폰"]));
  const ownerPhoneRaw = normalizePhoneForSms_(extractOwnerPhoneFromOnboarding_(contractMatch));
  const tenantPhone = isSendableSmsPhone_(tenantPhoneRaw) ? tenantPhoneRaw : "";
  const ownerPhone = isSendableSmsPhone_(ownerPhoneRaw) ? ownerPhoneRaw : "";
  const building = readField_(record, ["건물명", "건물"]);
  const room = readField_(record, ["호실"]);
  const issueType = readField_(record, ["문제 유형"]);
  const tenantContent = [
    "[BRING Care]",
    "민원이 접수되었습니다.",
    "접수번호: " + ticketNo,
    building ? "건물: " + building : "",
    room ? "호실: " + formatRoomForCase_(room) : "",
    issueType ? "문제: " + issueType : "",
    "확인 후 안내드리겠습니다."
  ].filter(Boolean).join("\n");
  const ownerContent = [
    "[BRING Care]",
    "건물 민원이 접수되었습니다.",
    "접수번호: " + ticketNo,
    building ? "건물: " + building : "",
    room ? "호실: " + formatRoomForCase_(room) : "",
    issueType ? "문제: " + issueType : ""
  ].filter(Boolean).join("\n");

  const logs = [];
  let tenantSent = false;
  let ownerSent = false;
  let tenantReceipt = {};
  let ownerReceipt = {};

  if (tenantPhone) {
    const tenantResult = sendSensSms_(tenantPhone, tenantContent, "세입자");
    tenantReceipt = tenantResult;
    tenantSent = tenantResult.ok;
    logs.push("세입자 " + maskPhone_(tenantPhone) + " " + tenantResult.message);
  } else if (tenantPhoneRaw) {
    logs.push("세입자 연락처 형식 확인 필요");
  } else {
    logs.push("세입자 연락처 없음");
  }

  if (ownerPhone) {
    const ownerResult = sendSensSms_(ownerPhone, ownerContent, "건물주");
    ownerReceipt = ownerResult;
    ownerSent = ownerResult.ok;
    logs.push("건물주 " + maskPhone_(ownerPhone) + " " + ownerResult.message);
  } else {
    logs.push("건물주 연락처 미확인: 온보딩 수집서 본문에 '건물주 연락처: 010-0000-0000' 형식으로 넣어주세요.");
  }

  const status = tenantSent && ownerSent ? "발송완료" : tenantSent || ownerSent ? "일부발송" : "발송보류";
  const statusSummary = logs.join(" / ");
  return {
    ok: status === "발송완료",
    status: status,
    statusSummary: statusSummary,
    statusText: statusSummary + "\n\n" + makeComplaintSmsPreview_(tenantContent, ownerContent),
    tenantSent: tenantSent,
    ownerSent: ownerSent,
    tenantPhoneMasked: tenantPhone ? maskPhone_(tenantPhone) : "",
    ownerPhoneMasked: ownerPhone ? maskPhone_(ownerPhone) : "",
    tenantRequestId: tenantReceipt.requestId || "",
    ownerRequestId: ownerReceipt.requestId || "",
    requestIds: [tenantReceipt.requestId, ownerReceipt.requestId].filter(Boolean),
    deliveryAccepted: status === "발송완료",
    completedAt: status === "발송완료" ? new Date().toISOString() : ""
  };
}

function makeComplaintSmsPreview_(tenantContent, ownerContent) {
  return [
    "[발송 예시 - 세입자]",
    tenantContent || "세입자 발송 문구 없음",
    "",
    "[발송 예시 - 건물주]",
    ownerContent || "건물주 발송 문구 없음"
  ].join("\n");
}

function applySmsResultToCase_(casePayload, smsResult) {
  if (!smsResult) return;
  casePayload.sms = smsResult;
  casePayload.complaintReceiptSms = smsResult;
  casePayload.automationState = Object.assign({}, casePayload.automationState || {});
  casePayload.automationState.receiptSms = {
    ok: isSmsCompleteStatus_(smsResult.status),
    status: smsResult.status || "",
    requestIds: smsResult.requestIds || [],
    tenantRequestId: smsResult.tenantRequestId || "",
    ownerRequestId: smsResult.ownerRequestId || "",
    deliveryAccepted: isSmsCompleteStatus_(smsResult.status),
    completedAt: smsResult.completedAt || "",
    updatedAt: new Date().toISOString(),
    build: AUTOMATION_BUILD
  };
  casePayload.note = casePayload.note || {};
  casePayload.note.c2 = smsResult.statusText || "";
  casePayload.status = casePayload.status || {};
  if (isSmsCompleteStatus_(smsResult.status)) {
    casePayload.status.c2 = "done";
  } else if (isSmsPartialStatus_(smsResult.status) || smsResult.status === "발송보류") {
    casePayload.status.c2 = "doing";
  } else if (smsResult.status) {
    casePayload.status.c2 = "doing";
  }
  if (casePayload.log) {
    casePayload.log.push("문자 " + smsResult.status + " / " + (smsResult.statusSummary || smsResult.statusText || ""));
  }
}

function getSensConfig_() {
  const props = PropertiesService.getScriptProperties();
  const enabled = String(props.getProperty("SMS_ENABLED") || "true").toLowerCase() !== "false";
  const config = {
    enabled: enabled,
    serviceId: props.getProperty("NCP_SENS_SERVICE_ID") || "",
    accessKey: props.getProperty("NCP_ACCESS_KEY") || "",
    secretKey: props.getProperty("NCP_SECRET_KEY") || "",
    from: normalizePhoneForSms_(props.getProperty("NCP_SENS_FROM") || "")
  };
  config.enabled = Boolean(config.enabled && config.serviceId && config.accessKey && config.secretKey && config.from);
  return config;
}

function sendSensSms_(to, content, label) {
  const config = getSensConfig_();
  if (!config.enabled) return { ok: false, message: "SENS 설정필요" };
  to = normalizePhoneForSms_(to);
  if (!isSendableSmsPhone_(to)) return { ok: false, message: "수신번호 확인필요(" + label + ")" };

  const uri = "/sms/v2/services/" + encodeURIComponent(config.serviceId) + "/messages";
  const timestamp = String(Date.now());
  const signature = makeNcpSignature_("POST", uri, timestamp, config.accessKey, config.secretKey);
  const type = byteLength_(content) > 90 ? "LMS" : "SMS";
  const payload = {
    type: type,
    contentType: "COMM",
    countryCode: "82",
    from: config.from,
    content: content,
    messages: [{ to: to, content: content }]
  };
  if (type === "LMS") payload.subject = "BRING Care";

  try {
    const response = UrlFetchApp.fetch("https://sens.apigw.ntruss.com" + uri, {
      method: "post",
      contentType: "application/json; charset=utf-8",
      headers: {
        "x-ncp-apigw-timestamp": timestamp,
        "x-ncp-iam-access-key": config.accessKey,
        "x-ncp-apigw-signature-v2": signature
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    const body = response.getContentText();
    let json = {};
    try { json = body ? JSON.parse(body) : {}; } catch (err) {}
    if (code >= 200 && code < 300) {
      const receipt = sensResponseReceipt_(json);
      return {
        ok: true,
        message: "발송요청 완료(" + label + ")",
        requestId: receipt.requestId,
        statusCode: receipt.statusCode,
        statusName: receipt.statusName,
        responseCode: code
      };
    }
    return { ok: false, message: "발송실패(" + label + " HTTP " + code + "): " + body.slice(0, 200) };
  } catch (err) {
    return { ok: false, message: "발송오류(" + label + "): " + err.message };
  }
}

function makeNcpSignature_(method, uri, timestamp, accessKey, secretKey) {
  const message = method + " " + uri + "\n" + timestamp + "\n" + accessKey;
  const signature = Utilities.computeHmacSha256Signature(message, secretKey);
  return Utilities.base64Encode(signature);
}

function extractOwnerPhoneFromOnboarding_(contractMatch) {
  if (!contractMatch || contractMatch.status !== "matched" || !contractMatch.driveFileId) return "";
  const text = extractDocxText_(contractMatch.driveFileId);
  if (!text) return "";

  const labelMatch = text.match(/건물주\s*(?:연락처|전화번호|휴대폰|번호)\s*[:：]?\s*((?:\+?82[-.\s]?)?0?\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4})/);
  if (labelMatch) return labelMatch[1];

  const anyPhone = text.match(/(?:\+?82[-.\s]?)?0?(?:10|11|16|17|18|19)[-.\s]?\d{3,4}[-.\s]?\d{4}/);
  return anyPhone ? anyPhone[0] : "";
}

function extractDocxText_(driveFileId) {
  try {
    const blobs = unzipOfficeBlob_(DriveApp.getFileById(driveFileId).getBlob());
    const xml = blobs
      .filter(blob => /^word\/(?:document|header\d*|footer\d*)\.xml$/.test(blob.getName()))
      .map(blob => blob.getDataAsString("UTF-8"))
      .join("\n");
    return decodeXmlText_(xml);
  } catch (err) {
    Logger.log("DOCX 본문 추출 실패: " + err.message);
    return "";
  }
}

function decodeXmlText_(xml) {
  return String(xml || "")
    .replace(/<w:tab\/>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePhoneForSms_(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.indexOf("82") === 0) digits = "0" + digits.slice(2);
  return digits;
}

function isSendableSmsPhone_(phone) {
  return /^0\d{8,10}$/.test(String(phone || ""));
}

function byteLength_(value) {
  return Utilities.newBlob(String(value || "")).getBytes().length;
}

function testSensSmsSetup() {
  const props = PropertiesService.getScriptProperties();
  const to = normalizePhoneForSms_(props.getProperty("NCP_SENS_TEST_TO") || "");
  if (!to) throw new Error("Script Properties에 NCP_SENS_TEST_TO를 테스트 수신번호로 넣어주세요.");
  const result = sendSensSms_(to, "[BRING Care]\nSENS 문자 연동 테스트입니다.", "테스트");
  Logger.log(JSON.stringify(result));
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

function makeConsultationNote_(ticketNo, record, analysis, sheetUrl) {
  const building = readField_(record, ["건물명", "건물"]) || "건물 미입력";
  const room = readField_(record, ["호실"]) || "호실 미입력";
  const issueType = readField_(record, ["문제 유형"]) || "문제 유형 미입력";
  const description = readField_(record, ["증상 설명", "민원 내용", "내용"]);
  const photo = readField_(record, ["사진 첨부"]);
  const visitTime = formatVisitTimeFromRecord_(record);
  const extra = readField_(record, ["추가 요청사항"]);
  const questions = consultationQuestions_(issueType, [issueType, description, extra].join(" "));
  const warnings = consultationWarnings_(description, photo, visitTime, analysis);

  return [
    "[상담 요약]",
    analysis.summary || makeSummary_(record, issueType, description),
    "",
    "[접수 정보]",
    "접수번호: " + ticketNo,
    "건물/호실: " + building + " / " + room,
    "문제 유형: " + issueType,
    "방문 가능 시간: " + (visitTime || "미입력"),
    "사진/원본: " + (sheetUrl ? "응답 시트에서 확인" : (photo ? "첨부됨" : "미확인")),
    "",
    "[추가 확인 질문]",
    questions.map(item => "- " + item).join("\n"),
    "",
    "[누락/주의]",
    warnings.map(item => "- " + item).join("\n"),
    "",
    "[다음 액션]",
    "- ④ 민원·요청 분류에서 업체 분류 확인: " + (analysis.vendorType || "관리자 확인"),
    "- 긴급도 확인: " + (analysis.urgency || "미확인"),
    sheetUrl ? "- 개인정보/사진 원본 링크: " + sheetUrl : ""
  ].filter(line => line !== "").join("\n");
}

function consultationQuestions_(issueType, haystack) {
  const text = String(haystack || "").toLowerCase();
  if (issueType === "전기" || /전기|차단기|정전|스파크|조명/.test(text)) {
    return ["전체 정전인지 해당 호실만 문제인지 확인", "차단기가 반복해서 내려가는지 확인", "타는 냄새나 스파크가 있었는지 확인"];
  }
  if (issueType === "누수" || issueType === "배관" || /누수|배관|물|천장|배수|역류/.test(text)) {
    return ["물이 떨어지는 위치와 범위 확인", "계속 새는지 간헐적으로 새는지 확인", "아래층 피해나 전기 설비 근처 누수 여부 확인"];
  }
  if (issueType === "도어락" || /도어락|문|잠금|출입/.test(text)) {
    return ["현재 출입 가능 여부 확인", "배터리 교체 여부 확인", "문틀/잠금장치 물리적 걸림 여부 확인"];
  }
  if (issueType === "보일러" || /보일러|난방|온수/.test(text)) {
    return ["온수와 난방 중 어떤 기능 문제인지 확인", "에러코드 표시 여부 확인", "가스 밸브와 전원 상태 확인"];
  }
  if (issueType === "에어컨" || /에어컨|냉방|실외기/.test(text)) {
    return ["전원이 켜지는지 확인", "냉방이 안 되는지 누수/소음 문제인지 확인", "실외기 작동 여부 확인"];
  }
  return ["현장 확인이 필요한 증상인지 확인", "사진 추가 요청 필요 여부 확인", "방문 가능 시간 재확인"];
}

function consultationWarnings_(description, photo, visitTime, analysis) {
  const warnings = [];
  if (!photo) warnings.push("사진 첨부 없음: 현장 판단 전 사진 요청 권장");
  if (!description || String(description).replace(/\s/g, "").length < 12) warnings.push("설명이 짧음: 증상 세부 확인 필요");
  if (!visitTime) warnings.push("방문 가능 시간 미입력: 일정 조율 전 확인 필요");
  if (analysis && analysis.urgency === "긴급") warnings.push("긴급 표현 감지: 관리자 우선 확인");
  if (!warnings.length) warnings.push("필수 상담 정보는 1차로 확보됨");
  return warnings;
}

function makeClassificationNote_(ticketNo, record, analysis) {
  const issueType = readField_(record, ["문제 유형"]) || "문제 유형 미입력";
  const vendorType = analysis.vendorType || "관리자 확인";
  const urgency = analysis.urgency || "미확인";
  const siteVisit = classificationSiteVisit_(issueType, vendorType, urgency);
  const quoteNeed = classificationQuoteNeed_(vendorType);
  const reasons = classificationReasonLines_(analysis);

  return [
    "[민원·요청 분류]",
    "업체 분류: " + vendorType,
    "긴급도: " + urgency,
    "현장/견적: " + siteVisit + " / " + quoteNeed,
    "근거: " + reasons[0],
    "접수번호: " + ticketNo + " · 문제: " + issueType
  ].join("\n").replace(/\n+$/, "");
}

function classificationSiteVisit_(issueType, vendorType, urgency) {
  const text = [issueType, vendorType].join(" ");
  if (urgency === "긴급") return "필요";
  if (/전기|누수|배관|보일러|에어컨|도어락|출입|창호|문|청소|방역|공용부/.test(text)) return "필요";
  return "확인 필요";
}

function classificationQuoteNeed_(vendorType) {
  return vendorType === "관리자 확인" ? "확인 필요" : "필요";
}

function classificationReasonLines_(analysis) {
  const lines = [];
  if (analysis && analysis.reason) lines.push(analysis.reason);
  if (analysis && analysis.urgency === "긴급") lines.push("긴급도 우선 확인 후 업체 연결이 필요합니다.");
  if (analysis && analysis.vendorType === "관리자 확인") lines.push("업체 분류가 명확하지 않아 관리자 확인이 필요합니다.");
  if (!lines.length) lines.push("구글폼 접수 내용과 상담카드 기준으로 1차 분류했습니다.");
  return lines;
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
  const visitDateRaw = readRawField_(record, ["방문 가능 날짜", "방문 날짜", "방문일"]);
  const visitTime = formatVisitTimeFromRecord_(record, timestamp);
  const sheetUrl = COMPLAINT_CONFIG.RESPONSE_SHEET_URL + "#gid=" + sheet.getSheetId();
  const ownerPhone = normalizePhoneForSms_(extractOwnerPhoneFromOnboarding_(contractMatch));
  const isContractHold = contractMatch && (contractMatch.status === "unmatched" || contractMatch.status === "multiple" || contractMatch.status === "address_missing");
  const statusValue = isContractHold ? "계약확인보류" : analysis.statusValue;
  const status = isContractHold ? { c1: "doing" } : { c1: "done", c2: "doing" };
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
    sheetUrl: sheetUrl,
    sheetRow: row,
    name: maskName_(name) || "세입자",
    phone: maskPhone_(phone),
    email: "",
    building: building,
    address: address,
    room: formatRoomForCase_(room),
    grade: contractMatch && contractMatch.contract && contractMatch.contract.grade ? contractMatch.contract.grade : "스탠다드",
    issueType: issueType,
    urgency: analysis.urgency,
    vendorType: analysis.vendorType,
    summary: analysis.summary,
    analysisReason: analysis.reason,
    visitDate: formatKoreanDateOnlyForCase_(visitDateRaw || timestamp),
    visitTime: visitTime,
    statusValue: statusValue,
    contractMatch: contractMatch,
    ownerPhoneMasked: ownerPhone ? maskPhone_(ownerPhone) : "",
    status: status,
    note: {
      c1: c1Note,
      c3: makeConsultationNote_(ticketNo, record, analysis, sheetUrl),
      c4: makeClassificationNote_(ticketNo, record, analysis),
      c11: visitTime ? "방문 가능 시간: " + visitTime : ""
    },
    log: [
      Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm") + " 구글폼 자동 접수",
      "긴급도 " + analysis.urgency + " / 업체분류 " + analysis.vendorType,
      contractMatch ? "온보딩매칭 " + contractMatch.status + " / " + contractMatch.statusText : "온보딩매칭 미확인"
    ]
  };
}

function writeAnalysisToSheet_(sheet, row, headers, ticketNo, analysis, casePayload, contractMatch, smsResult) {
  const headerMap = {};
  headers.forEach((header, index) => headerMap[header] = index + 1);
  const contract = contractMatch && contractMatch.contract ? contractMatch.contract : {};
  const fileName = (contractMatch && contractMatch.fileName) || contract.contractFileName || "";
  const statusText = contractMatch ? contractMatch.statusText : "";
  const matchStatus = contractMatch ? contractMatch.status : "미확인";
  const smsStatus = smsResult ? smsResult.status : "미확인";
  const smsText = smsResult ? smsResult.statusText : "";

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
  setCellByHeader_(sheet, row, headerMap, "문자 발송 상태", smsStatus);
  setCellByHeader_(sheet, row, headerMap, "문자 발송 메모", smsText);
  setCellByHeader_(sheet, row, headerMap, "Firebase Case ID", casePayload.id);
  setCellByHeader_(sheet, row, headerMap, "분석 처리일시", Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss"));
}

function setCellByHeader_(sheet, row, headerMap, header, value) {
  if (headerMap[header]) sheet.getRange(row, headerMap[header]).setValue(value);
}

function firebaseCaseUrl_(caseId, childPath) {
  const base = COMPLAINT_CONFIG.FIREBASE_DATABASE_URL.replace(/\/$/, "");
  const path = COMPLAINT_CONFIG.FIREBASE_CASES_PATH.replace(/^\/|\/$/g, "");
  const child = childPath
    ? "/" + String(childPath).split("/").filter(Boolean).map(part => encodeURIComponent(part)).join("/")
    : "";
  return base + "/" + path + "/" + encodeURIComponent(caseId) + child + ".json";
}

function firebaseCaseSettingsUrl_(childPath) {
  const base = COMPLAINT_CONFIG.FIREBASE_DATABASE_URL.replace(/\/$/, "");
  const child = String(childPath || "").split("/").filter(Boolean).map(part => encodeURIComponent(part)).join("/");
  return base + "/caseSettings" + (child ? "/" + child : "") + ".json";
}

function firebaseWriteRequest_(url, method, payload, label) {
  const response = UrlFetchApp.fetch(url, {
    method: method,
    contentType: "application/json; charset=utf-8",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(label + ": HTTP " + code + " / " + response.getContentText());
  }
  return response;
}

function patchCaseToFirebase_(caseId, patch) {
  return firebaseWriteRequest_(firebaseCaseUrl_(caseId), "patch", patch || {}, "Firebase 부분 저장 실패");
}

function patchCaseChildToFirebase_(caseId, childPath, patch) {
  return firebaseWriteRequest_(firebaseCaseUrl_(caseId, childPath), "patch", patch || {}, "Firebase 부분 저장 실패");
}

function putCaseChildToFirebase_(caseId, childPath, payload) {
  return firebaseWriteRequest_(firebaseCaseUrl_(caseId, childPath), "put", payload || {}, "Firebase 필드 저장 실패");
}

function mergeCasePayloadForFirebase_(existing, payload) {
  if (!existing || typeof existing !== "object") return payload;
  if (existing.deleted === true) {
    return Object.assign({}, existing, {
      archived: true,
      deleted: true,
      deletedAt: existing.deletedAt || new Date().toISOString(),
      updatedAt: existing.updatedAt || new Date().toISOString()
    });
  }
  const merged = Object.assign({}, existing, payload);

  const incomingStatus = Object.assign({}, payload.status || {});
  const existingStatus = Object.assign({}, existing.status || {});
  merged.status = {};
  const statusKeys = Object.keys(Object.assign({}, incomingStatus, existingStatus));
  statusKeys.forEach(key => {
    const incoming = incomingStatus[key];
    const current = existingStatus[key];
    merged.status[key] = workflowStatusRank_(incoming) > workflowStatusRank_(current) ? incoming : current;
  });
  merged.note = Object.assign({}, payload.note || {}, existing.note || {});

  [
    "log",
    "quoteFiles",
    "businessRegistrationFiles",
    "vendorSelections",
    "vendorEstimateMms",
    "ownerRecommendationMms",
    "ownerDecision",
    "quoteRequestRounds",
    "quoteRequestRound",
    "automationState",
    "complaintReceiptSms",
    "selectedVendors"
  ].forEach(key => {
    if (existing[key] !== undefined) merged[key] = existing[key];
  });

  if (existing.archived === true) {
    merged.archived = true;
    merged.archivedAt = existing.archivedAt || merged.archivedAt;
    merged.archivedBy = existing.archivedBy || merged.archivedBy;
  }

  return merged;
}

function writeCaseToFirebase_(caseId, payload) {
  const existing = readCaseFromFirebase_(caseId);
  if (existing && existing.deleted === true) {
    Logger.log("삭제된 케이스 저장 생략: " + caseId);
    return;
  }
  const merged = mergeCasePayloadForFirebase_(existing, payload || {});
  merged.updatedAt = new Date().toISOString();
  patchCaseToFirebase_(caseId, merged);
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

function formatRoomForCase_(room) {
  const v = String(room || "").trim();
  if (!v) return "";
  return /호$/.test(v) ? v : v + "호";
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

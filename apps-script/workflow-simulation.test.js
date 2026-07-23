"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sourcePath = path.join(__dirname, "complaint-intake-to-firebase.gs");
const source = fs.readFileSync(sourcePath, "utf8");

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Apps Script function not found: ${name}`);
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = braceStart; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (current === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (current === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === quote) quote = "";
      continue;
    }
    if (current === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (current === "\"" || current === "'" || current === "`") {
      quote = current;
      continue;
    }
    if (current === "{") depth += 1;
    if (current === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed Apps Script function: ${name}`);
}

const db = Object.create(null);
const ownerCalls = [];
const ownerLinkCalls = [];
let ownerSendSucceeds = true;
let ownerLinkSucceeds = true;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function mergeInto(target, patch) {
  Object.keys(patch || {}).forEach(key => {
    const value = patch[key];
    if (value === null) {
      delete target[key];
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      target[key] = target[key] && typeof target[key] === "object" && !Array.isArray(target[key]) ? target[key] : {};
      mergeInto(target[key], value);
    } else {
      target[key] = clone(value);
    }
  });
  return target;
}

function childNode(caseId, childPath, create) {
  db[caseId] = db[caseId] || {};
  const parts = String(childPath || "").split("/").filter(Boolean);
  let node = db[caseId];
  parts.slice(0, -1).forEach(part => {
    if (!node[part] && create) node[part] = {};
    node = node[part];
  });
  return { node, key: parts[parts.length - 1] };
}

const context = {
  console,
  Date,
  Math,
  Object,
  Array,
  String,
  Number,
  JSON,
  OWNER_PAYMENT_ACCOUNT: {
    accountNumber: "123-456-789012",
    accountHolder: "브링케어"
  },
  readCaseFromFirebase_(caseId) {
    return clone(db[caseId] || null);
  },
  patchCaseChildToFirebase_(caseId, childPath, value) {
    const target = childNode(caseId, childPath, true);
    target.node[target.key] = target.node[target.key] || {};
    mergeInto(target.node[target.key], value || {});
  },
  putCaseChildToFirebase_(caseId, childPath, value) {
    const target = childNode(caseId, childPath, true);
    target.node[target.key] = clone(value || {});
  },
  patchCaseToFirebase_(caseId, value) {
    db[caseId] = db[caseId] || {};
    mergeInto(db[caseId], value || {});
  },
  isSmsCompleteStatus_(status) {
    return ["sent", "success", "completed", "accepted"].includes(String(status || "").toLowerCase());
  },
  isBusinessRegistrationLikeQuote_(quote) {
    return quote && quote.documentType === "business_registration";
  },
  isGenericQuoteVendorValue_(value) {
    return /^(테스트|샘플|견적서|업체 확인 필요)$/i.test(String(value || "").trim());
  },
  parseMoneyValue_(value) {
    return Number(String(value || "").replace(/[^0-9.-]/g, "")) || 0;
  }
};

const functions = [
  "ownerQuoteOriginalAmount_",
  "selectOwnerRecommendationQuote_",
  "ownerRecommendationSupplier_",
  "workflowStatusRank_",
  "promoteWorkflowStatus_",
  "receiptSmsWorkflowComplete_",
  "vendorMmsWorkflowComplete_",
  "ownerDecisionLinkReady_",
  "ownerMmsResultComplete_",
  "ownerMmsWorkflowComplete_",
  "workflowPricedQuote_",
  "workflowStepState_",
  "submitOwnerDecisionLocked_",
  "reopenCaseForAnotherQuote_",
  "advanceCaseWorkflow_",
  "normalizeText_",
  "normalizeAddress_",
  "diceSimilarity_",
  "rankDriveOnboardingCandidate_",
  "onboardingBuildingFromFileName_"
];

vm.createContext(context);
vm.runInContext(functions.map(extractFunction).join("\n\n"), context, { filename: sourcePath });

context.handleOwnerRecommendationMms_ = payload => {
  ownerCalls.push(clone(payload));
  if (!ownerSendSucceeds) return { ok: false, status: "failed", message: "mock SENS failure" };
  const decision = db[payload.caseId].ownerDecision || {};
  db[payload.caseId].ownerRecommendationMms = {
    ok: true,
    status: "sent",
    deliveryAccepted: true,
    deliveryConfirmed: true,
    requestId: `owner-${ownerCalls.length}`,
    requestKey: `${payload.caseId}:${payload.quoteId}`,
    quoteId: payload.quoteId,
    decisionUrl: decision.decisionUrl || "",
    decisionStatus: decision.status || "",
    decisionLinkValidated: decision.linkValidated === true
  };
  const workflow = context.advanceCaseWorkflow_(payload.caseId, { source: "owner_mms", skipOwnerAutoSend: true });
  return { ok: true, status: "sent", workflow };
};
context.prepareOwnerDecisionLinkForCase_ = (caseId, casePayload, quoteId, quote) => {
  ownerLinkCalls.push({ caseId, quoteId });
  const state = {
    status: "pending",
    token: "mock-owner-token",
    quoteId,
    decisionUrl: `https://script.google.com/macros/s/mock/exec?view=owner-decision&caseId=${caseId}&token=mock-owner-token`,
    linkValidated: ownerLinkSucceeds
  };
  db[caseId].ownerDecision = clone(state);
  return {
    ok: ownerLinkSucceeds,
    state,
    supplier: context.ownerRecommendationSupplier_(quote),
    amounts: { totalAmount: Number(quote && quote.totalAmount || 0) },
    message: ownerLinkSucceeds ? "승인 링크 열림 확인 완료" : "승인 링크 확인 실패"
  };
};

function expectStatus(caseId, expected, label) {
  Object.entries(expected).forEach(([step, status]) => {
    assert.equal(db[caseId].status && db[caseId].status[step], status, `${label}: ${step}`);
  });
}

function runWorkflowSimulation() {
  const caseId = "BR-SIM-0001";
  db[caseId] = {
    id: caseId,
    contractMatch: { status: "matched", matchLevel: "building_address_exact" },
    status: {}
  };

  context.advanceCaseWorkflow_(caseId, { source: "form_submit", skipOwnerAutoSend: true });
  expectStatus(caseId, { c1: "done", c2: "doing" }, "onboarding matched");

  db[caseId].complaintReceiptSms = { ok: true, status: "sent", deliveryAccepted: true };
  context.advanceCaseWorkflow_(caseId, { source: "receipt_sms", skipOwnerAutoSend: true });
  expectStatus(caseId, { c2: "done", c3: "done", c4: "done", c5: "doing" }, "receipt complete");

  db[caseId].quoteFiles = { premature: { vendorName: "Too Early", totalAmount: 100000 } };
  context.advanceCaseWorkflow_(caseId, { source: "quote_upload", uploadBatchId: "early", uploadBatchComplete: true, skipOwnerAutoSend: true });
  expectStatus(caseId, { c5: "doing" }, "quote waits for vendor MMS");
  assert.notEqual(db[caseId].status.c6, "done", "quote must not skip manual vendor MMS");
  db[caseId].quoteFiles = {};

  db[caseId].vendorEstimateMms = { ok: true, status: "sent", deliveryAccepted: true, sent: [{ vendorName: "Vendor A" }] };
  context.advanceCaseWorkflow_(caseId, { source: "vendor_mms", skipOwnerAutoSend: true });
  expectStatus(caseId, { c5: "done", c6: "doing" }, "vendor MMS complete");

  db[caseId].quoteFiles = {
    high: { vendorName: "High Vendor", totalAmount: 220000 },
    low: { vendorName: "Low Vendor", totalAmount: 130000, businessRegistrationAppliedAt: "2026-07-20T00:00:00Z" }
  };
  context.advanceCaseWorkflow_(caseId, { source: "quote_upload", uploadBatchId: "batch-1", uploadBatchComplete: false, skipOwnerAutoSend: true });
  expectStatus(caseId, { c6: "doing" }, "incomplete upload batch");
  assert.notEqual(db[caseId].status.c7, "done", "incomplete upload batch must wait");

  context.advanceCaseWorkflow_(caseId, { source: "quote_upload", uploadBatchId: "batch-1", uploadBatchComplete: true });
  expectStatus(caseId, { c6: "done", c7: "done", c8: "done", c9: "doing" }, "owner MMS automatic completion");
  assert.equal(ownerCalls.length, 1, "owner MMS must be requested once");
  assert.ok(ownerLinkCalls.length >= 1, "owner decision link must be prepared at c8 before MMS");
  assert.equal(db[caseId].ownerDecision.linkValidated, true, "owner decision link must be validated before MMS");
  assert.equal(ownerCalls[0].quoteId, "low", "lowest original quote must be recommended");

  context.advanceCaseWorkflow_(caseId, { source: "retry" });
  assert.equal(ownerCalls.length, 1, "completed owner MMS must not be sent twice");
  expectStatus(caseId, { c8: "done", c9: "doing" }, "idempotent retry");

  const unmatchedId = "BR-SIM-UNMATCHED";
  db[unmatchedId] = { id: unmatchedId, contractMatch: { status: "unmatched" }, status: {} };
  context.advanceCaseWorkflow_(unmatchedId, { source: "form_submit" });
  expectStatus(unmatchedId, { c1: "doing" }, "unmatched onboarding");
  assert.equal(db[unmatchedId].status.c2, undefined, "unmatched onboarding must not open c2");

  const failureId = "BR-SIM-OWNER-FAIL";
  db[failureId] = {
    id: failureId,
    contractMatch: { status: "matched" },
    status: { c1: "done", c2: "done", c3: "done", c4: "done", c5: "done", c6: "done", c7: "done", c8: "doing" },
    quoteFiles: { q1: { vendorName: "Failure Vendor", totalAmount: 150000 } }
  };
  ownerSendSucceeds = false;
  const failedResult = context.advanceCaseWorkflow_(failureId, { source: "retry" });
  assert.equal(failedResult.ok, false, "owner MMS failure must be exposed");
  expectStatus(failureId, { c8: "doing" }, "owner MMS failure stays on c8");
  assert.equal(db[failureId].status.c9, undefined, "owner MMS failure must not open c9");
  ownerSendSucceeds = true;

  const linkFailureId = "BR-SIM-LINK-FAIL";
  db[linkFailureId] = {
    id: linkFailureId,
    contractMatch: { status: "matched" },
    status: { c1: "done", c2: "done", c3: "done", c4: "done", c5: "done", c6: "done", c7: "done", c8: "doing" },
    quoteFiles: { q1: { vendorName: "Link Failure Vendor", totalAmount: 140000 } }
  };
  const ownerCallsBeforeLinkFailure = ownerCalls.length;
  ownerLinkSucceeds = false;
  const linkFailure = context.advanceCaseWorkflow_(linkFailureId, { source: "retry" });
  assert.equal(linkFailure.ok, false, "invalid owner decision link must block owner MMS");
  assert.equal(ownerCalls.length, ownerCallsBeforeLinkFailure, "owner MMS must not send before decision link validation");
  expectStatus(linkFailureId, { c8: "doing" }, "decision link failure stays on c8");
  ownerLinkSucceeds = true;

  const staleSuccessId = "BR-SIM-STALE-OWNER-MMS";
  db[staleSuccessId] = {
    id: staleSuccessId,
    contractMatch: { status: "matched" },
    status: {
      c1: "done",
      c2: "done",
      c3: "done",
      c4: "done",
      c5: "done",
      c6: "done",
      c7: "done",
      c8: "done",
      c9: "doing"
    },
    quoteFiles: { q1: { vendorName: "Stale Vendor", totalAmount: 145000 } },
    ownerDecision: {
      status: "pending",
      token: "old-token",
      quoteId: "q1",
      decisionUrl: "https://script.google.com/macros/s/mock/exec?view=owner-decision&caseId=BR-SIM-STALE-OWNER-MMS&token=old-token",
      linkValidated: false
    },
    ownerRecommendationMms: {
      ok: true,
      status: "sent",
      deliveryAccepted: true,
      deliveryConfirmed: true,
      quoteId: "q1"
    }
  };
  ownerLinkSucceeds = false;
  context.advanceCaseWorkflow_(staleSuccessId, { source: "repair", skipOwnerAutoSend: true });
  expectStatus(staleSuccessId, { c8: "doing", c9: "wait" }, "stale owner MMS must roll back to c8");

  const ownerCallsBeforeRepair = ownerCalls.length;
  ownerLinkSucceeds = true;
  context.advanceCaseWorkflow_(staleSuccessId, { source: "repair" });
  assert.equal(ownerCalls.length, ownerCallsBeforeRepair + 1, "repaired decision link must trigger a fresh owner MMS");
  expectStatus(staleSuccessId, { c8: "done", c9: "doing" }, "fresh MMS with validated link opens c9");
}

function runMatchingSimulation() {
  assert.match(
    source,
    /CONTRACT_DRIVE_FOLDER_ID:\s*"1GKI8oc4iicdEw7MnPKpfZrwKd4ZGKnBZ"/,
    "onboarding matching must use the dedicated Drive folder"
  );
  assert.equal(
    context.onboardingBuildingFromFileName_("햇빛빌라.docx.docx"),
    "햇빛빌라",
    "duplicated DOCX extensions must not remain in the building name"
  );
  const sunlightVilla = context.rankDriveOnboardingCandidate_(
    { building: context.onboardingBuildingFromFileName_("햇빛빌라.docx.docx"), address: "", text: "" },
    "햇빛빌라",
    "단계동 927-2"
  );
  assert.equal(sunlightVilla.matchRank, 2, "sunlight villa must match by normalized building name");
  assert.equal(sunlightVilla.buildingScore, 1, "sunlight villa building name must match exactly");

  const exact = context.rankDriveOnboardingCandidate_(
    { building: "Sangji Center", address: "Wonju 83", text: "Sangji Center Wonju 83" },
    "Sangji Center",
    "Wonju 83"
  );
  assert.equal(exact.matchRank, 3, "building and address exact match must rank first");

  const buildingOnly = context.rankDriveOnboardingCandidate_(
    { building: "Sangji Center", address: "Different Address", text: "Sangji Center Different Address" },
    "Sangji Center",
    "Wonju 83"
  );
  assert.equal(buildingOnly.matchRank, 2, "building exact match must rank second");

  const fuzzy = context.rankDriveOnboardingCandidate_(
    { building: "Sangji Startup Center", address: "Wonju 85", text: "Sangji Startup Center Wonju 85" },
    "Sangji Start Center",
    "Wonju 83"
  );
  assert.equal(fuzzy.matchRank, 1, "similar building and address must use fuzzy rank");
  assert.ok(fuzzy.matchScore > 0, "fuzzy match must produce a score");
}

function runOwnerDecisionSimulation() {
  const approvalId = "BR-SIM-APPROVAL";
  db[approvalId] = {
    id: approvalId,
    status: { c1: "done", c2: "done", c3: "done", c4: "done", c5: "done", c6: "done", c7: "done", c8: "done", c9: "doing" },
    ownerDecision: { status: "pending", token: "approval-token", quoteId: "q1" },
    automationState: { workflow: { c9: { status: "doing" } } },
    log: []
  };
  const approved = context.submitOwnerDecisionLocked_(approvalId, "approval-token", "approve_payment");
  assert.equal(approved.ok, true, "owner approval must succeed");
  expectStatus(approvalId, { c9: "done", c10: "doing" }, "owner approval");
  assert.equal(db[approvalId].ownerDecision.status, "approved_payment", "owner decision must be stored");
  assert.equal(db[approvalId].paymentStatus, "awaiting_payment", "payment must wait for confirmation");

  const otherId = "BR-SIM-OTHER-QUOTE";
  db[otherId] = {
    id: otherId,
    status: { c1: "done", c2: "done", c3: "done", c4: "done", c5: "done", c6: "done", c7: "done", c8: "done", c9: "doing" },
    ownerDecision: { status: "pending", token: "other-token", quoteId: "q-low" },
    vendorSelections: { vendorA: true },
    selectedVendors: [{ id: "vendorA", name: "Vendor A" }],
    vendorEstimateMms: { ok: true, status: "sent" },
    quoteFiles: { "q-low": { vendorName: "Vendor A", totalAmount: 130000 } },
    businessRegistrationFiles: { br1: { vendorName: "Vendor A" } },
    recommendation: { quoteId: "q-low" },
    ownerRecommendationMms: { ok: true, status: "sent" },
    automationState: { workflow: { c5: { status: "done" }, c6: { status: "done" }, c9: { status: "doing" } } },
    log: []
  };
  const other = context.submitOwnerDecisionLocked_(otherId, "other-token", "request_other_quote");
  assert.equal(other.ok, true, "other quote request must succeed");
  expectStatus(otherId, { c5: "doing" }, "other quote request");
  assert.equal(db[otherId].status.c6, undefined, "other quote request must close c6");
  assert.equal(db[otherId].quoteFiles, undefined, "active quote list must be cleared");
  assert.ok(db[otherId].quoteRequestRounds["round-1"].quoteFiles["q-low"], "previous quote round must be archived");
  assert.equal(db[otherId].quoteRequestRound, 2, "next quote round must increment");
}

runWorkflowSimulation();
runMatchingSimulation();
runOwnerDecisionSimulation();
console.log("PASS ①→⑤: onboarding, receipt SMS, consultation and classification");
console.log("PASS ⑤→⑦: vendor MMS, upload batch gate and lowest-price recommendation");
console.log("PASS ⑧→⑨: automatic owner MMS, failure hold and duplicate-send prevention");
console.log("PASS matching: exact, building-only and fuzzy ranking");
console.log("PASS owner decision: approval opens c10 and other quote reopens c5");
console.log("PASS owner decision link: prepared and validated at c8 before owner MMS");

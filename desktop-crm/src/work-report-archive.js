"use strict";
const crypto = require("node:crypto");
const R = require("./work-report-core");
const Docs = require("./saved-customer-documents");
const Pdf = require("./saved-customer-document-pdf");
const live = row => row && !row.archivedAt && !row.deletedAt && row.deleted !== true;
const id = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(value);
const hash = value => crypto.createHash("sha256").update(value).digest("hex");

function ownerFor(data, buildingId) {
  const building = (data.buildings || []).find(row => live(row) && row.id === buildingId);
  if (!building) throw new Error("선택한 건물을 다시 확인해 주세요.");
  const customer = (data.customers || []).find(row => live(row) && row.id === building.ownerCustomerId);
  return {building, customer};
}
function assertBinding(record, data, reports) {
  const doc = record.savedCustomerDocument;
  const {customer} = ownerFor(data, record.buildingId);
  const report = reports.find(row => live(row) && row.id === doc.reportId);
  if (!report || report.updatedAt !== doc.reportUpdatedAt || report.buildingId !== record.buildingId) throw new Error("보고서가 변경되었습니다. 현재 내용으로 다시 저장해 주세요.");
  if ((customer?.id || "") !== doc.customerId || (customer && /^01\d{8,9}$/.test(Docs.phone(customer.phone)) ? Docs.phone(customer.phone) : "") !== doc.recipientPhone) throw new Error("건물주 연결 또는 연락처가 변경되었습니다. 다시 저장해 주세요.");
  return customer;
}

// Dependencies keep all privileged operations in the main process. No raw PDF,
// token-bearing link, or provider response is persisted in CRM metadata.
function createService(deps) {
  const saves = new Map(), sends = new Set();
  async function source(reportId, updatedAt, session) {
    if (!id(reportId) || typeof updatedAt !== "string" || !Number.isFinite(Date.parse(updatedAt))) throw new Error("저장한 보고서를 다시 확인해 주세요.");
    const loaded = await deps.reports(); session.check();
    const report = loaded.reports.find(row => live(row) && row.id === reportId && row.updatedAt === updatedAt);
    if (!report) throw new Error("보고서가 변경되었습니다. 다시 불러와 주세요.");
    const checked = R.validateReport(report);
    if (!checked.ok) throw new Error(checked.error);
    const data = await deps.store(); session.check();
    return {report: checked.report, data, ...ownerFor(data, report.buildingId)};
  }
  async function save(input, session) {
    if (!id(input.reportId) || typeof input.updatedAt !== "string" || input.updatedAt.length > 40) throw new Error("저장 보고서를 다시 확인해 주세요.");
    const key = `${session.user.uid}:${input.reportId}:${input.updatedAt}`;
    if (saves.has(key)) return saves.get(key);
    const running = saveOnce(input, session);
    saves.set(key, running);
    try { return await running; } finally { saves.delete(key); }
  }
  async function saveOnce(input, session) {
    const {report, data, customer, building} = await source(input.reportId, input.updatedAt, session);
    const phone = customer && /^01\d{8,9}$/.test(Docs.phone(customer.phone)) ? Docs.phone(customer.phone) : "";
    const recordId = "saved_wr_" + hash(JSON.stringify([report.id, report.updatedAt, customer?.id || "", phone])).slice(0,40);
    const old = (data.buildingDocuments || []).find(row => live(row) && row.id === recordId);
    if (old && Docs.normalize(old)) return {ok: true, record: old};
    const rootFolderId = String(data.company?.buildingDocsFolderId || "");
    if (!/^[A-Za-z0-9_-]{6,200}$/.test(rootFolderId)) throw new Error("건물 문서함에서 회사 Drive 보관 폴더를 먼저 지정해 주세요.");
    const artifact = await deps.pdf({report: {...report, ownerName: customer?.name || customer?.company || report.ownerName, ownerContact: phone || report.ownerContact},
      company: data.settings?.quoteCompany || {}, secrets: {vendorNames: (data.partnerVendors || []).map(row => row.name).filter(Boolean), vendorAmounts: [], privateMemos: []}});
    session.check();
    if (!artifact?.ok) throw new Error(artifact?.error || "보고서 PDF를 만들지 못했습니다.");
    if (artifact.photoFailures || !Number.isInteger(artifact.photos) || artifact.photos < R.photoCount(report)) throw new Error("보고서는 저장했지만 PDF 사진을 모두 읽지 못했습니다. Drive 연결을 확인한 뒤 다시 저장해 주세요.");
    const checked = Pdf.verifyPdf(artifact.bytes);
    const uploaded = await deps.upload({rootFolderId, folderPath: ["CRM 발송 문서", "작업 결과보고서", report.workDate.slice(0,4)],
      fileName: recordId + ".pdf", mimeType: "application/pdf", documentKey: recordId + "_" + checked.sha256, content: checked.bytes});
    session.check();
    const record = {id: recordId, title: `${building.name || report.buildingName} ${report.workDate} 작업 결과보고서`.slice(0,160),
      buildingId: report.buildingId, docType: "etc", driveFileId: uploaded.id, updatedAt: new Date().toISOString(), updatedBy: session.user.uid,
      savedCustomerDocument: {version: 1, kind: "workReport", customerId: customer?.id || "", recipientPhone: phone, reportId: report.id,
        reportUpdatedAt: report.updatedAt, sha256: checked.sha256, size: checked.size, month: ""}};
    if (!Docs.normalize(record)) throw new Error("PDF 보관 정보를 확인하지 못했습니다.");
    const fresh = await source(report.id, report.updatedAt, session);
    assertBinding(record, fresh.data, [fresh.report]);
    const persisted = await deps.mutate(record.id, previous => previous || record, session); session.check();
    return {ok: true, record: persisted};
  }
  async function read(input, session) {
    const data = await deps.store(); session.check();
    const {record, customer} = Docs.resolve(data.buildingDocuments, data.customers, input);
    const loaded = await deps.reports(); session.check();
    assertBinding(record, data, loaded.reports);
    const bytes = await deps.download(record.driveFileId, record.savedCustomerDocument); session.check();
    return {record, customer, bytes};
  }
  async function send(input, session) {
    if (session.user.role !== "admin") throw new Error("관리자만 고객에게 보고서를 보낼 수 있습니다. PDF 저장은 유지됩니다.");
    if (!id(input.documentId) || sends.has(input.documentId)) throw new Error("발송 처리 중입니다. 중복 요청하지 말고 결과를 확인해 주세요.");
    sends.add(input.documentId);
    let record, claimed = false, providerStarted = false;
    try {
      const ready = await read(input, session); record = ready.record;
      const caps = await deps.delivery("capabilities"); session.check();
      if (!caps?.ok || caps.capabilities?.kakao !== true) throw new Error("알림톡 발신 설정과 승인 템플릿을 확인해 주세요. PDF 저장은 유지됩니다.");
      const requestedAt = new Date().toISOString();
      await deps.mutate(record.id, previous => {
        if (!previous || previous.updatedAt !== input.updatedAt || previous.savedCustomerDocument?.sha256 !== input.sha256) throw new Error("저장본이 변경되었습니다.");
        if (previous.workReportDelivery && previous.workReportDelivery.status !== "failed") throw new Error("이 저장본은 이미 발송 요청한 기록이 있습니다. 고객 알림에서 결과를 확인해 주세요.");
        return {...previous, workReportDelivery: {status: "sending", requestedAt, messageId: ""}};
      }, session); session.check(); claimed = true;
      // Re-read identity and canonical revision immediately before external send.
      const latest = await deps.store(); session.check();
      const reports = await deps.reports(); session.check();
      const customer = assertBinding(record, latest, reports.reports);
      const deliveryCustomerId = "wr_" + hash(record.id).slice(0,40);
      const created = await deps.delivery("create", {documentId: record.id, customerId: deliveryCustomerId, documentType: "completion_report", documentName: record.title,
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(), mimeType: "application/pdf", bytes: ready.bytes.toString("base64")});
      session.check();
      if (!created?.ok || !created.documentId) throw new Error("보고서 보안 링크를 준비하지 못했습니다.");
      const finalData = await deps.store(); session.check();
      const finalReports = await deps.reports(); session.check();
      Docs.resolve(finalData.buildingDocuments, finalData.customers, input);
      assertBinding(record, finalData, finalReports.reports);
      providerStarted = true;
      const sent = await deps.delivery("send", {channel: "kakao", idempotencyKey: "wr_" + hash(record.id + input.sha256).slice(0,48),
        documentId: created.documentId, customerId: deliveryCustomerId, customerName: customer.name || customer.company || "건물주", phone: Docs.phone(customer.phone)});
      session.check();
      if (!sent?.ok) throw new Error("발송 접수 결과를 확인하지 못했습니다. 고객 알림에서 확인해 주세요. PDF는 보관되어 있습니다.");
      const updated = await deps.mutate(record.id, row => ({...row, workReportDelivery: {status: "requested", requestedAt, messageId: String(sent.messageId || "").slice(0,120)}}), session);
      session.check();
      return {ok: true, status: "requested", record: updated};
    } catch (error) {
      if (claimed) {
        // Unknown send outcomes never auto-retry or revoke a link the customer may have received.
        await deps.mutate(record.id, row => ({...row, workReportDelivery: {...row.workReportDelivery, status: providerStarted ? "unknown" : "failed"}}), session).catch(() => {});
      }
      throw error;
    } finally { sends.delete(input.documentId); }
  }
  return {save, read, send};
}
module.exports = {createService, ownerFor, assertBinding};

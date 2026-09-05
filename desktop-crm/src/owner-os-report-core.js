// CRM 이 대표OS 에 매달 올릴 보고 봉투를 만든다.
//
// 규격 원본은 bring-tomok-OS/docs/보고-규격.md 다. 받는 쪽은 bring-os 의
// POST /api/ingest/field-report 이고, 모르는 schemaVersion 은 거절한다.
//
// 이 파일이 지키는 규칙 하나: **여기 들어가는 숫자는 전부 다른 코어가 이미
// 계산해서 화면에 띄우고 있는 것이다.** 보고용으로 새로 만든 계산식은 없다.
// 아무도 안 보는 숫자가 대표 보고서에 먼저 올라가면 틀려도 아무도 못 잡는다.
//
// 그래서 이 파일은 재무·영업은 management-report-core 에, 운영은
// operations-intelligence-core 에 그대로 물어보고 모양만 바꾼다.
(function attachOwnerOsReportCore(root, factory) {
  const api = factory(
    typeof require === "function" ? require("./management-report-core") : root.BringManagementReportCore,
    typeof require === "function" ? require("./operations-intelligence-core") : root.BringOperationsIntelligenceCore,
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringOwnerOsReportCore = api;
})(typeof globalThis === "object" ? globalThis : this, function createOwnerOsReportCore(ManagementReportCore, OperationsCore) {
  "use strict";

  // 받는 쪽이 아는 버전. 필드를 더할 때는 올리지 않고, 빼거나 뜻을 바꿀 때만 올린다.
  const SCHEMA_VERSION = 1;
  // 표본이 적은 그룹은 순위로 내보내지 않는다. 2건짜리 평균은 순위가 아니라 우연이다.
  const RANKABLE_MIN_SAMPLE = 3;
  const TOP_BOTTLENECKS = 5;

  function text(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function isMonth(value) {
    return /^\d{4}-\d{2}$/.test(text(value));
  }

  function rows(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
  }

  function plain(value) {
    // 코어들이 Object.freeze 한 값을 돌려주므로 JSON 으로 나갈 평범한 객체로 편다.
    return value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : value;
  }

  // 표본 수를 함께 남긴다. 0건인 달과 자료가 안 올라온 달은 다른 상황인데,
  // 이 값이 없으면 대표OS 에서 둘 다 매출 0원으로만 보인다.
  function recordCounts(store, month) {
    const inMonth = (list, field) => rows(list).filter(item => text(item[field]).startsWith(`${month}-`)).length;
    return {
      contracts: rows(store.contracts).length,
      salesActivities: rows(store.salesActivities).length,
      salesEvents: rows(store.salesEvents).length,
      serviceRecordsInMonth: inMonth(store.serviceRecords, "scheduledDate"),
    };
  }

  // 운영 지표는 CRM 안이 아니라 별도 조회로 오는 자료라, 없으면 아예 뺀다.
  // 없는 걸 0 으로 채우면 "문제 없음" 으로 읽힌다.
  function operationsSection(operations, month, now) {
    if (!OperationsCore || !Array.isArray(operations) || !operations.length) return null;
    const metrics = plain(OperationsCore.metrics(operations));
    const analysis = plain(OperationsCore.bottlenecks(operations, { period: "month", now }));
    const groups = rows(analysis.groups)
      .filter(group => group.sampleSize >= RANKABLE_MIN_SAMPLE)
      .slice(0, TOP_BOTTLENECKS)
      .map(group => ({
        key: group.key,
        sampleSize: group.sampleSize,
        averageDirectMinutes: group.averageDirectMinutes,
        reworkRate: group.reworkRate,
        siteVisitRate: group.siteVisitRate,
      }));
    return {
      month,
      total: metrics.total,
      active: metrics.active,
      completed: metrics.completed,
      averageLeadMinutes: metrics.averageLeadMinutes,
      siteVisitRate: metrics.siteVisitRate,
      reworkRate: metrics.reworkRate,
      overallMedianMinutes: analysis.overallMedianMinutes,
      // 표본 3건 미만은 위에서 걸렀다. 몇 건을 걸렀는지는 sampleSize 로 알 수 있다.
      topBottlenecks: groups,
      bottleneckSampleSize: analysis.sampleSize,
    };
  }

  function normalizeIssues(list) {
    return rows(list).slice(0, 20).map(item => ({
      title: text(item.title),
      detail: text(item.detail),
      metricRefs: rows(item.metricRefs).map(text).filter(Boolean),
    })).filter(item => item.title);
  }

  function normalizeNextActions(list) {
    return rows(list).slice(0, 20).map(item => ({
      title: text(item.title),
      owner: text(item.owner),
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(text(item.dueDate)) ? text(item.dueDate) : "",
    })).filter(item => item.title);
  }

  // 정성 총평. draftedBy 는 "ai" 또는 "human", confirmedBy 는 사람이 확인했을 때만
  // 채운다. 받는 쪽은 confirmedBy 가 비면 "확인 전 초안" 으로 표시하고 평가
  // 근거로 쓰지 않는다. AI 가 지어낸 총평이 대표 평가에 그대로 들어가는 길을
  // 막는 자리라서, 여기서 임의로 채우지 않는다.
  function qualitativeSection(input) {
    const source = input && typeof input === "object" ? input : {};
    const draftedBy = source.draftedBy === "ai" ? "ai" : source.draftedBy === "human" ? "human" : "";
    const confirmedBy = text(source.confirmedBy);
    const confirmedAt = confirmedBy && Number.isFinite(Date.parse(text(source.confirmedAt)))
      ? new Date(text(source.confirmedAt)).toISOString()
      : "";
    return {
      summary: text(source.summary),
      issues: normalizeIssues(source.issues),
      nextActions: normalizeNextActions(source.nextActions),
      authoring: {
        draftedBy,
        confirmedBy,
        // 확인한 사람이 없으면 시각도 남기지 않는다. 시각만 있고 사람이 없으면
        // 누가 봤는지 모르는 채로 "확인됨" 처럼 보인다.
        confirmedAt: confirmedBy ? confirmedAt : "",
      },
    };
  }

  /**
   * 한 달치 보고 봉투를 만든다.
   *
   * store       CRM 공유 저장소
   * operations  운영 분석 자료(별도 조회 결과). 없으면 운영 항목을 아예 뺀다.
   * month       'YYYY-MM'. 없으면 지난달.
   * qualitative 총평 초안 {summary, issues, nextActions, draftedBy, confirmedBy, confirmedAt}
   */
  function buildReportEnvelope(input) {
    const settings = input && typeof input === "object" ? input : {};
    const store = settings.store && typeof settings.store === "object" ? settings.store : {};
    const now = settings.now ? new Date(settings.now) : new Date();
    const month = isMonth(settings.month) ? text(settings.month) : previousMonthOf(now);

    const report = plain(ManagementReportCore.buildMonthlyReport(store, month));
    const snapshot = plain(ManagementReportCore.buildReportAiSnapshot(report));
    const operations = operationsSection(settings.operations, month, now.toISOString());

    const quantitative = {
      finance: snapshot.finance,
      sales: snapshot.sales,
      byWorkType: snapshot.byWorkType,
      byOwner: snapshot.byOwner,
      comparison: snapshot.comparison,
    };
    if (operations) quantitative.operations = operations;

    return {
      schemaVersion: SCHEMA_VERSION,
      reportType: "monthly",
      period: { month },
      org: {
        companyId: text(settings.companyId) || "bring",
        companyName: text(settings.companyName) || "브링",
      },
      generatedAt: now.toISOString(),
      source: {
        app: "bring-crm-desktop",
        appVersion: text(settings.appVersion),
      },
      quantitative,
      qualitative: qualitativeSection(settings.qualitative),
      evidence: {
        // 받는 쪽에서 "이 말의 근거가 뭐냐" 를 눌러 볼 수 있게 평평한 지도로 둔다.
        metrics: snapshot.metricEvidence,
        recordCounts: recordCounts(store, month),
      },
    };
  }

  function previousMonthOf(now) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  return Object.freeze({
    buildReportEnvelope,
    previousMonthOf,
    SCHEMA_VERSION,
    RANKABLE_MIN_SAMPLE,
  });
});

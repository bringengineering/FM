"use strict";
// 폐기물 처리 = 단발작업으로 따로 내는 보고서 종류(2026-11).
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../src/work-report-core");
const DocFlow = require("../src/doc-flow-core");
const Plan = require("../src/report-photo-plan");
const Message = require("../src/work-report-message");
const { createOwnerReportHtml } = require("../src/work-report-owner-pdf");

test("폐기물 처리 종류: 배출 전 → 분리 → 적재·반출 → 처리 확인(선택) → 마감, 기본 구분은 단발작업", () => {
  assert.equal(Core.kindLabel("waste"), "폐기물 처리");
  assert.deepEqual(Core.itemCatalogFor("waste").map(item => item.key), ["before", "sort", "load", "proof", "after"]);
  assert.deepEqual(Core.itemCatalogFor("waste").filter(item => item.optional).map(item => item.key), ["proof"]);
  const report = Core.normalizeReport({ id: "w1", kind: "waste", buildingId: "b1", buildingName: "햇빛빌라", siteAddress: "강원특별자치도 원주시 단계로 7", workDate: "2026-11-10", items: [] });
  assert.equal(report.kind, "waste");
  assert.equal(report.category, "single");
  assert.equal(Core.categoryLabel(report.category), "단발작업");
});

test("견적·폴더 이름의 '폐기물'은 폐기물 처리로, '특수'는 그대로 특수청소로 간다", () => {
  assert.equal(DocFlow.kindFromService("폐기물 처리"), "waste");
  assert.equal(DocFlow.kindFromService("대형 폐기물 배출"), "waste");
  assert.equal(DocFlow.kindFromService("특수청소"), "special");
  assert.equal(Plan.kindFromWords("2026-11-10_햇빛빌라_폐기물처리"), "waste");
  assert.equal(Plan.kindFromWords("특수청소"), "special");
  for (const [folder, key] of [["배출 전", "before"], ["분리", "sort"], ["차량 적재", "load"], ["반출", "load"], ["신고필증", "proof"], ["반출 후", "after"], ["마감 정리", "after"]]) {
    assert.equal(Plan.itemKeyForFolder("waste", folder), key, folder);
  }
});

test("건물주 PDF와 알림톡 작업명이 '폐기물 처리'로 나간다", () => {
  const report = Core.normalizeReport({ id: "w2", kind: "waste", buildingId: "b1", buildingName: "햇빛빌라", siteAddress: "강원특별자치도 원주시 단계로 7", workDate: "2026-11-10",
    items: [{ key: "before", status: "done", before: [{ id: "p1" }] }, { key: "load", status: "done", note: "1톤 트럭 1대 반출", during: [{ id: "p2" }] }, { key: "after", status: "done", after: [{ id: "p3" }] }] });
  const html = createOwnerReportHtml(report, {});
  assert.ok(html.includes("폐기물 처리"));
  assert.ok(html.includes("배출 전 상태") && html.includes("적재·반출") && html.includes("1톤 트럭 1대 반출"));
  const info = Message.details(report);
  assert.equal(info.workName, "폐기물 처리");
  assert.equal(Message.documentName(info), "원주시 단계로 7 폐기물 처리 결과보고서");
});

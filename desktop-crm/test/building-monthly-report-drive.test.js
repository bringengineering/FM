"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Drive = require("../src/building-monthly-report-drive");

test("YYMMDD_건물명(활동명) 폴더를 보고 월·건물에 맞춰 읽는다", () => {
  assert.deepEqual(Drive.parseActivityFolderName("260821_햇빛빌라(에어컨 필터 점검)", "2026-08", "햇빛빌라", "원주시 무실동 10"), {
    date: "2026-08-21", activityName: "에어컨 필터 점검",
  });
  assert.equal(Drive.parseActivityFolderName("260821_원주시 무실동 10(외벽 점검)", "2026-08", "", "원주시 무실동 10")?.date, "2026-08-21");
});

test("잘못된 날짜·다른 월·다른 건물 폴더를 거부한다", () => {
  assert.equal(Drive.parseActivityFolderName("260232_햇빛빌라(점검)", "2026-02", "햇빛빌라", ""), null);
  assert.equal(Drive.parseActivityFolderName("260821_햇빛빌라(점검)", "2026-09", "햇빛빌라", ""), null);
  assert.equal(Drive.parseActivityFolderName("260821_우산오피스텔(점검)", "2026-08", "햇빛빌라", ""), null);
  assert.equal(Drive.parseActivityFolderName("260821_햇빛빌라(점검)", "2026-13", "햇빛빌라", ""), null);
});

test("Gemini에는 원본 업무명 대신 일반 업무 분류만 전달한다", () => {
  assert.equal(Drive.activityCategory("에어컨 필터 점검 · 업체명 010-1234-5678"), "냉난방·필터 점검");
  assert.equal(Drive.activityCategory("개인 이름과 비공개 메모"), "건물 시설 관리");
});

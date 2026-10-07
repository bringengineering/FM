import assert from "node:assert/strict";
import test from "node:test";

import { maskSensitiveText, normalizeText, sanitizeContext } from "../src/privacy.js";

test("privacy masks personal contact, financial, identity, and detailed-address values", () => {
  assert.equal(
    maskSensitiveText("홍길동 010-9654-1232 test@example.com 123-456-789012 900101-1234567 북원로2475번길 93"),
    "홍길동 [전화번호] [이메일] [계좌번호] [주민번호] [상세주소]"
  );
});

test("privacy preserves ordinary Korean work descriptions", () => {
  assert.equal(
    maskSensitiveText("예초 작업을 완료했고 폐기물 처리 후 다음 주 계단 청소 예정"),
    "예초 작업을 완료했고 폐기물 처리 후 다음 주 계단 청소 예정"
  );
});

test("structured work dates use Korean notation without exempting date-shaped financial numbers", () => {
  assert.equal(
    maskSensitiveText("작업일: 2026년 10월 06일\n계좌 2026-10-06 / 123-456-789012"),
    "작업일: 2026년 10월 06일\n계좌 [계좌번호] / [계좌번호]"
  );
});

test("privacy normalizes whitespace and enforces the content boundary", () => {
  assert.equal(normalizeText("  첫 줄\r\n\r\n  둘째 줄  "), "첫 줄\n\n둘째 줄");
  assert.throws(() => normalizeText("가".repeat(12001)), error => error?.code === "INPUT_TOO_LARGE");
  assert.equal(normalizeText("가".repeat(12_500), 13_000).length, 12_500);
  assert.throws(() => normalizeText("가".repeat(13_001), 13_000), error => error?.code === "INPUT_TOO_LARGE");
});

test("privacy context is copied through an explicit non-sensitive allow list", () => {
  assert.deepEqual(
    sanitizeContext({ customerType: "건물주", workType: "예초", owner: "서창환", privateMemo: "외부 전송 금지", phone: "010-1111-2222" }),
    { customerType: "건물주", workType: "예초", owner: "서창환" }
  );
});

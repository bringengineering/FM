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

test("privacy normalizes whitespace and enforces the content boundary", () => {
  assert.equal(normalizeText("  첫 줄\r\n\r\n  둘째 줄  "), "첫 줄\n\n둘째 줄");
  assert.throws(() => normalizeText("가".repeat(12001)), error => error?.code === "INPUT_TOO_LARGE");
});

test("privacy context is copied through an explicit non-sensitive allow list", () => {
  assert.deepEqual(
    sanitizeContext({ customerType: "건물주", workType: "예초", owner: "서창환", privateMemo: "외부 전송 금지", phone: "010-1111-2222" }),
    { customerType: "건물주", workType: "예초", owner: "서창환" }
  );
});

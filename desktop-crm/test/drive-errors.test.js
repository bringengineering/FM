const assert = require("node:assert/strict");
const test = require("node:test");
const Drive = require("../src/building-docs-drive");

function response(status, reason, details = {}) {
  return new Response(JSON.stringify({ error: { message: "PRIVATE filename account https://private.invalid/token", errors: [{ reason }], ...details } }), { status });
}

function deps(fetchImpl) { return { fetchImpl, accessToken: "test-token" }; }

test("403 권한·용량·요청 한도·API 설정 오류의 원인과 단계를 노출하되 개인정보를 제외한다", async () => {
  for (const [reason, code] of [
    ["insufficientFilePermissions", "DRIVE_PERMISSION_DENIED"],
    ["insufficientPermissions", "DRIVE_PERMISSION_DENIED"],
    ["storageQuotaExceeded", "DRIVE_QUOTA_EXCEEDED"],
    ["userRateLimitExceeded", "DRIVE_QUOTA_EXCEEDED"],
    ["accessNotConfigured", "DRIVE_SERVICE_UNAVAILABLE"],
    ["domainPolicy", "DRIVE_PERMISSION_DENIED"],
    ["propertyLengthLimitExceeded", "DRIVE_METADATA_INVALID"],
  ]) {
    await assert.rejects(Drive.ensureFolder(deps(async () => response(403, reason)), "private-folder", "private-name"), error => {
      assert.equal(error.code, code);
      assert.match(error.message, /폴더 확인 실패 \(HTTP 403/u);
      assert.ok(error.message.includes(reason));
      assert.doesNotMatch(error.message, /PRIVATE|private|test-token|만료|다시 연결/u);
      return true;
    });
  }
});

test("폴더 생성 단계 및 Google ErrorInfo의 알려진 원인만 표시한다", async () => {
  let calls = 0;
  await assert.rejects(Drive.ensureFolder(deps(async () => ++calls === 1
    ? Response.json({ files: [] })
    : response(403, "private-unknown", { details: [{ reason: "SERVICE_DISABLED", metadata: { private: "SECRET" } }] })), "root", "test"), error => {
    assert.equal(error.code, "DRIVE_SERVICE_UNAVAILABLE");
    assert.match(error.message, /폴더 생성 실패.*SERVICE_DISABLED/u);
    assert.doesNotMatch(error.message, /private|SECRET/u);
    return true;
  });
});

test("401 인증 오류에는 안전한 단계와 재연결 안내가 남는다", async () => {
  await assert.rejects(Drive.uploadMultipart(deps(async () => response(401, "authError")), {}, Buffer.from("pdf"), "application/pdf"), error => {
    assert.equal(error.code, "DRIVE_AUTH_REQUIRED");
    assert.match(error.message, /업로드 실패.*HTTP 401.*authError.*다시 연결/u);
    return true;
  });
});

test("이어올리기 시작·전송·상태 확인에서 접근 거부 후 더 보내지 않는다", async () => {
  for (const stage of ["업로드 시작", "업로드 전송", "업로드 상태 확인"]) {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      if (stage !== "업로드 시작" && calls === 1) return new Response(null, { headers: { location: "https://www.googleapis.com/upload/session" } });
      if (stage === "업로드 상태 확인" && calls === 2) throw new Error("network lost");
      return response(403, "insufficientFilePermissions");
    };
    await assert.rejects(Drive.uploadResumable(deps(fetchImpl), {}, Buffer.from("pdf"), "application/pdf"), error => {
      assert.equal(error.code, "DRIVE_PERMISSION_DENIED");
      assert.ok(error.message.includes(stage));
      return true;
    });
    assert.equal(calls, ["업로드 시작", "업로드 전송", "업로드 상태 확인"].indexOf(stage) + 1);
  }
});

test("알 수 없거나 깨진·과대한 오류 본문은 유출 없이 UNKNOWN으로 처리하고 스트림을 닫는다", async () => {
  for (const body of [JSON.stringify({ error: { errors: [{ reason: "PRIVATE_REASON" }] } }), "<html>PRIVATE</html>", "PRIVATE".repeat(2000)]) {
    await assert.rejects(Drive.findExisting(deps(async () => new Response(body, { status: 403 })), "root", "doc"), error => {
      assert.match(error.message, /중복 확인 실패.*UNKNOWN/u);
      assert.doesNotMatch(error.message, /PRIVATE|html/u);
      return true;
    });
  }
  let cancelled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(8193)); }, cancel() { cancelled = true; } });
  await assert.rejects(Drive.ensureFolder(deps(async () => new Response(body, { status: 403 })), "root", "test"));
  assert.equal(cancelled, true);
});

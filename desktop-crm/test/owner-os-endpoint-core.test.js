const assert = require("node:assert/strict");
const test = require("node:test");

const Endpoint = require("../src/owner-os-endpoint-core");

const GOOD_SECRET = "s3cret-key-abcdefgh";

const throwsCode = (fn, code) => {
  assert.throws(fn, error => {
    assert.equal(error.code, code, `기대한 코드 ${code}, 실제 ${error && error.code}`);
    return true;
  });
};

test("http 주소는 받지 않는다", () => {
  // 키가 헤더로 나가므로 평문 http 는 그대로 노출된다.
  throwsCode(() => Endpoint.normalizeEndpointUrl("http://bring-os.example.com"), "ENDPOINT_INSECURE");
  throwsCode(() => Endpoint.normalizeEndpointUrl("ftp://bring-os.example.com"), "ENDPOINT_INSECURE");
});

test("개발 확인용 localhost 만 http 를 연다", () => {
  assert.equal(
    Endpoint.normalizeEndpointUrl("http://localhost:3000"),
    "http://localhost:3000/api/ingest/field-report",
  );
  assert.equal(
    Endpoint.normalizeEndpointUrl("http://127.0.0.1:3113"),
    "http://127.0.0.1:3113/api/ingest/field-report",
  );
});

test("홈 주소를 넣어도 보고 경로까지 붙여 준다", () => {
  const expected = "https://bring-os.example.com/api/ingest/field-report";
  assert.equal(Endpoint.normalizeEndpointUrl("https://bring-os.example.com"), expected);
  assert.equal(Endpoint.normalizeEndpointUrl("https://bring-os.example.com/"), expected);
  assert.equal(Endpoint.normalizeEndpointUrl("https://bring-os.example.com///"), expected);
  // 이미 경로를 넣었으면 두 번 붙이지 않는다.
  assert.equal(Endpoint.normalizeEndpointUrl(expected), expected);
});

test("주소에 자격증명이나 쿼리를 넣지 못하게 한다", () => {
  // 주소에 박힌 값은 로그와 접속 기록에 그대로 남는다.
  throwsCode(() => Endpoint.normalizeEndpointUrl("https://u:p@bring-os.example.com"), "ENDPOINT_INVALID");
  throwsCode(() => Endpoint.normalizeEndpointUrl("https://bring-os.example.com?key=abc"), "ENDPOINT_INVALID");
  throwsCode(() => Endpoint.normalizeEndpointUrl("https://bring-os.example.com#abc"), "ENDPOINT_INVALID");
  throwsCode(() => Endpoint.normalizeEndpointUrl("주소 아님"), "ENDPOINT_INVALID");
  throwsCode(() => Endpoint.normalizeEndpointUrl(""), "ENDPOINT_REQUIRED");
});

test("헤더를 깨뜨릴 수 있는 비밀키는 받지 않는다", () => {
  // 줄바꿈이 들어가면 헤더가 쪼개진다.
  throwsCode(() => Endpoint.normalizeSecret("abcdefghijklmnop\r\nX-Evil: 1"), "SECRET_INVALID");
  throwsCode(() => Endpoint.normalizeSecret("비밀키비밀키비밀키비밀키비밀키비밀키"), "SECRET_INVALID");
  throwsCode(() => Endpoint.normalizeSecret("짧다"), "SECRET_TOO_SHORT");
  throwsCode(() => Endpoint.normalizeSecret("a".repeat(201)), "SECRET_TOO_LONG");
  throwsCode(() => Endpoint.normalizeSecret(""), "SECRET_REQUIRED");
  assert.equal(Endpoint.normalizeSecret(`  ${GOOD_SECRET}  `), GOOD_SECRET);
});

test("화면으로는 비밀키를 돌려주지 않는다", () => {
  // 돌려주는 순간 렌더러 메모리와 개발자도구에 남는다.
  const view = Endpoint.toPublicView({
    endpoint: "https://bring-os.example.com/api/ingest/field-report",
    secret: GOOD_SECRET,
    companyId: "bring",
  });
  assert.equal(view.configured, true);
  assert.equal(view.secretHint, "••••efgh");
  assert.equal(JSON.stringify(view).includes(GOOD_SECRET), false, "어떤 칸에도 키가 들어가면 안 된다");

  const empty = Endpoint.toPublicView(null);
  assert.deepEqual(empty, { configured: false, endpoint: "", secretHint: "", companyId: "" });
});

test("요청은 키를 헤더에 담고 봉투를 본문에 담는다", () => {
  const request = Endpoint.buildRequest(
    { endpoint: "https://bring-os.example.com", secret: GOOD_SECRET },
    { schemaVersion: 1, period: { month: "2026-08" } },
  );
  assert.equal(request.method, "POST");
  assert.equal(request.url, "https://bring-os.example.com/api/ingest/field-report");
  assert.equal(request.headers["x-bring-report-key"], GOOD_SECRET);
  assert.equal(request.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(request.body), { schemaVersion: 1, period: { month: "2026-08" } });
  // 주소가 안전하지 않으면 요청 자체를 만들지 않는다.
  throwsCode(() => Endpoint.buildRequest({ endpoint: "http://evil.example.com", secret: GOOD_SECRET }, {}), "ENDPOINT_INSECURE");
  throwsCode(() => Endpoint.buildRequest({ endpoint: "https://bring-os.example.com", secret: GOOD_SECRET }, null), "ENVELOPE_REQUIRED");
});

test("미리보기 주소에서 막힌 것을 키 문제로 안내하지 않는다", () => {
  // 이걸 구분해 주지 않으면 맞는 키를 계속 의심하게 된다.
  const viaBody = Endpoint.describeResponse(401, '{"error":{"message":"Protected deployment"}}', "https://bring-os.example.com/api/ingest/field-report");
  assert.equal(viaBody.code, "ENDPOINT_PREVIEW_BLOCKED");
  assert.match(viaBody.message, /운영 주소/u);

  const viaHost = Endpoint.describeResponse(401, "", "https://bring-os-git-claude-x-team.vercel.app/api/ingest/field-report");
  assert.equal(viaHost.code, "ENDPOINT_PREVIEW_BLOCKED");

  // 운영 주소에서의 401 은 진짜 키 문제로 안내한다.
  const real = Endpoint.describeResponse(401, "", "https://bring-os.example.com/api/ingest/field-report");
  assert.equal(real.code, "UNAUTHORIZED");
  assert.match(real.message, /비밀키/u);
});

test("응답 상태를 사람이 읽을 말로 바꾼다", () => {
  assert.equal(Endpoint.describeResponse(200, '{"ok":true}', "https://a.example.com").ok, true);
  assert.equal(Endpoint.describeResponse(400, "Unsupported schemaVersion: 2", "https://a.example.com").code, "REJECTED");
  assert.match(Endpoint.describeResponse(400, "Unsupported schemaVersion: 2", "https://a.example.com").message, /schemaVersion/u);
  assert.equal(Endpoint.describeResponse(405, "", "https://a.example.com").code, "ENDPOINT_INVALID");
  assert.equal(Endpoint.describeResponse(500, "", "https://a.example.com").code, "STORE_FAILED");
  assert.equal(Endpoint.describeResponse(418, "", "https://a.example.com").code, "UNEXPECTED");
});

test("오류 문구에 비밀키가 새지 않는다", () => {
  // 오류는 화면과 로그로 나가는 길이다.
  for (const bad of ["짧다", "a".repeat(201), "abcdefghijklmnop\nX: 1"]) {
    try {
      Endpoint.normalizeSecret(bad);
      assert.fail("걸러야 한다");
    } catch (error) {
      assert.equal(error.message.includes(bad), false, "문구에 입력값을 그대로 넣지 않는다");
    }
  }
  const described = Endpoint.describeResponse(401, "", "https://a.example.com");
  assert.equal(described.message.includes(GOOD_SECRET), false);
});

const assert = require("node:assert/strict");
const test = require("node:test");

const Drive = require("../src/building-docs-drive");

const rejectsCode = async (promise, code) => {
  await assert.rejects(promise, error => {
    assert.equal(error.code, code, `기대한 코드 ${code}, 실제 ${error && error.code}`);
    return true;
  });
};

// Drive 를 실제로 부르지 않는다. 응답을 순서대로 정해 두고 호출을 기록한다.
function fakeDrive(responses) {
  const calls = [];
  const queue = responses.slice();
  const fetchImpl = async (url, options) => {
    const call = { url: String(url), options: options || {} };
    calls.push(call);
    const next = queue.shift();
    if (!next) throw new Error(`예상하지 못한 Drive 호출: ${url}`);
    if (next.throws) throw new Error("network down");
    const headers = new Map(Object.entries(next.headers || {}));
    return {
      ok: (next.status ?? 200) >= 200 && (next.status ?? 200) < 300,
      status: next.status ?? 200,
      headers: { get: key => headers.get(String(key).toLowerCase()) ?? null },
      json: async () => next.body ?? {},
    };
  };
  return { fetchImpl, calls };
}

const deps = fake => ({ fetchImpl: fake.fetchImpl, accessToken: "token-abc" });

const baseInput = {
  rootFolderId: "root-1",
  buildingName: "우산동 다가구",
  buildingAddress: "원주시 우산동 123",
  docTypeLabel: "건물관리 위탁계약서",
  documentDate: "2026-08-04",
  originalFileName: "계약서.pdf",
  mimeType: "application/pdf",
  documentKey: "doc_abc123",
};

const folderLookups = [
  { body: { files: [{ id: "f-building" }] } },
  { body: { files: [{ id: "f-type" }] } },
  { body: { files: [{ id: "f-year" }] } },
];

test("작은 파일은 한 번에 올린다", async () => {
  const fake = fakeDrive([
    ...folderLookups,
    { body: { files: [] } },
    { body: { id: "file-1", name: "계약서", webViewLink: "https://drive/file-1" } },
  ]);
  const result = await Drive.uploadDocument(deps(fake), { ...baseInput, content: Buffer.alloc(1024, 1) });
  assert.equal(result.id, "file-1");
  assert.equal(result.alreadyThere, false);
  assert.equal(result.folderId, "f-year");
  const upload = fake.calls.at(-1);
  assert.match(upload.url, /uploadType=multipart/u);
  assert.match(upload.options.headers["content-type"], /multipart\/related; boundary=/u);
});

test("올린 파일에 표식을 남겨 두 번 올리는 것을 막는다", async () => {
  const fake = fakeDrive([
    ...folderLookups,
    { body: { files: [] } },
    { body: { id: "file-1" } },
  ]);
  await Drive.uploadDocument(deps(fake), { ...baseInput, content: Buffer.alloc(10, 1) });
  const body = fake.calls.at(-1).options.body.toString("utf8");
  assert.match(body, new RegExp(Drive.APP_TAG, "u"));
  assert.match(body, /doc_abc123/u);
});

test("이미 올린 서류면 다시 올리지 않고 있던 것을 준다", async () => {
  const fake = fakeDrive([
    ...folderLookups,
    { body: { files: [{ id: "file-old", webViewLink: "https://drive/old" }] } },
  ]);
  const result = await Drive.uploadDocument(deps(fake), { ...baseInput, content: Buffer.alloc(10, 1) });
  assert.equal(result.alreadyThere, true);
  assert.equal(result.id, "file-old");
  assert.equal(fake.calls.length, 4, "업로드 호출이 없어야 한다");
});

test("큰 파일은 조각으로 나눠 올린다", async () => {
  const size = Drive.RESUMABLE_THRESHOLD_BYTES + Drive.CHUNK_BYTES;
  const fake = fakeDrive([
    ...folderLookups,
    { body: { files: [] } },
    { status: 200, headers: { location: "https://upload/session-1" } },
    { status: 308, headers: { range: `bytes=0-${Drive.CHUNK_BYTES - 1}` } },
    { status: 308, headers: { range: `bytes=0-${2 * Drive.CHUNK_BYTES - 1}` } },
    { status: 200, body: { id: "file-big", webViewLink: "https://drive/big" } },
  ]);
  const seen = [];
  const result = await Drive.uploadDocument(deps(fake), {
    ...baseInput,
    content: Buffer.alloc(size, 7),
    onProgress: (done, total) => seen.push([done, total]),
  });
  assert.equal(result.id, "file-big");
  const start = fake.calls[4];
  assert.match(start.url, /uploadType=resumable/u);
  assert.equal(start.options.headers["x-upload-content-type"], "application/pdf");
  const chunks = fake.calls.slice(5);
  assert.ok(chunks.length >= 3, "조각이 여러 번 나가야 한다");
  assert.equal(chunks[0].options.method, "PUT");
  assert.match(chunks[0].options.headers["content-range"], /^bytes 0-\d+\/\d+$/u);
  assert.ok(seen.length > 0, "진행 상황을 알려 준다");
  assert.deepEqual(seen.at(-1), [size, size]);
});

test("끊기면 서버에 어디까지 받았는지 묻고 이어서 올린다", async () => {
  const size = Drive.RESUMABLE_THRESHOLD_BYTES + 100;
  const fake = fakeDrive([
    ...folderLookups,
    { body: { files: [] } },
    { status: 200, headers: { location: "https://upload/session-2" } },
    { throws: true },
    { status: 308, headers: { range: "bytes=0-1023" } },
    { status: 200, body: { id: "file-resumed" } },
  ]);
  const result = await Drive.uploadDocument(deps(fake), { ...baseInput, content: Buffer.alloc(size, 3) });
  assert.equal(result.id, "file-resumed");
  // 끊긴 뒤 "얼마나 받았나" 를 묻는 호출이 있어야 한다.
  const probe = fake.calls.find(call => call.options.headers && /^bytes \*\//u.test(String(call.options.headers["content-range"] || "")));
  assert.ok(probe, "받은 지점을 묻는 호출이 있어야 한다");
});

test("계속 끊기면 무한히 재시도하지 않는다", async () => {
  const size = Drive.RESUMABLE_THRESHOLD_BYTES + 100;
  const attempts = [
    { status: 200, headers: { location: "https://upload/session-3" } },
    ...Array.from({ length: 40 }, () => ({ throws: true })),
  ];
  const fake = fakeDrive([...folderLookups, { body: { files: [] } }, ...attempts]);
  await rejectsCode(
    Drive.uploadDocument(deps(fake), { ...baseInput, content: Buffer.alloc(size, 3), maxAttempts: 3 }),
    "DRIVE_UNREACHABLE",
  );
});

test("업로드 도중 권한이 끊기면 다시 연결하라고 말한다", async () => {
  const size = Drive.RESUMABLE_THRESHOLD_BYTES + 100;
  const fake = fakeDrive([
    ...folderLookups,
    { body: { files: [] } },
    { status: 200, headers: { location: "https://upload/session-4" } },
    { status: 401 },
  ]);
  await rejectsCode(
    Drive.uploadDocument(deps(fake), { ...baseInput, content: Buffer.alloc(size, 3) }),
    "DRIVE_AUTH_REQUIRED",
  );
});

test("업로드 주소를 못 받으면 그 자리에서 멈춘다", async () => {
  const size = Drive.RESUMABLE_THRESHOLD_BYTES + 100;
  const fake = fakeDrive([
    ...folderLookups,
    { body: { files: [] } },
    { status: 200, headers: {} },
  ]);
  await rejectsCode(
    Drive.uploadDocument(deps(fake), { ...baseInput, content: Buffer.alloc(size, 3) }),
    "DRIVE_FAILED",
  );
});

test("빈 파일과 너무 큰 파일은 올리기 전에 막는다", async () => {
  const fake = fakeDrive([]);
  await rejectsCode(Drive.uploadDocument(deps(fake), { ...baseInput, content: Buffer.alloc(0) }), "FILE_INVALID");
  await rejectsCode(
    Drive.uploadDocument(deps(fake), { ...baseInput, content: Buffer.alloc(Drive.MAX_FILE_BYTES + 1) }),
    "FILE_TOO_LARGE",
  );
  assert.equal(fake.calls.length, 0, "Drive 를 부르기 전에 막아야 한다");
});

test("로그인 없이 올리려 하면 그 자리에서 막는다", async () => {
  const fake = fakeDrive([]);
  await rejectsCode(
    Drive.uploadDocument({ fetchImpl: fake.fetchImpl, accessToken: "" }, { ...baseInput, content: Buffer.alloc(10) }),
    "DRIVE_AUTH_REQUIRED",
  );
  assert.equal(fake.calls.length, 0);
});

test("올린 파일은 정해진 폴더 경로 안에 들어간다", async () => {
  const fake = fakeDrive([
    { body: { files: [] } },
    { body: { id: "f-building" } },
    { body: { files: [] } },
    { body: { id: "f-type" } },
    { body: { files: [] } },
    { body: { id: "f-year" } },
    { body: { files: [] } },
    { body: { id: "file-1" } },
  ]);
  await Drive.uploadDocument(deps(fake), { ...baseInput, content: Buffer.alloc(10, 1) });
  // 업로드 주소(/upload/drive/v3/files)도 같은 조각을 포함하므로 빼고 센다.
  const created = fake.calls.filter(call =>
    call.options.method === "POST"
    && call.url.startsWith(Drive.DRIVE_FILES_URL)
    && !call.url.startsWith(Drive.DRIVE_UPLOAD_URL));
  assert.equal(created.length, 3, "건물·종류·연도 세 단계");
  assert.equal(JSON.parse(created[0].options.body).name, "우산동 다가구_원주시 우산동 123");
  assert.equal(JSON.parse(created[1].options.body).name, "건물관리 위탁계약서");
  assert.equal(JSON.parse(created[2].options.body).name, "2026");
});

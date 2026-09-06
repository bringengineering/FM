const assert = require("node:assert/strict");
const test = require("node:test");

const Drive = require("../src/building-docs-drive");

const throwsCode = (fn, code) => assert.throws(fn, error => {
  assert.equal(error.code, code, `기대한 코드 ${code}, 실제 ${error && error.code}`);
  return true;
});

const rejectsCode = async (promise, code) => {
  await assert.rejects(promise, error => {
    assert.equal(error.code, code, `기대한 코드 ${code}, 실제 ${error && error.code}`);
    return true;
  });
};

// Drive 를 실제로 부르지 않는다. 부르는 모양만 기록해 두고 정해진 답을 준다.
function fakeDrive(responses) {
  const calls = [];
  const queue = responses.slice();
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options: options || {} });
    const next = queue.shift();
    if (!next) throw new Error(`예상하지 못한 Drive 호출: ${url}`);
    if (next.throws) throw new Error("network down");
    return {
      ok: next.status === undefined || (next.status >= 200 && next.status < 300),
      status: next.status ?? 200,
      json: async () => {
        if (next.badJson) throw new Error("bad json");
        return next.body ?? {};
      },
    };
  };
  return { fetchImpl, calls };
}

const deps = fake => ({ fetchImpl: fake.fetchImpl, accessToken: "token-abc" });

test("폴더 경로는 건물·서류종류·연도 순이다", () => {
  assert.deepEqual(
    Drive.buildFolderPath({
      buildingName: "우산동 다가구",
      buildingAddress: "원주시 우산동 123",
      docTypeLabel: "건물관리 위탁계약서",
      documentDate: "2026-08-04",
    }),
    ["우산동 다가구_원주시 우산동 123", "건물관리 위탁계약서", "2026"],
  );
});

test("연도로 한 번 더 나눠 한 폴더에 뭉치지 않게 한다", () => {
  const a = Drive.buildFolderPath({ buildingName: "가", docTypeLabel: "점검 체크리스트", documentDate: "2025-03-02" });
  const b = Drive.buildFolderPath({ buildingName: "가", docTypeLabel: "점검 체크리스트", documentDate: "2026-03-02" });
  assert.equal(a[2], "2025");
  assert.equal(b[2], "2026");
  assert.equal(a[0], b[0], "같은 건물은 같은 폴더 아래");
});

test("건물명·주소가 비어도 경로가 깨지지 않는다", () => {
  const path = Drive.buildFolderPath({ documentDate: "2026-08-04" });
  assert.deepEqual(path, ["건물명 미입력_주소 미입력", "기타", "2026"]);
});

test("파일 이름에 원래 이름을 남긴다", () => {
  // Drive 에서 직접 볼 때 사람이 알아볼 수 있어야 한다.
  assert.equal(
    Drive.buildFileName({ docTypeLabel: "작업완료 확인서", documentDate: "2026-08-04", originalFileName: "스캔본 (1).pdf" }),
    "작업완료 확인서_2026-08-04_스캔본 (1).pdf",
  );
});

test("이름에 든 위험한 글자를 지운다", () => {
  // 슬래시는 Drive 에서 경로로 읽히고, 제어문자는 눈에 안 보인다.
  assert.equal(Drive.sanitizeName("가/나\\다"), "가-나-다");
  assert.equal(Drive.sanitizeName("여러    칸"), "여러 칸");
  assert.equal(Drive.sanitizeName("...점..."), "점");
  assert.equal(Drive.sanitizeName("   "), "미입력");
  assert.equal(Drive.sanitizeName("줄\n바꿈"), "줄 바꿈");
  assert.equal(Drive.sanitizeName("가".repeat(300)).length, 150);
});

test("확장자를 못 알아보면 bin 으로 둔다", () => {
  assert.equal(Drive.safeExtension("계약서.PDF"), "pdf");
  assert.equal(Drive.safeExtension("사진.JPEG"), "jpeg");
  assert.equal(Drive.safeExtension("확장자없음"), "bin");
  assert.equal(Drive.safeExtension("이상한.한글확장자"), "bin");
  assert.equal(Drive.safeExtension(null), "bin");
});

test("올리기 전에 막아야 할 것을 막는다", () => {
  const base = { accessToken: "t", rootFolderId: "root", size: 100 };
  assert.equal(Drive.assertUploadable(base), true);
  throwsCode(() => Drive.assertUploadable({ ...base, accessToken: "" }), "DRIVE_AUTH_REQUIRED");
  throwsCode(() => Drive.assertUploadable({ ...base, rootFolderId: "" }), "DRIVE_ROOT_REQUIRED");
  throwsCode(() => Drive.assertUploadable({ ...base, size: 0 }), "FILE_INVALID");
  throwsCode(() => Drive.assertUploadable({ ...base, size: Drive.MAX_FILE_BYTES + 1 }), "FILE_TOO_LARGE");
});

test("큰 파일은 이어올리기로 간다", () => {
  // 회선이 끊겨도 처음부터 다시 올리지 않게 하려는 것이다.
  assert.equal(Drive.needsResumable(Drive.RESUMABLE_THRESHOLD_BYTES + 1), true);
  assert.equal(Drive.needsResumable(Drive.RESUMABLE_THRESHOLD_BYTES), false);
  assert.equal(Drive.needsResumable(1024), false);
});

test("질의문에 작은따옴표가 들어와도 깨지지 않는다", () => {
  // 건물 이름에 따옴표가 있으면 Drive 질의가 통째로 어긋난다.
  assert.equal(Drive.quote("건물'이름"), "건물\\'이름");
  assert.equal(Drive.quote("역슬래시\\"), "역슬래시\\\\");
});

test("같은 이름 폴더가 있으면 다시 만들지 않는다", async () => {
  const fake = fakeDrive([{ body: { files: [{ id: "folder-1", name: "우산동" }] } }]);
  const id = await Drive.ensureFolder(deps(fake), "root", "우산동");
  assert.equal(id, "folder-1");
  assert.equal(fake.calls.length, 1, "찾기만 하고 만들지 않는다");
  assert.match(fake.calls[0].url, /files\?q=/u);
});

test("폴더가 없으면 만든다", async () => {
  const fake = fakeDrive([
    { body: { files: [] } },
    { body: { id: "folder-new", name: "우산동" } },
  ]);
  const id = await Drive.ensureFolder(deps(fake), "root", "우산동");
  assert.equal(id, "folder-new");
  assert.equal(fake.calls.length, 2);
  assert.equal(fake.calls[1].options.method, "POST");
  const body = JSON.parse(fake.calls[1].options.body);
  assert.equal(body.mimeType, Drive.FOLDER_MIME);
  assert.deepEqual(body.parents, ["root"]);
});

test("경로를 따라 폴더를 차례로 만든다", async () => {
  const fake = fakeDrive([
    { body: { files: [{ id: "a" }] } },
    { body: { files: [] } },
    { body: { id: "b" } },
    { body: { files: [{ id: "c" }] } },
  ]);
  const id = await Drive.ensureFolderPath(deps(fake), "root", ["건물", "종류", "2026"]);
  assert.equal(id, "c");
  assert.equal(fake.calls.length, 4);
});

test("이미 올린 서류를 표식으로 찾는다", async () => {
  // 사람이 Drive 에서 이름을 바꿔도 알아봐야 한다.
  const fake = fakeDrive([{ body: { files: [{ id: "file-1", webViewLink: "https://drive/x" }] } }]);
  const found = await Drive.findExisting(deps(fake), "folder-1", "doc_abc");
  assert.equal(found.id, "file-1");
  assert.match(decodeURIComponent(fake.calls[0].url), new RegExp(Drive.APP_TAG, "u"));
  assert.match(decodeURIComponent(fake.calls[0].url), /doc_abc/u);
});

test("없으면 null 이지 오류가 아니다", async () => {
  const fake = fakeDrive([{ body: { files: [] } }]);
  assert.equal(await Drive.findExisting(deps(fake), "folder-1", "doc_abc"), null);
});

test("권한이 끊기면 다시 연결하라고 말한다", async () => {
  // 401·403 을 그냥 실패로 뭉뚱그리면 사용자가 뭘 해야 할지 모른다.
  for (const status of [401, 403]) {
    const fake = fakeDrive([{ status }]);
    await rejectsCode(Drive.ensureFolder(deps(fake), "root", "가"), "DRIVE_AUTH_REQUIRED");
  }
});

test("연결 실패와 서버 오류를 구분한다", async () => {
  const offline = fakeDrive([{ throws: true }]);
  await rejectsCode(Drive.ensureFolder(deps(offline), "root", "가"), "DRIVE_UNREACHABLE");

  const broken = fakeDrive([{ status: 500 }]);
  await rejectsCode(Drive.ensureFolder(deps(broken), "root", "가"), "DRIVE_FAILED");

  const garbled = fakeDrive([{ badJson: true }]);
  await rejectsCode(Drive.ensureFolder(deps(garbled), "root", "가"), "DRIVE_FAILED");
});

test("토큰은 헤더로만 나가고 주소에 붙지 않는다", async () => {
  // 주소에 토큰이 붙으면 로그·접속 기록에 그대로 남는다.
  const fake = fakeDrive([{ body: { files: [{ id: "x" }] } }]);
  await Drive.ensureFolder(deps(fake), "root", "가");
  assert.equal(fake.calls[0].url.includes("token-abc"), false);
  assert.equal(fake.calls[0].options.headers.authorization, "Bearer token-abc");
});

test("공유 드라이브에서도 찾을 수 있게 요청한다", async () => {
  // 나중에 공유 드라이브로 옮겨도 코드를 안 고치게 하려는 것이다.
  const fake = fakeDrive([{ body: { files: [{ id: "x" }] } }]);
  await Drive.ensureFolder(deps(fake), "root", "가");
  assert.match(fake.calls[0].url, /supportsAllDrives=true/u);
  assert.match(fake.calls[0].url, /includeItemsFromAllDrives=true/u);
});

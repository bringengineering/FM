// 건물 서류를 회사 Drive 에 올릴 때 쓰는 규칙과 업로드.
//
// 폴더·파일명 규칙은 현장앱(company-site/app/field/lib/drive-folders.ts)이
// 사진에 쓰는 방식을 서류에 맞춰 옮긴 것이다. 두 곳이 같은 트리 아래에서
// 같은 방식으로 쌓이도록 이름 짓는 방법을 맞춰 뒀다.
//
// 올리는 주체는 서비스 계정이 아니라 **로그인한 사람**이다. 회사 서비스 계정은
// 읽기 전용이라 쓰지 못한다. 사람이 Drive 권한에 동의하면 그 접근 토큰으로
// 올린다. 그래서 파일 소유자는 그 사람 계정이 된다 — 공유 드라이브로 옮기는
// 절차는 docs/건물문서함-Drive-연결.md 에 적어 뒀다.
(function attachBuildingDocsDrive(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringBuildingDocsDrive = api;
})(typeof globalThis === "object" ? globalThis : this, function createBuildingDocsDrive() {
  "use strict";

  const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
  const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
  const FOLDER_MIME = "application/vnd.google-apps.folder";

  // 이 크기를 넘으면 이어올리기(resumable)로 간다. 회선이 끊겨도 처음부터 다시
  // 올리지 않게 하려는 것이다. 계약서 스캔·점검 사진 묶음이 여기 걸린다.
  const RESUMABLE_THRESHOLD_BYTES = 5 * 1024 * 1024;
  const MAX_FILE_BYTES = 100 * 1024 * 1024;

  // 파일에 남기는 표식. 같은 서류를 두 번 올렸는지 이걸로 안다.
  const APP_TAG = "bringBuildingDoc";

  function text(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function fail(message, code) {
    return Object.assign(new Error(message), { code });
  }

  /** Drive 폴더·파일 이름에 못 쓰는 글자를 지운다. 현장앱과 같은 방식이다. */
  function sanitizeName(value, fallback = "미입력") {
    const normalized = String(value ?? "")
      .normalize("NFKC")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/[\\/]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^\.+|\.+$/g, "")
      .slice(0, 150);
    return normalized || fallback;
  }

  /**
   * 서류가 들어갈 폴더 경로. 뿌리부터 순서대로 준다.
   *   건물명_주소 / 서류종류 / 연도
   * 연도로 한 번 더 나누는 이유는, 점검 기록처럼 매년 쌓이는 서류가
   * 한 폴더에 수백 개로 뭉치지 않게 하려는 것이다.
   */
  function buildFolderPath(input) {
    const source = input && typeof input === "object" ? input : {};
    const stamp = text(source.documentDate) || text(source.uploadedAt);
    const year = /^(\d{4})/.exec(stamp)?.[1] || String(new Date().getUTCFullYear());
    return [
      `${sanitizeName(source.buildingName, "건물명 미입력")}_${sanitizeName(source.buildingAddress, "주소 미입력")}`,
      sanitizeName(source.docTypeLabel, "기타"),
      year,
    ];
  }

  function safeExtension(fileName) {
    const match = String(fileName ?? "").normalize("NFKC").match(/\.([a-zA-Z0-9]{1,8})$/);
    const extension = match?.[1]?.toLowerCase();
    return extension && /^[a-z0-9]+$/.test(extension) ? extension : "bin";
  }

  /**
   * 올릴 파일 이름.
   *   서류종류_날짜_원래이름.확장자
   * 원래 이름을 남기는 이유는 Drive 에서 직접 볼 때 사람이 알아보게 하려는 것이다.
   */
  function buildFileName(input) {
    const source = input && typeof input === "object" ? input : {};
    const stamp = text(source.documentDate) || text(source.uploadedAt);
    const day = /^(\d{4}-\d{2}-\d{2})/.exec(stamp)?.[1] || new Date().toISOString().slice(0, 10);
    const original = String(source.originalFileName ?? "").replace(/\.[a-zA-Z0-9]{1,8}$/, "");
    const base = sanitizeName(original, "서류").slice(0, 80);
    return `${sanitizeName(source.docTypeLabel, "기타")}_${day}_${base}.${safeExtension(source.originalFileName)}`;
  }

  function assertUploadable(input) {
    const source = input && typeof input === "object" ? input : {};
    if (!text(source.accessToken)) throw fail("Drive 로그인이 필요합니다.", "DRIVE_AUTH_REQUIRED");
    if (!text(source.rootFolderId)) throw fail("건물 문서함 폴더를 먼저 설정해 주세요.", "DRIVE_ROOT_REQUIRED");
    const size = Number(source.size);
    if (!Number.isFinite(size) || size <= 0) throw fail("올릴 파일을 확인해 주세요.", "FILE_INVALID");
    if (size > MAX_FILE_BYTES) {
      throw fail(`파일이 너무 큽니다. ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)}MB 이하만 올릴 수 있습니다.`, "FILE_TOO_LARGE");
    }
    return true;
  }

  function needsResumable(size) {
    return Number(size) > RESUMABLE_THRESHOLD_BYTES;
  }

  // --- Drive 호출 ---------------------------------------------------------
  // fetch 를 밖에서 넣어 준다. 테스트에서 진짜 Drive 를 부르지 않기 위해서다.

  async function driveJson(fetchImpl, url, options, what) {
    let response;
    try {
      response = await fetchImpl(url, options);
    } catch {
      throw fail("Drive 에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.", "DRIVE_UNREACHABLE");
    }
    if (response.status === 401 || response.status === 403) {
      throw fail("Drive 권한이 만료됐습니다. 다시 연결해 주세요.", "DRIVE_AUTH_REQUIRED");
    }
    if (!response.ok) throw fail(`Drive ${what} 에 실패했습니다. (HTTP ${response.status})`, "DRIVE_FAILED");
    try {
      return await response.json();
    } catch {
      throw fail(`Drive ${what} 응답을 읽지 못했습니다.`, "DRIVE_FAILED");
    }
  }

  const authHeader = token => ({ authorization: `Bearer ${token}` });

  // Drive 질의문에 들어갈 값. 작은따옴표가 섞이면 질의가 깨진다.
  function quote(value) {
    return String(value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  /** 이름이 같은 하위 폴더를 찾고, 없으면 만든다. */
  async function ensureFolder(deps, parentId, name) {
    const { fetchImpl, accessToken } = deps;
    const safe = sanitizeName(name);
    const query = [
      `'${quote(parentId)}' in parents`,
      `mimeType = '${FOLDER_MIME}'`,
      `name = '${quote(safe)}'`,
      "trashed = false",
    ].join(" and ");
    const found = await driveJson(
      fetchImpl,
      `${DRIVE_FILES_URL}?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`,
      { headers: authHeader(accessToken) },
      "폴더 확인",
    );
    if (Array.isArray(found.files) && found.files[0] && found.files[0].id) return found.files[0].id;
    const created = await driveJson(
      fetchImpl,
      `${DRIVE_FILES_URL}?fields=id,name&supportsAllDrives=true`,
      {
        method: "POST",
        headers: Object.assign({ "content-type": "application/json" }, authHeader(accessToken)),
        body: JSON.stringify({ name: safe, mimeType: FOLDER_MIME, parents: [parentId] }),
      },
      "폴더 생성",
    );
    if (!created.id) throw fail("Drive 폴더를 만들지 못했습니다.", "DRIVE_FAILED");
    return created.id;
  }

  /** 경로를 따라 폴더를 차례로 만들고 마지막 폴더 ID 를 돌려준다. */
  async function ensureFolderPath(deps, rootFolderId, segments) {
    let parentId = rootFolderId;
    for (const segment of segments) parentId = await ensureFolder(deps, parentId, segment);
    return parentId;
  }

  /**
   * 같은 서류를 이미 올렸는지 본다. 표식(appProperties)으로 찾으므로
   * 사람이 Drive 에서 이름을 바꿔도 알아본다.
   */
  async function findExisting(deps, folderId, documentKey) {
    const { fetchImpl, accessToken } = deps;
    const query = [
      `'${quote(folderId)}' in parents`,
      `appProperties has { key='${APP_TAG}' and value='${quote(documentKey)}' }`,
      "trashed = false",
    ].join(" and ");
    const found = await driveJson(
      fetchImpl,
      `${DRIVE_FILES_URL}?q=${encodeURIComponent(query)}&fields=files(id,name,webViewLink,modifiedTime)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`,
      { headers: authHeader(accessToken) },
      "중복 확인",
    );
    return Array.isArray(found.files) && found.files[0] ? found.files[0] : null;
  }

  // 이어올리기 한 조각 크기. Drive 는 256KB 배수를 요구한다.
  const CHUNK_BYTES = 8 * 256 * 1024;

  function multipartBody(metadata, content, mimeType, boundary) {
    const head = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`
      + `${JSON.stringify(metadata)}\r\n`
      + `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      "utf8",
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
    return Buffer.concat([head, content, tail]);
  }

  /** 작은 파일. 한 번에 올린다. */
  async function uploadMultipart(deps, metadata, content, mimeType) {
    const { fetchImpl, accessToken } = deps;
    const boundary = `bring-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return driveJson(
      fetchImpl,
      `${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id,name,webViewLink,modifiedTime&supportsAllDrives=true`,
      {
        method: "POST",
        headers: Object.assign(
          { "content-type": `multipart/related; boundary=${boundary}` },
          authHeader(accessToken),
        ),
        body: multipartBody(metadata, content, mimeType, boundary),
      },
      "업로드",
    );
  }

  /**
   * 큰 파일. 조각으로 나눠 올리고, 끊기면 서버가 알려 준 지점부터 이어서 올린다.
   * 계약서 스캔처럼 큰 파일을 회선이 불안한 곳에서 올릴 때를 위한 것이다.
   */
  async function uploadResumable(deps, metadata, content, mimeType, options) {
    const { fetchImpl, accessToken } = deps;
    const maxAttempts = Math.max(1, Number(options && options.maxAttempts) || 5);
    const onProgress = typeof (options && options.onProgress) === "function" ? options.onProgress : null;

    let start;
    try {
      start = await fetchImpl(
        `${DRIVE_UPLOAD_URL}?uploadType=resumable&fields=id,name,webViewLink,modifiedTime&supportsAllDrives=true`,
        {
          method: "POST",
          headers: Object.assign(
            { "content-type": "application/json; charset=UTF-8", "x-upload-content-type": mimeType },
            authHeader(accessToken),
          ),
          body: JSON.stringify(metadata),
        },
      );
    } catch {
      throw fail("Drive 에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.", "DRIVE_UNREACHABLE");
    }
    if (start.status === 401 || start.status === 403) {
      throw fail("Drive 권한이 만료됐습니다. 다시 연결해 주세요.", "DRIVE_AUTH_REQUIRED");
    }
    if (!start.ok) throw fail(`Drive 업로드를 시작하지 못했습니다. (HTTP ${start.status})`, "DRIVE_FAILED");
    const sessionUrl = start.headers && typeof start.headers.get === "function" ? start.headers.get("location") : "";
    if (!sessionUrl) throw fail("Drive 업로드 주소를 받지 못했습니다.", "DRIVE_FAILED");

    const total = content.length;
    let offset = 0;
    let attempts = 0;
    while (offset < total) {
      const end = Math.min(offset + CHUNK_BYTES, total);
      let response;
      try {
        response = await fetchImpl(sessionUrl, {
          method: "PUT",
          headers: {
            "content-range": `bytes ${offset}-${end - 1}/${total}`,
            "content-length": String(end - offset),
          },
          body: content.subarray(offset, end),
        });
      } catch {
        // 끊긴 경우. 서버에 어디까지 받았는지 물어보고 그 지점부터 다시 간다.
        attempts += 1;
        if (attempts >= maxAttempts) throw fail("Drive 업로드가 계속 끊깁니다. 잠시 후 다시 시도해 주세요.", "DRIVE_UNREACHABLE");
        offset = await resumeOffset(fetchImpl, sessionUrl, total, offset);
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        throw fail("Drive 권한이 만료됐습니다. 다시 연결해 주세요.", "DRIVE_AUTH_REQUIRED");
      }
      if (response.status === 200 || response.status === 201) {
        if (onProgress) onProgress(total, total);
        try {
          return await response.json();
        } catch {
          throw fail("Drive 업로드 응답을 읽지 못했습니다.", "DRIVE_FAILED");
        }
      }
      if (response.status === 308) {
        offset = rangeEnd(response, end);
        if (onProgress) onProgress(offset, total);
        continue;
      }
      attempts += 1;
      if (attempts >= maxAttempts) throw fail(`Drive 업로드에 실패했습니다. (HTTP ${response.status})`, "DRIVE_FAILED");
      offset = await resumeOffset(fetchImpl, sessionUrl, total, offset);
    }
    throw fail("Drive 업로드가 끝나지 않았습니다.", "DRIVE_FAILED");
  }

  // 308 응답의 Range 헤더에서 "여기까지 받았다" 지점을 읽는다.
  function rangeEnd(response, fallbackEnd) {
    const header = response.headers && typeof response.headers.get === "function"
      ? response.headers.get("range")
      : "";
    const match = /bytes=0-(\d+)/.exec(String(header || ""));
    return match ? Number(match[1]) + 1 : fallbackEnd;
  }

  async function resumeOffset(fetchImpl, sessionUrl, total, currentOffset) {
    try {
      const probe = await fetchImpl(sessionUrl, {
        method: "PUT",
        headers: { "content-range": `bytes */${total}` },
      });
      if (probe.status === 308) return rangeEnd(probe, currentOffset);
      if (probe.status === 200 || probe.status === 201) return total;
    } catch {
      // 물어보는 것마저 실패하면 있던 자리에서 다시 시도한다.
    }
    return currentOffset;
  }

  /**
   * 서류 하나를 올린다. 크기에 따라 방법을 고르고, 같은 서류를 두 번
   * 올리는 경우 이미 있는 파일을 그대로 돌려준다.
   */
  async function uploadDocument(deps, input) {
    const source = input && typeof input === "object" ? input : {};
    const content = Buffer.isBuffer(source.content) ? source.content : Buffer.from(source.content || []);
    assertUploadable({
      accessToken: deps && deps.accessToken,
      rootFolderId: source.rootFolderId,
      size: content.length,
    });
    const folderId = await ensureFolderPath(deps, source.rootFolderId, buildFolderPath(source));
    const documentKey = text(source.documentKey) || text(source.documentId);
    if (documentKey) {
      const existing = await findExisting(deps, folderId, documentKey);
      // 같은 서류를 두 번 올렸다. 새로 만들지 않고 있던 것을 쓴다.
      if (existing) return Object.assign({ alreadyThere: true, folderId }, existing);
    }
    const metadata = {
      name: buildFileName(source),
      parents: [folderId],
      appProperties: documentKey ? { [APP_TAG]: documentKey } : undefined,
    };
    const mimeType = text(source.mimeType) || "application/octet-stream";
    const uploaded = needsResumable(content.length)
      ? await uploadResumable(deps, metadata, content, mimeType, source)
      : await uploadMultipart(deps, metadata, content, mimeType);
    if (!uploaded.id) throw fail("Drive 가 파일 정보를 돌려주지 않았습니다.", "DRIVE_FAILED");
    return Object.assign({ alreadyThere: false, folderId }, uploaded);
  }

  return Object.freeze({
    uploadDocument,
    uploadMultipart,
    uploadResumable,
    CHUNK_BYTES,
    sanitizeName,
    buildFolderPath,
    buildFileName,
    safeExtension,
    assertUploadable,
    needsResumable,
    quote,
    ensureFolder,
    ensureFolderPath,
    findExisting,
    APP_TAG,
    RESUMABLE_THRESHOLD_BYTES,
    MAX_FILE_BYTES,
    DRIVE_FILES_URL,
    DRIVE_UPLOAD_URL,
    FOLDER_MIME,
  });
});

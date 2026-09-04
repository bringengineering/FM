#!/usr/bin/env node
/**
 * Realtime Database 야간 백업 내보내기.
 *
 * 지정한 최상위 경로들을 REST로 읽어 JSON 파일로 저장하고, 무결성 확인용
 * manifest(경로별 SHA-256/바이트수)를 함께 만든다. 실패한 경로가 하나라도
 * 있으면 0이 아닌 코드로 종료해 "조용히 빈 백업이 쌓이는" 상황을 막는다.
 *
 * 환경변수
 *   RTDB_URL       필수. 예) https://bring-fm-default-rtdb.asia-southeast1.firebasedatabase.app
 *   ACCESS_TOKEN   필수. firebase.database 스코프를 가진 OAuth2 액세스 토큰
 *   BACKUP_PATHS   선택. 쉼표로 구분한 최상위 경로 목록(기본값: DEFAULT_PATHS)
 *   OUT_DIR        선택. 기본값 "backup-out"
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// 실제 데이터가 있는 최상위 경로 전부. 하나라도 빠지면 그 부분은 복구할 수 없다.
// fieldPlatform: 현장 건물·호실·매물·방문·촬영세션·미디어 기록
// paymentCalendars: 계정별 입금 캘린더
// signage: 위탁판매 상품·주문
// (crmMigrationStaging 은 과거 이관 사본이라 제외)
const DEFAULT_PATHS = [
  "workflow",
  "cases",
  "caseSettings",
  "crmCompany",
  "fieldPlatform",
  "paymentCalendars",
  "signage",
];

/** 백업 경로를 검증하고 정규화한다. 최상위 한 칸짜리 안전한 키만 허용. */
function normalizeBackupPath(raw) {
  const value = String(raw == null ? "" : raw).trim().replace(/^\/+|\/+$/g, "");
  if (!value) throw new Error("빈 백업 경로는 사용할 수 없습니다.");
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`백업 경로에 사용할 수 없는 문자가 있습니다: ${raw}`);
  }
  return value;
}

/** "a, b ,,c" -> ["a","b","c"] (중복 제거, 순서 유지) */
function parsePathList(raw, fallback = DEFAULT_PATHS) {
  const source = String(raw == null ? "" : raw).trim();
  const list = (source ? source.split(",") : fallback.slice())
    .map((item) => String(item).trim())
    .filter(Boolean)
    .map(normalizeBackupPath);
  if (!list.length) throw new Error("백업할 경로가 하나도 없습니다.");
  return Array.from(new Set(list));
}

/** 저장된 결과들로 manifest 객체를 만든다. */
function buildManifest(entries, meta = {}) {
  const files = entries.map((entry) => ({
    path: entry.path,
    file: entry.file,
    bytes: entry.bytes,
    sha256: entry.sha256,
    empty: entry.bytes <= 4, // "null" 또는 "{}" 수준이면 비어 있는 것으로 표시
  }));
  return {
    generatedAt: meta.generatedAt || new Date().toISOString(),
    databaseUrl: meta.databaseUrl || "",
    totalBytes: files.reduce((sum, item) => sum + item.bytes, 0),
    files,
  };
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function requireEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} 환경변수가 필요합니다.`);
  return value;
}

async function fetchPath(databaseUrl, token, backupPath) {
  const url = `${databaseUrl.replace(/\/+$/, "")}/${backupPath}.json`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `${backupPath} 읽기 실패 (HTTP ${response.status}) ${detail.slice(0, 200)}`
    );
  }
  return Buffer.from(await response.text(), "utf8");
}

async function main() {
  const databaseUrl = requireEnv("RTDB_URL");
  const token = requireEnv("ACCESS_TOKEN");
  const paths = parsePathList(process.env.BACKUP_PATHS);
  const outDir = String(process.env.OUT_DIR || "backup-out").trim();

  fs.mkdirSync(outDir, { recursive: true });

  const entries = [];
  const failures = [];
  for (const backupPath of paths) {
    try {
      const body = await fetchPath(databaseUrl, token, backupPath);
      const file = `${backupPath}.json`;
      fs.writeFileSync(path.join(outDir, file), body);
      entries.push({
        path: backupPath,
        file,
        bytes: body.length,
        sha256: sha256(body),
      });
      console.log(`[백업] ${backupPath} — ${body.length} bytes`);
    } catch (error) {
      failures.push(`${backupPath}: ${error.message}`);
      console.error(`[백업 실패] ${error.message}`);
    }
  }

  const manifest = buildManifest(entries, { databaseUrl });
  fs.writeFileSync(
    path.join(outDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  if (failures.length) {
    throw new Error(`백업하지 못한 경로가 있습니다:\n- ${failures.join("\n- ")}`);
  }
  // Firebase 는 없는 경로에도 200 과 함께 본문 "null"(4바이트)을 돌려준다.
  // 그래서 바이트 합계만 보면 DB 주소가 틀렸거나 경로 이름이 바뀐 경우에도
  // "성공"으로 판정돼 내용 없는 백업이 쌓인다. 실제 내용이 있는 경로로 센다.
  const recovered = manifest.files.filter((file) => !file.empty);
  if (!recovered.length) {
    throw new Error(
      "백업한 모든 경로가 비어 있습니다. RTDB_URL·권한·경로 이름을 확인하세요.\n" +
        `확인한 경로: ${manifest.files.map((file) => file.path).join(", ")}`
    );
  }
  console.log(
    `[백업 완료] 총 ${manifest.totalBytes} bytes / 내용 있는 경로 ${recovered.length}개 (전체 ${entries.length}개)`
  );
}

module.exports = { normalizeBackupPath, parsePathList, buildManifest, DEFAULT_PATHS };

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

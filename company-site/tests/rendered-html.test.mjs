import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const LEGACY_PROJECT_ID = "bring-fm-hj";

async function findLegacyProjectReferences(entry, matches = []) {
  const stat = await readdir(entry, { withFileTypes: true });
  for (const item of stat) {
    const child = new URL(item.name + (item.isDirectory() ? "/" : ""), entry);
    if (item.isDirectory()) {
      await findLegacyProjectReferences(child, matches);
      continue;
    }
    const contents = await readFile(child);
    if (contents.includes(Buffer.from(LEGACY_PROJECT_ID))) {
      matches.push(child.pathname);
    }
  }
  return matches;
}

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: {
        accept: "text/html",
        host: "localhost",
      },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Bring Care company website", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="ko"/i);
  assert.match(html, /Bring Care \| 브링엔지니어링 시설관리/);
  assert.match(html, /Bring Care · bringengineering 홈으로 이동/);
  assert.match(html, /brand-engineering/);
  assert.match(html, /관리의 모든 흐름을/);
  assert.match(html, /건물의 오늘을 돌보고/);
  assert.match(html, /hero-fm\.png/);
  assert.match(html, /브링엔지니어링/);
  assert.match(html, /748-28-01935/);
  assert.match(html, /og\.png/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
  assert.doesNotMatch(html, /365일|24시간 출동/);
});

test("server-renders the consultation page with direct contacts", async () => {
  const response = await render("/consult");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /상담 신청 \| Bring Care/);
  assert.match(html, /010-6566-3606/);
  assert.match(html, /bringengineering1008@gmail\.com/);
  assert.match(html, /상담 신청 전송/);
  assert.match(html, /전송 대행 서비스/);
});

test("server-renders the consultation completion page", async () => {
  const response = await render("/consult/complete");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /상담 신청 발송 완료 \| Bring Care/);
  assert.match(html, /발송 완료되었습니다/);
  assert.match(html, /담당 이메일로 전달되었습니다/);
  assert.match(html, /010-6566-3606/);
});

test("mail bridge accepts only the two published Bring Care origins", async () => {
  const bridge = await readFile(
    new URL("../public/consult-mail-bridge.html", import.meta.url),
    "utf8",
  );
  assert.match(bridge, /https:\/\/bring-fm\.web\.app/);
  assert.match(
    bridge,
    /https:\/\/bring-care-fm\.bringengineering1008\.chatgpt\.site/,
  );
  assert.match(bridge, /bring-consult-submit/);
  assert.match(bridge, /bring-consult-result/);
  assert.match(bridge, /formsubmit\.co\/ajax\/bringengineering1008@gmail\.com/);
});

test("active Firebase hosting sources and exported assets target bring-fm only", async () => {
  const activeDirectories = [
    new URL("../app/", import.meta.url),
    new URL("../public/", import.meta.url),
    new URL("../firebase-public/", import.meta.url),
  ];
  const matches = [];

  for (const directory of activeDirectories) {
    await findLegacyProjectReferences(directory, matches);
  }

  const repositoryMap = await readFile(
    new URL("../../wonju-map.html", import.meta.url),
  );
  if (repositoryMap.includes(Buffer.from(LEGACY_PROJECT_ID))) {
    matches.push("wonju-map.html");
  }

  assert.deepEqual(matches, []);

  const [
    exportedHome,
    exportedConsult,
    exportedField,
    exportedBridge,
    exportedMap,
    assetManifest,
  ] =
    await Promise.all([
      readFile(new URL("../firebase-public/index.html", import.meta.url), "utf8"),
      readFile(
        new URL("../firebase-public/consult/index.html", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../firebase-public/field/index.html", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../firebase-public/consult-mail-bridge.html", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../firebase-public/wonju-map.html", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../firebase-public/.vite/manifest.json", import.meta.url),
        "utf8",
      ),
    ]);

  assert.match(exportedHome, /https:\/\/bring-fm\.web\.app\/og\.png/);
  assert.match(
    exportedConsult,
    /https:\/\/bring-fm\.web\.app\/consult-mail-bridge\.html/,
  );
  assert.match(
    exportedField,
    /https:\/\/bring-fm\.web\.app\/field\/manifest\.webmanifest/,
  );
  assert.match(exportedBridge, /https:\/\/bring-fm\.web\.app/);
  assert.match(exportedMap, /projectId:\s*"bring-fm"/);
  assert.match(
    exportedMap,
    /https:\/\/bring-fm-default-rtdb\.asia-southeast1\.firebasedatabase\.app/,
  );

  const fieldAssetPath = JSON.parse(assetManifest)[
    "app/field/components/v2/FieldV2App.tsx"
  ].file;
  const fieldAsset = await readFile(
    new URL(`../firebase-public/${fieldAssetPath}`, import.meta.url),
    "utf8",
  );
  assert.match(fieldAsset, /authDomain:[`"]bring-fm\.firebaseapp\.com[`"]/);
  assert.match(fieldAsset, /projectId:[`"]bring-fm[`"]/);
});

test("the retired project reference remains confined to the GET-only migration adapter", async () => {
  const migrationAdapter = await readFile(
    new URL("../../desktop-crm/src/crm-staged-migration.js", import.meta.url),
    "utf8",
  );

  assert.match(migrationAdapter, /bring-fm-hj/);
  assert.match(migrationAdapter, /toUpperCase\(\) !== "GET"/);
  assert.match(
    migrationAdapter,
    /fetchImpl\(url, \{ method: "GET", headers: \{ Accept: "application\/json" \} \}\)/,
  );
});

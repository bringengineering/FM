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
  assert.match(html, /건물을 관리하며/);
  assert.match(html, /청소까지 직접 수행합니다/);
  assert.match(html, /bringcare-suited-team-building-v3\.png/);
  assert.match(html, /브링케어 브랜드 캠페인 이미지/);
  assert.match(html, /브링엔지니어링/);
  assert.match(html, /748-28-01935/);
  assert.match(html, /og\.png/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
  assert.doesNotMatch(html, /365일|24시간 출동/);
});

test("homepage team photo uses the original image without a blurred backdrop", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.doesNotMatch(css, /\.hero-media::before/);
  assert.match(css, /\.hero-media img\s*\{[^}]*object-fit:\s*contain/s);
});

test("server-renders the consultation page with direct contacts", async () => {
  const response = await render("/consult");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /상담 신청 \| Bring Care/);
  assert.match(html, /010-6566-3603/);
  assert.match(html, /bringengineering1008@gmail\.com/);
  assert.match(html, /상담 신청 전송/);
  assert.match(html, /전송 대행 서비스/);
});

test("server-renders the consultation completion page", async () => {
  const response = await render("/consult/complete");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /상담 신청 접수 완료 \| Bring Care/);
  assert.match(html, /접수 완료되었습니다/);
  assert.match(html, /브링케어 CRM에 안전하게 접수되었습니다/);
  assert.match(html, /010-6566-3603/);
});

const landingRoutes = [
  {
    pathname: "/stair-cleaning",
    heading: "원주 계단·공용부",
    price: "주 1회 3층 6만원부터",
    title: "원주 계단·공용부 청소 | BRING CARE",
    description:
      "원주 원룸·다가구 계단과 복도 정기청소. 월 4회 6만원부터, 작업사진과 건물 이상사항을 함께 보고합니다.",
  },
  {
    pathname: "/building-care",
    heading: "멀리 있어도",
    price: "월 8만 9천원부터",
    title: "원주 원룸·다가구 건물관리 | BRING CARE",
    description:
      "공실, 세입자 문의, 입퇴실과 건물 상태를 연결하는 원주 지역 공동관리. 월 8.9만원.",
  },
  {
    pathname: "/move-in-cleaning",
    heading: "새 공간의 첫날",
    price: "관리 건물 10만원 · 일반 단건 12만원부터",
    title: "원주 입주청소 10만원부터 | BRING CARE",
    description:
      "원주 원룸 입주청소 10만원부터. 작업 범위를 먼저 안내하고 완료 사진으로 확인합니다.",
  },
  {
    pathname: "/turnover-care",
    heading: "퇴실 다음 날",
    price: "관리 건물 입·퇴실청소 10만원부터",
    priceFragments: ["관리 건물 입·퇴실청소", "10만원부터"],
    turnoverMarkers: [
      "https://pf.kakao.com/_xnaRfX/chat",
      "tenancy-check.jpg",
      'href="#turnover-conditions"',
      'id="turnover-conditions"',
    ],
    title: "원주 24H 입·퇴실 관리 | BRING CARE",
    description:
      "퇴실 14일 전부터 준비하는 원주 입·퇴실 관리. 퇴실 확인, 직영 청소, 필요한 보수 연결과 완료 사진을 한 흐름으로 관리합니다.",
  },
];

for (const {
  pathname,
  heading,
  price,
  priceFragments,
  turnoverMarkers,
  title,
  description,
} of landingRoutes) {
  test(`server-renders ${pathname} with complete service metadata`, async () => {
    const response = await render(pathname);
    assert.equal(response.status, 200);

    const html = await response.text();
    assert.ok(html.includes(heading));
    if (priceFragments) {
      priceFragments.forEach((fragment) => assert.ok(html.includes(fragment)));
    } else {
      assert.ok(html.includes(price));
    }
    turnoverMarkers?.forEach((marker) => assert.ok(html.includes(marker)));
    assert.match(html, /tel:01065663603/);
    assert.match(html, /quick-estimate/);
    assert.match(html, /quick-estimate-floating/);
    assert.match(html, /href="#quick-estimate"/);
    assert.match(html, /빠른 견적/);
    assert.match(html, /청소하면서 건물까지 봅니다/);
    assert.match(html, /부가세 별도/);
    assert.doesNotMatch(html, /1위|100% 만족|최우수|작업 전후 사진/);
    assert.doesNotMatch(html, /무조건 공실 0일|24시간 안에 새 임차인/);

    assert.ok(html.includes(`<title>${title}</title>`));
    assert.ok(html.includes(`name="description" content="${description}"`));
    assert.ok(
      html.includes(`rel="canonical" href="http://localhost${pathname}"`),
    );
    assert.ok(html.includes(`property="og:title" content="${title}"`));
    assert.ok(
      html.includes(`property="og:description" content="${description}"`),
    );
    assert.ok(html.includes('name="twitter:card" content="summary"'));
    assert.ok(html.includes(`name="twitter:title" content="${title}"`));
    assert.ok(
      html.includes(`name="twitter:description" content="${description}"`),
    );
  });
}

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

  const parsedManifest = JSON.parse(assetManifest);
  const fieldAssetPath = parsedManifest[
    "app/field/components/v2/FieldV2App.tsx"
  ].file;
  const fieldAsset = await readFile(
    new URL(`../firebase-public/${fieldAssetPath}`, import.meta.url),
    "utf8",
  );
  const firebaseAssetPath = Object.values(parsedManifest).find(
    (entry) => entry.name === "firebase.client",
  ).file;
  const firebaseAsset = await readFile(
    new URL(`../firebase-public/${firebaseAssetPath}`, import.meta.url),
    "utf8",
  );
  assert.match(fieldAsset, /firebase\.client/);
  assert.match(firebaseAsset, /authDomain:[`"]bring-fm\.firebaseapp\.com[`"]/);
  assert.match(firebaseAsset, /projectId:[`"]bring-fm[`"]/);
});

test("Firebase export includes every Naver ad landing route", async () => {
  for (const {
    pathname,
    price,
    priceFragments,
    turnoverMarkers,
    title,
    description,
  } of landingRoutes) {
    const file = `../firebase-public${pathname}/index.html`;
    const html = await readFile(new URL(file, import.meta.url), "utf8");
    if (priceFragments) {
      priceFragments.forEach((fragment) => assert.ok(html.includes(fragment)));
    } else {
      assert.ok(html.includes(price));
    }
    turnoverMarkers?.forEach((marker) => assert.ok(html.includes(marker)));
    assert.match(html, /tel:01065663603/);
    assert.match(html, /quick-estimate/);
    assert.doesNotMatch(html, /\/_vinext\/image/);
    assert.match(html, /src="\/landing\/[^\"]+\.jpg"/);
    assert.ok(html.includes(`<title>${title}</title>`));
    assert.ok(
      html.includes(
        `rel="canonical" href="https://bring-fm.web.app${pathname}"`,
      ),
    );
    assert.ok(html.includes(`property="og:title" content="${title}"`));
    assert.ok(
      html.includes(`property="og:description" content="${description}"`),
    );
    assert.ok(html.includes(`name="twitter:title" content="${title}"`));
    assert.ok(
      html.includes(`name="twitter:description" content="${description}"`),
    );
  }
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

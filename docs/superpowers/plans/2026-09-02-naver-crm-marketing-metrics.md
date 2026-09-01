# Naver Ads CRM Marketing Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 네이버 검색광고 통계를 10분마다 Firebase에 동기화하고 CRM에서 캠페인별 비용·클릭·문의·AI용 운영 제안을 표시한다.

**Architecture:** Cloud Functions가 서버 비밀값으로 SearchAd API를 읽고 `/marketingMetrics/naver`에 일자·캠페인 단위 스냅샷을 멱등 저장한다. Desktop CRM은 기존 renderer overlay 흐름으로 지표와 문의를 함께 읽고, 순수 함수로 KPI와 보수적인 AI용 인사이트를 계산한다.

**Tech Stack:** TypeScript, Firebase Functions v2 Scheduler, Firebase Realtime Database, Node.js 22, Electron renderer, Node test runner, Vitest

---

### Task 1: 마케팅 지표 정규화 모델

**Files:**
- Create: `desktop-crm/src/marketing-metrics.js`
- Test: `desktop-crm/test/marketing-metrics.test.js`

- [ ] **Step 1: 정규화와 KPI 계산 실패 테스트 작성**

```js
const Metrics = require("../src/marketing-metrics");

test("normalizes campaign metrics and safely calculates rates", () => {
  const row = Metrics.normalizeMetric({ campaignId: "cmp_1", impressions: 100, clicks: 4, spend: 8800 });
  assert.equal(row.ctr, 4);
  assert.equal(row.averageCpc, 2200);
  assert.equal(Metrics.normalizeMetric({ campaignId: "cmp_2" }).ctr, null);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd desktop-crm; npm test -- --test-name-pattern="marketing metrics"`

Expected: FAIL because `marketing-metrics.js` does not exist.

- [ ] **Step 3: 최소 정규화 구현**

```js
function ratio(numerator, denominator, multiplier = 1) {
  return denominator > 0 ? numerator / denominator * multiplier : null;
}

function normalizeMetric(value) {
  const source = value && typeof value === "object" ? value : {};
  const impressions = Math.max(0, Number(source.impressions) || 0);
  const clicks = Math.max(0, Number(source.clicks) || 0);
  const spend = Math.max(0, Number(source.spend) || 0);
  return { ...source, impressions, clicks, spend, ctr: ratio(clicks, impressions, 100), averageCpc: ratio(spend, clicks) };
}

module.exports = { normalizeMetric, ratio };
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd desktop-crm; npm test -- --test-name-pattern="marketing metrics"`

Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add desktop-crm/src/marketing-metrics.js desktop-crm/test/marketing-metrics.test.js
git commit -m "feat: add marketing metric model"
```

### Task 2: SearchAd 서명 클라이언트

**Files:**
- Create: `functions/src/marketing/naver-searchad.ts`
- Test: `functions/test/naver-searchad.test.ts`

- [ ] **Step 1: HMAC 서명과 응답 정규화 실패 테스트 작성**

```ts
expect(signSearchAdRequest({ timestamp: "1700000000000", method: "GET", path: "/stats", secretKey: "secret" }))
  .toBe("fixed-base64-fixture");
expect(normalizeSearchAdStat({ impCnt: 10, clkCnt: 2, salesAmt: 3300 }).spend).toBe(3300);
```

- [ ] **Step 2: 실패 확인**

Run: `cd functions; npm test -- naver-searchad.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: HMAC-SHA256 서명과 fetch 의존성 주입 구현**

```ts
export function signSearchAdRequest(input: SignInput): string {
  const message = `${input.timestamp}.${input.method}.${input.path}`;
  return createHmac("sha256", input.secretKey).update(message).digest("base64");
}
```

클라이언트는 `X-Timestamp`, `X-API-KEY`, `X-Customer`, `X-Signature` 헤더를 사용하고 429, 401, 5xx를 구분한다.

- [ ] **Step 4: 성공·인증실패·한도초과 테스트 통과 확인**

Run: `cd functions; npm test -- naver-searchad.test.ts`

Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add functions/src/marketing/naver-searchad.ts functions/test/naver-searchad.test.ts
git commit -m "feat: add naver searchad client"
```

### Task 3: 10분 동기화 런타임

**Files:**
- Create: `functions/src/marketing/sync-naver-marketing.ts`
- Test: `functions/test/sync-naver-marketing.test.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: 캠페인·일자 단위 멱등 저장 실패 테스트 작성**

```ts
await syncNaverMarketingCore({ now: fixedNow }, dependencies);
await syncNaverMarketingCore({ now: fixedNow }, dependencies);
expect(databaseWrites).toHaveLength(2);
expect(databaseWrites[0].path).toBe("marketingMetrics/naver/days/2026-09-02/cmp_1");
expect(databaseWrites[0].value.clicks).toBe(2);
```

- [ ] **Step 2: 실패 확인**

Run: `cd functions; npm test -- sync-naver-marketing.test.ts`

Expected: FAIL because the sync runtime does not exist.

- [ ] **Step 3: 동기화 코어 구현**

조회 범위는 서울 시간의 오늘과 최근 7일이다. 캠페인 이름을 `building_care`, `stair_cleaning`, `move_in_cleaning` 서비스 키에 매핑하고, 원본 갱신시각·동기화시각·오류 상태를 함께 저장한다.

- [ ] **Step 4: 스케줄 함수와 비밀값 연결**

```ts
const naverAccessLicense = defineSecret("NAVER_SEARCHAD_ACCESS_LICENSE");
const naverSecretKey = defineSecret("NAVER_SEARCHAD_SECRET_KEY");
const naverCustomerId = defineSecret("NAVER_SEARCHAD_CUSTOMER_ID");

export const syncNaverMarketingMetrics = onSchedule({
  schedule: "every 10 minutes",
  timeZone: "Asia/Seoul",
  region: "asia-northeast3",
  secrets: [naverAccessLicense, naverSecretKey, naverCustomerId],
}, async () => syncNaverMarketingCore({ now: new Date() }, runtimeDependencies()));
```

- [ ] **Step 5: 테스트와 빌드 확인**

Run: `cd functions; npm test -- sync-naver-marketing.test.ts; npm run build`

Expected: PASS and TypeScript build exits 0.

- [ ] **Step 6: 커밋**

```bash
git add functions/src/marketing functions/test/naver-searchad.test.ts functions/test/sync-naver-marketing.test.ts functions/src/index.ts
git commit -m "feat: sync naver marketing metrics"
```

### Task 4: CRM overlay에 지표 연결

**Files:**
- Modify: `desktop-crm/src/core.js`
- Modify: `desktop-crm/src/remote.js`
- Modify: `desktop-crm/src/app.js`
- Test: `desktop-crm/test/building-vacancy-data.test.js`

- [ ] **Step 1: renderer-only 지표 정규화 실패 테스트 추가**

```js
const overlays = Core.sanitizeRendererOverlays({ marketingMetrics: { campaigns: { cmp_1: { campaignId: "cmp_1", clicks: 2 } } } });
assert.equal(overlays.marketingMetrics.campaigns.length, 1);
assert.equal(Object.hasOwn(Core.sanitizeSharedStore(overlays), "marketingMetrics"), false);
```

- [ ] **Step 2: 실패 확인**

Run: `cd desktop-crm; npm test -- --test-name-pattern="marketing metrics overlay"`

Expected: FAIL because the overlay omits marketing metrics.

- [ ] **Step 3: 정규화·원격 읽기·merge 구현**

`remote.js`에 `loadMarketingMetrics()`를 추가해 `/marketingMetrics/naver`를 읽고, `loadRendererOverlays()`와 `mergeRendererOverlays()`에 값을 전달한다. `core.js`는 날짜·캠페인 키와 숫자 필드를 화이트리스트 정규화한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd desktop-crm; npm test -- --test-name-pattern="marketing metrics overlay"`

Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add desktop-crm/src/core.js desktop-crm/src/remote.js desktop-crm/src/app.js desktop-crm/test/building-vacancy-data.test.js
git commit -m "feat: load naver metrics into crm"
```

### Task 5: 마케팅 대시보드와 AI용 인사이트

**Files:**
- Create: `desktop-crm/src/marketing-metrics-ui.js`
- Test: `desktop-crm/test/marketing-metrics-ui.test.js`
- Modify: `desktop-crm/src/index.html`
- Modify: `desktop-crm/src/app.js`
- Modify: `desktop-crm/src/styles.css`

- [ ] **Step 1: KPI·상태·안전한 제안 렌더링 실패 테스트 작성**

```js
const html = MarketingMetricsUI.render({ campaigns, leads, now: "2026-09-02T09:00:00+09:00" });
assert.match(html, /마케팅 지표/);
assert.match(html, /평균 CPC/);
assert.match(html, /표본 부족/);
assert.doesNotMatch(html, /자동 증액/);
```

- [ ] **Step 2: 실패 확인**

Run: `cd desktop-crm; npm test -- --test-name-pattern="marketing metrics ui"`

Expected: FAIL because the UI module does not exist.

- [ ] **Step 3: KPI와 인사이트 순수 함수 구현**

인사이트는 `유지`, `감액 검토`, `증액 검토`, `중지 검토`, `데이터 지연`만 반환한다. 클릭 10건 미만에서는 성과 결론 대신 `표본 부족`을 우선 표시한다.

- [ ] **Step 4: 대시보드 통합과 스타일 추가**

`index.html`에서 `marketing-metrics.js`, `marketing-metrics-ui.js`를 `app.js` 전에 불러오고, `renderDashboard()`에서 광고 문의함 위에 지표 패널을 렌더링한다.

- [ ] **Step 5: 전체 Desktop CRM 테스트 실행**

Run: `cd desktop-crm; npm test`

Expected: all tests PASS.

- [ ] **Step 6: 커밋**

```bash
git add desktop-crm/src/marketing-metrics-ui.js desktop-crm/test/marketing-metrics-ui.test.js desktop-crm/src/index.html desktop-crm/src/app.js desktop-crm/src/styles.css
git commit -m "feat: show naver marketing dashboard"
```

### Task 6: 설정·운영 문서와 최종 검증

**Files:**
- Create: `docs/naver-searchad-crm-operations.md`

- [ ] **Step 1: 비밀값·동기화·장애 대응 절차 문서화**

문서에는 세 Firebase Secret 이름, 광고계정 `2575255`, 10분 주기, `/marketingMetrics/naver` 경로, 수동 동기화 검증, 오류 코드별 대응을 기록한다. 실제 비밀값은 문서에 쓰지 않는다.

- [ ] **Step 2: 전체 검증 실행**

Run: `cd functions; npm test; npm run build; cd ../desktop-crm; npm test`

Expected: all tests PASS and build exits 0.

- [ ] **Step 3: 원본·CRM 숫자 대조 체크리스트 수행**

동일한 서울 날짜와 최신 집계시각 기준으로 네이버 대시보드의 노출·클릭·비용 합계와 Firebase·CRM 합계를 비교한다. 차이가 있으면 광고 ON 전환을 중지하고 원본 지연시각을 확인한다.

- [ ] **Step 4: 커밋**

```bash
git add docs/naver-searchad-crm-operations.md
git commit -m "docs: add naver marketing operations guide"
```


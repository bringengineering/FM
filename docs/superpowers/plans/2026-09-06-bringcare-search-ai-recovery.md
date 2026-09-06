# BRING CARE Search and AI Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the three BRING CARE service pages and make them crawlable and understandable to Naver, conventional search engines, and answer-generating systems.

**Architecture:** Start from the current production CRM branch in a separate worktree and transplant only the BRING CARE landing routes, their shared landing components, and referenced assets. Add static crawl-control files plus a small server-rendered structured-data component; deploy Hosting only after route and metadata tests pass.

**Tech Stack:** TypeScript, React, vinext/Next-compatible metadata, Vitest, Firebase Hosting, Naver Search Advisor

---

### Task 1: Create an isolated production integration worktree

**Files:**
- Reference: `docs/superpowers/specs/2026-09-06-bringcare-search-ai-optimization-design.md`
- Reference: `firebase.json`
- Reference: `company-site/package.json`

- [ ] **Step 1: Confirm the production ref and current live failure**

Run:

```powershell
git fetch upstream
git rev-parse upstream/codex/bring-field-platform
Invoke-WebRequest https://bring-fm.web.app/building-care -SkipHttpErrorCheck | Select-Object StatusCode
```

Expected: the ref resolves and the live route returns `404` before recovery.

- [ ] **Step 2: Create the isolated worktree**

Run from the repository containing this worktree:

```powershell
git worktree add ..\bringcare-seo-recovery -b codex/bringcare-seo-recovery upstream/codex/bring-field-platform
```

Expected: a new worktree on `codex/bringcare-seo-recovery`, leaving the dirty landing-page worktree untouched.

- [ ] **Step 3: Record the exact source commit**

Create `docs/bringcare-recovery-source.md` with:

```markdown
# BRING CARE recovery source

- Production base: output of `git rev-parse upstream/codex/bring-field-platform`
- Landing source: `dafa419c`
- Scope: `/building-care`, `/stair-cleaning`, `/move-in-cleaning`, shared landing dependencies, crawl files
- Excluded: Functions, Database Rules, CRM release workflow, Naver ad configuration
```

- [ ] **Step 4: Commit the recovery boundary**

```powershell
git add docs/bringcare-recovery-source.md
git commit -m "docs: bound Bring Care hosting recovery"
```

### Task 2: Add failing route and metadata contracts

**Files:**
- Create: `company-site/tests/landing/search-discovery.test.ts`
- Modify: `company-site/tests/landing/building-care-sales.test.tsx`
- Modify: `company-site/tests/landing/landing-page.test.tsx`

- [ ] **Step 1: Write the static discovery test**

```ts
import {readFileSync} from "node:fs";
import {describe, expect, it} from "vitest";

const publicFile = (name: string) => readFileSync(new URL(`../../public/${name}`, import.meta.url), "utf8");

describe("BRING CARE search discovery", () => {
  it("publishes crawl rules and the three canonical services", () => {
    expect(publicFile("robots.txt")).toContain("Sitemap: https://bring-fm.web.app/sitemap.xml");
    const sitemap = publicFile("sitemap.xml");
    for (const path of ["building-care", "stair-cleaning", "move-in-cleaning"])
      expect(sitemap).toContain(`https://bring-fm.web.app/${path}`);
    expect(sitemap).not.toMatch(/\/field|\/crm-auth/);
  });

  it("publishes an evidence-bounded AI reading guide", () => {
    const text = publicFile("llms.txt");
    expect(text).toContain("BRING CARE");
    expect(text).toContain("https://bring-fm.web.app/building-care");
    expect(text).not.toMatch(/최고|유일|보장/);
  });
});
```

- [ ] **Step 2: Add one JSON-LD contract per service test**

In `landing-page.test.tsx`, render `BuildingCareLanding`, `StairCleaningLanding`, and `MoveInCleaningLanding`. For each render, assert a script with `type="application/ld+json"`, the correct canonical URL, service name, `Wonju-si`, and FAQ questions that also appear as visible text.

- [ ] **Step 3: Run the tests and verify failure**

```powershell
pnpm --dir company-site exec vitest run tests/landing/search-discovery.test.ts tests/landing/building-care-sales.test.tsx tests/landing/landing-page.test.tsx
```

Expected: FAIL because the crawl files and structured-data component do not exist on the production base.

- [ ] **Step 4: Commit only the failing contracts**

```powershell
git add company-site/tests/landing
git commit -m "test: define Bring Care search discovery contracts"
```

### Task 3: Restore the three service routes without replacing production

**Files:**
- Restore from landing source: `company-site/app/building-care/**`
- Restore from landing source: `company-site/app/stair-cleaning/**`
- Restore from landing source: `company-site/app/move-in-cleaning/**`
- Restore from landing source: `company-site/app/landing/**`
- Restore referenced media only: `company-site/public/landing/**`
- Preserve: `.github/workflows/crm-release.yml`
- Preserve: `functions/**`

- [ ] **Step 1: List route dependencies before copying**

```powershell
git diff --name-only upstream/codex/bring-field-platform dafa419c -- company-site/app company-site/public/landing
```

Expected: only landing routes, shared landing components/styles/data, and their media are selected.

- [ ] **Step 2: Restore text files and referenced binary assets from `dafa419c`**

Use `git show dafa419c:<path>` for each text file through a temporary file and apply its contents to the new worktree; copy binary media from the shared repository object database. Do not restore `firebase.json`, workflows, functions, CRM files, generated `firebase-public`, or unrelated application routes.

- [ ] **Step 3: Install and run the landing tests**

```powershell
pnpm --dir company-site install --frozen-lockfile
pnpm --dir company-site test -- --run tests/landing
```

Expected: existing landing behavior passes; only the new discovery tests remain red until Task 4.

- [ ] **Step 4: Commit the selected restoration**

```powershell
git add company-site/app/building-care company-site/app/stair-cleaning company-site/app/move-in-cleaning company-site/app/landing company-site/public/landing
git commit -m "fix: restore Bring Care service landings"
```

### Task 4: Add crawl files, visible FAQ, and structured data

**Files:**
- Create: `company-site/public/robots.txt`
- Create: `company-site/public/sitemap.xml`
- Create: `company-site/public/llms.txt`
- Create: `company-site/app/landing/ServiceStructuredData.tsx`
- Create: `company-site/app/landing/serviceSearchData.ts`
- Modify: the three service page or landing components to render FAQ and JSON-LD

- [ ] **Step 1: Add crawl controls**

`robots.txt`:

```text
User-agent: *
Allow: /
Disallow: /field
Disallow: /crm-auth
Disallow: /care-records
Sitemap: https://bring-fm.web.app/sitemap.xml
```

`sitemap.xml` must contain exactly the home page and the three canonical service URLs, with no private routes. Use `2026-09-06` as the initial `lastmod` for this recovery release.

`llms.txt` must identify BRING CARE as a BRING Engineering service in Wonju and link the three canonical pages. Include only the actual service scope and conditional starting prices shown on those pages.

- [ ] **Step 2: Define one evidence source**

```ts
export type SearchService = {
  path: string;
  name: string;
  description: string;
  questions: Array<{question: string; answer: string}>;
};

export const serviceSearchData: Record<string, SearchService> = {
  "building-care": {
    path: "/building-care",
    name: "건물관리·입퇴실 통합관리",
    description: "원주 원룸·다가구의 시설, 임차인, 유지관리, 입퇴실, 공실과 관리기록을 연결합니다.",
    questions: [
      {question: "기본 건물관리는 얼마부터인가요?", answer: "기본 관리는 월 69,000원부터이며 건물 조건과 범위에 따라 달라집니다."},
      {question: "방문과 공용부 청소 주기는 같나요?", answer: "건물관리 방문은 주 2회 기준이고 공용부 청소는 월 4회 기준입니다."}
    ]
  }
};
```

The same object must also contain:

```ts
"stair-cleaning": {
  path: "/stair-cleaning",
  name: "계단·공용부 정기청소",
  description: "원주 원룸·다가구의 계단, 복도와 공동현관을 월 4회 정기청소하고 작업 결과를 공유합니다.",
  questions: [
    {question: "정기청소는 얼마부터인가요?", answer: "월 4회 기준 3층 60,000원, 4층 70,000원, 5층 80,000원이며 부가세는 별도입니다."},
    {question: "방문 횟수를 늘릴 수 있나요?", answer: "건물 규모와 유동 인구를 확인한 뒤 주 2회 또는 주 3회 방문도 협의할 수 있습니다."}
  ]
},
"move-in-cleaning": {
  path: "/move-in-cleaning",
  name: "입주·이사청소",
  description: "원주 지역 현관, 주방, 욕실, 창틀과 바닥의 작업 범위를 먼저 안내하고 완료 사진으로 확인합니다.",
  questions: [
    {question: "입주·이사청소는 얼마부터인가요?", answer: "관리 건물은 100,000원부터, 일반 단건은 120,000원부터이며 부가세와 옵션 작업은 별도입니다."},
    {question: "최종 금액은 무엇에 따라 달라지나요?", answer: "면적, 오염도, 잔존 물품과 추가 작업 여부를 확인한 뒤 최종 견적을 안내합니다."}
  ]
}
```

- [ ] **Step 3: Render visible FAQ and matching JSON-LD**

`ServiceStructuredData.tsx` must serialize `Organization`, `LocalBusiness`, `Service`, `FAQPage`, and `BreadcrumbList`. Escape `<` in the serialized string (`JSON.stringify(value).replace(/</g, "\\u003c")`) and render the same questions visibly so structured data never claims hidden content.

- [ ] **Step 4: Run discovery and landing tests**

```powershell
pnpm --dir company-site exec vitest run tests/landing/search-discovery.test.ts tests/landing
```

Expected: PASS.

- [ ] **Step 5: Commit search foundations**

```powershell
git add company-site/public/robots.txt company-site/public/sitemap.xml company-site/public/llms.txt company-site/app/landing company-site/tests/landing
git commit -m "feat: add Bring Care search discovery foundations"
```

### Task 5: Build and verify the deployable Hosting output

**Files:**
- Generated: `company-site/firebase-public/**`
- Reference: `firebase.json`

- [ ] **Step 1: Run the complete company-site test suite**

```powershell
pnpm --dir company-site test
```

Expected: all tests pass with zero failures.

- [ ] **Step 2: Build the static Hosting output**

```powershell
pnpm --dir company-site build
```

Expected: exit code 0; `firebase-public/building-care/index.html`, `stair-cleaning/index.html`, `move-in-cleaning/index.html`, `robots.txt`, `sitemap.xml`, and `llms.txt` exist.

- [ ] **Step 3: Serve and smoke-test locally**

Start the repository's existing static preview command, then request all six public targets. Assert `200`, a unique title for every service, one canonical link, and valid JSON parsing for every `application/ld+json` block.

- [ ] **Step 4: Verify the deployment diff**

```powershell
git diff --check
git status --short
```

Expected: no Functions, Database Rules, CRM workflow, or advertising configuration changes.

### Task 6: Deploy Hosting only and verify production

**Files:**
- Deploy source: `company-site/firebase-public/**`
- Deploy config: `firebase.json`

- [ ] **Step 1: Confirm the target immediately before deploy**

```powershell
firebase hosting:sites:list --project bring-fm
firebase deploy --only hosting:bring-fm --project bring-fm --non-interactive
```

Expected: only Hosting site `bring-fm` is updated. No Functions, Database, Storage or ad setting is part of the command.

- [ ] **Step 2: Verify public results**

Request:

```text
https://bring-fm.web.app/building-care
https://bring-fm.web.app/stair-cleaning
https://bring-fm.web.app/move-in-cleaning
https://bring-fm.web.app/robots.txt
https://bring-fm.web.app/sitemap.xml
https://bring-fm.web.app/llms.txt
```

Expected: HTTP 200 for all six. Check title, canonical, visible FAQ, JSON-LD, CTA and internal links in a real browser.

- [ ] **Step 3: Record release evidence**

Update `docs/bringcare-recovery-source.md` with deployed commit, Firebase release time, response codes and the exact six verified URLs, then commit.

### Task 7: Register and measure Naver discovery

**Files:**
- Create: `docs/bringcare-search-baseline-2026-09-06.md`

- [ ] **Step 1: Open Naver Search Advisor and verify account**

In the in-app browser, verify the current Naver account is `dpvld858` before any registration action. If it differs, stop without changing accounts.

- [ ] **Step 2: Prepare site registration**

Use `https://bring-fm.web.app` as the site, verify ownership using the least-invasive supported method, and prepare submission of `https://bring-fm.web.app/sitemap.xml` plus the three service URLs. Obtain action-time confirmation before the registration/submission action because it changes an external account.

- [ ] **Step 3: Capture the measurement baseline**

Record crawl status, indexed URL count, search exposure, clicks and query availability. Write `없음`, `0`, and `확인 불가` distinctly; never substitute one for another.

- [ ] **Step 4: Set the comparison date**

Record 2026-09-20 as the two-week comparison date. At comparison, use the same five-lane rubric and Naver/CRM quantitative data.

- [ ] **Step 5: Commit the baseline**

```powershell
git add docs/bringcare-search-baseline-2026-09-06.md
git commit -m "docs: record Bring Care search baseline"
```

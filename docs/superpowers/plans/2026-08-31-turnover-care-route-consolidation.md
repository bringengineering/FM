# 입·퇴실 통합관리 경로 통합 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/turnover-care` 방문자를 건물관리 페이지의 입·퇴실 통합관리 구역으로 영구 이동시켜 광고페이지를 세 개로 통합한다.

**Architecture:** Firebase Hosting의 정적 파일보다 우선하는 `301` 리다이렉트 규칙을 사용한다. 건물관리 내부 링크는 `#turnover-package`를 가리키도록 정리하고, 설정 테스트와 실제 배포 응답으로 이동 동작을 검증한다.

**Tech Stack:** Firebase Hosting, Next.js/vinext, Vitest, TypeScript

---

### Task 1: 경로 통합 회귀 테스트

**Files:**
- Create: `company-site/tests/landing/turnover-route-consolidation.test.ts`
- Modify: `firebase.json`

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("turnover-care route consolidation", () => {
  it("permanently redirects the legacy landing to the building-care turnover section", () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), "../firebase.json"), "utf8"));
    expect(config.hosting.redirects).toContainEqual({
      source: "/turnover-care",
      destination: "/building-care#turnover-package",
      type: 301,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/landing/turnover-route-consolidation.test.ts`

Expected: FAIL because `hosting.redirects` is missing.

- [ ] **Step 3: Add the minimal Firebase redirect**

```json
"redirects": [
  {
    "source": "/turnover-care",
    "destination": "/building-care#turnover-package",
    "type": 301
  }
]
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/landing/turnover-route-consolidation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add firebase.json company-site/tests/landing/turnover-route-consolidation.test.ts
git commit -m "feat: redirect turnover care to building management"
```

### Task 2: Internal Link and Deployment Verification

**Files:**
- Modify: `company-site/app/landing/buildingCareData.ts`
- Modify: `company-site/tests/landing/building-care-data.test.ts`
- Modify: `company-site/firebase-public/**` through the existing export command

- [ ] **Step 1: Add a failing assertion that the building-care package link is internal**

```ts
expect(entryServices.find((item) => item.title.includes("입·퇴실"))?.href)
  .toBe("#turnover-package");
```

- [ ] **Step 2: Run the focused test and confirm the old `/turnover-care` value fails**

Run: `pnpm exec vitest run tests/landing/building-care-data.test.ts`

Expected: FAIL showing `/turnover-care` instead of `#turnover-package`.

- [ ] **Step 3: Change only the package link**

```ts
{ title: "24H 입·퇴실 관리", copy: "퇴실 접수부터 다음 입실 준비까지", href: "#turnover-package", cta: "입퇴실 패키지 문의하기" }
```

- [ ] **Step 4: Run landing tests and build**

Run: `pnpm test:landing && pnpm build && pnpm export:firebase`

Expected: all landing tests pass, build and export exit with code 0.

- [ ] **Step 5: Deploy and verify the live redirect**

Run: `firebase deploy --only hosting --project bring-fm`

Expected: `https://bring-fm.web.app/turnover-care` returns a permanent redirect to `https://bring-fm.web.app/building-care#turnover-package` and the target section is visible.

- [ ] **Step 6: Commit exported assets**

```bash
git add company-site/firebase-public
git commit -m "build: publish consolidated building care landing"
```

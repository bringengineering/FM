# BRING CARE Cleaning Landing Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and validate three conversion-focused BRING CARE landing pages for Naver ads, using real BRING CARE blog evidence, direct phone contact, and a compact quote form.

**Architecture:** Keep the existing Vinext/Next application intact and add one data-driven landing-page system. Service-specific route files select typed content from a shared configuration; a shared server-rendered page component owns layout while a small client component owns quote-form state and delivery. Existing `/`, `/consult`, and `/field` routes remain unchanged.

**Tech Stack:** TypeScript 5.9, React 19, Next 16/Vinext, CSS, Vitest, Node test runner, Firebase static export, OpenAI Sites build.

---

## File map

- Create `company-site/app/landing/services.ts`: typed content for the three services.
- Create `company-site/app/landing/LandingPage.tsx`: shared server-rendered landing-page layout.
- Create `company-site/app/landing/QuickEstimateForm.tsx`: compact client-side quote form.
- Create `company-site/app/landing/landing.css`: responsive layout, cards, form, and mobile sticky actions.
- Create `company-site/app/stair-cleaning/page.tsx`: stair/common-area route and metadata.
- Create `company-site/app/building-care/page.tsx`: building-management route and metadata.
- Create `company-site/app/move-in-cleaning/page.tsx`: move-in-cleaning route and metadata.
- Create `company-site/public/landing/`: curated, privacy-safe BRING CARE blog images.
- Create `company-site/tests/landing/services.test.ts`: configuration integrity tests.
- Create `company-site/tests/landing/quick-estimate-form.test.tsx`: quote-form behavior tests.
- Modify `company-site/tests/rendered-html.test.mjs`: built-route and metadata assertions.
- Modify `company-site/package.json`: add focused landing test command and include it in validation.
- Modify `company-site/app/layout.tsx`: preserve current metadata and expose trusted site origin if needed by route metadata.
- Modify `company-site/.gitignore`: ignore `.superpowers/` visual-companion artifacts.

## Task 0: Prepare the implementation branch on the current upstream source

**Files:**
- Preserve: `company-site/docs/superpowers/specs/2026-08-23-bring-care-cleaning-landing-pages-design.md`
- Preserve outside Git: `company-site/.superpowers/`

- [ ] **Step 1: Verify the current worktree and upstream revision**

Run:

```powershell
git status --short --branch
git rev-parse upstream/claude/jolly-davinci-zl27wm
git show --stat --oneline 68c9836
```

Expected: the design commit exists, the upstream branch resolves, and the current untracked `company-site` is the retrieved upstream site.

- [ ] **Step 2: Preserve the untracked preview directory and clear the branch-switch collision safely**

Resolve and verify both absolute paths before moving:

```powershell
$source = (Resolve-Path 'company-site').Path
$backup = 'C:\Users\user\.codex\worktrees\39f9\company-site-retrieved-backup'
$source
$backup
```

Expected: `$source` is inside `C:\Users\user\.codex\worktrees\39f9\마케팅` and `$backup` is the explicit sibling backup directory.

Move the retrieved copy without deleting it:

```powershell
Move-Item -LiteralPath $source -Destination $backup
```

Expected: the backup contains `package.json`, `app/page.tsx`, and `.superpowers/`.

- [ ] **Step 3: Create the feature branch from the current company source and restore the approved spec**

Run:

```powershell
git switch -c codex/bringcare-cleaning-landings upstream/claude/jolly-davinci-zl27wm
git cherry-pick 68c9836
```

Expected: branch `codex/bringcare-cleaning-landings` contains the tracked `company-site` and the approved design document.

- [ ] **Step 4: Ignore visual-companion artifacts**

Add this exact line to `company-site/.gitignore`:

```gitignore
.superpowers/
```

Run:

```powershell
git diff --check
git add company-site/.gitignore
git commit -m "chore: ignore landing page design previews"
```

Expected: one commit with only the ignore rule.

## Task 1: Define typed service content

**Files:**
- Create: `company-site/tests/landing/services.test.ts`
- Create: `company-site/app/landing/services.ts`
- Modify: `company-site/package.json`

- [ ] **Step 1: Add the focused test script**

Add to `scripts` in `company-site/package.json`:

```json
"test:landing": "vitest run tests/landing"
```

- [ ] **Step 2: Write the failing configuration test**

Create `company-site/tests/landing/services.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { landingServices } from "../../app/landing/services";

describe("landing service configuration", () => {
  it("defines the three Naver ad routes with distinct content", () => {
    expect(Object.keys(landingServices)).toEqual([
      "stair-cleaning",
      "building-care",
      "move-in-cleaning",
    ]);

    expect(landingServices["stair-cleaning"].price).toContain("6만원");
    expect(landingServices["building-care"].price).toContain("8.9만원");
    expect(landingServices["move-in-cleaning"].price).toContain("10만원");
  });

  it("keeps claims evidence-based and gives every record a source", () => {
    for (const service of Object.values(landingServices)) {
      expect(service.title).not.toMatch(/1위|100%|최우수/);
      expect(service.scope.length).toBeGreaterThanOrEqual(4);
      expect(service.faq.length).toBeGreaterThanOrEqual(3);
      for (const record of service.records) {
        expect(record.sourceUrl).toMatch(/^https:\/\/blog\.naver\.com\/bringcare\//);
        expect(record.alt.length).toBeGreaterThan(8);
      }
    }
  });
});
```

- [ ] **Step 3: Run the test and verify it fails**

Run:

```powershell
cd company-site
pnpm test:landing
```

Expected: FAIL because `app/landing/services.ts` does not exist.

- [ ] **Step 4: Implement the typed configuration**

Create `company-site/app/landing/services.ts` with these public types and keys:

```ts
export type LandingSlug =
  | "stair-cleaning"
  | "building-care"
  | "move-in-cleaning";

export type LandingRecord = {
  image: string;
  alt: string;
  label: string;
  title: string;
  copy: string;
  sourceUrl: string;
};

export type LandingService = {
  slug: LandingSlug;
  eyebrow: string;
  metaTitle: string;
  metaDescription: string;
  title: string;
  accent: string;
  lead: string;
  price: string;
  priceNote: string;
  heroImage: string;
  heroAlt: string;
  facts: Array<{ value: string; label: string }>;
  scope: Array<{ title: string; copy: string }>;
  records: LandingRecord[];
  process: Array<{ title: string; copy: string }>;
  faq: Array<{ question: string; answer: string }>;
};

export const landingServices: Record<LandingSlug, LandingService> = {
  "stair-cleaning": {
    slug: "stair-cleaning",
    eyebrow: "원주 원룸·다가구 계단청소",
    metaTitle: "원주 계단·공용부 청소 | BRING CARE",
    metaDescription:
      "원주 원룸·다가구 계단과 복도 정기청소. 월 4회 6만원부터, 작업사진과 건물 이상사항을 함께 보고합니다.",
    title: "깨끗하게만 하지 않습니다.",
    accent: "건물 상태까지 확인합니다.",
    lead: "계단·복도 정기청소부터 조명·누수 흔적·적치물 확인까지. 작업 후 사진으로 확인하세요.",
    price: "월 4회 6만원부터",
    priceNote: "층수, 오염도, 작업 범위에 따라 달라질 수 있습니다.",
    heroImage: "/landing/common-area-issue.jpg",
    heroAlt: "브링케어가 관리 중인 원주 건물 공용부",
    facts: [
      { value: "월 4회", label: "정기 방문" },
      { value: "사진 제공", label: "작업 완료 확인" },
      { value: "이상 보고", label: "조명·누수·적치물" },
      { value: "원주", label: "지역 현장 대응" },
    ],
    scope: [
      { title: "계단·난간", copy: "층별 계단과 손이 자주 닿는 난간을 정리합니다." },
      { title: "복도·현관", copy: "공용 복도와 출입구의 먼지와 오염을 관리합니다." },
      { title: "우편함 주변", copy: "우편함과 공용 안내 공간을 함께 살핍니다." },
      { title: "공용창·문", copy: "손자국과 주변 오염을 확인해 정돈합니다." },
    ],
    records: [],
    process: [
      { title: "건물 확인", copy: "주소, 층수, 공용부 상태를 확인합니다." },
      { title: "범위 협의", copy: "방문 횟수와 포함 범위를 정합니다." },
      { title: "정기 작업", copy: "약속한 일정에 공용부를 관리합니다." },
      { title: "사진 보고", copy: "완료 사진과 이상사항을 전달합니다." },
    ],
    faq: [
      { question: "청소 범위는 어디까지인가요?", answer: "계단, 복도, 현관 등 계약한 공용부를 기준으로 안내합니다." },
      { question: "가격은 항상 6만원인가요?", answer: "6만원은 시작 가격이며 층수, 오염도, 범위에 따라 달라집니다." },
      { question: "건물주가 원주에 없어도 되나요?", answer: "가능합니다. 작업 결과와 확인 사항을 사진으로 전달합니다." },
    ],
  },
  "building-care": {
    slug: "building-care",
    eyebrow: "원주 원룸·다가구 건물관리",
    metaTitle: "원주 원룸·다가구 건물관리 | BRING CARE",
    metaDescription:
      "공실, 세입자 문의, 입퇴실과 건물 상태를 연결하는 원주 지역 공동관리. 월 8.9만원.",
    title: "멀리 있어도,",
    accent: "우리 건물의 오늘을 확인할 수 있습니다.",
    lead: "공실부터 세입자 문의, 입퇴실과 현장 확인까지 처리 결과를 사진과 기록으로 연결합니다.",
    price: "지역 공동관리 월 8.9만원",
    priceNote: "건물 규모와 관리 범위에 따라 별도 협의될 수 있습니다.",
    heroImage: "/landing/address-sign-after.jpg",
    heroAlt: "브링케어가 관리한 건물 입구 표식",
    facts: [
      { value: "공실", label: "상태 확인" },
      { value: "입퇴실", label: "현장 지원" },
      { value: "민원", label: "접수·연결" },
      { value: "사진", label: "처리 결과 보고" },
    ],
    scope: [
      { title: "공실 확인", copy: "비어 있는 호실의 상태와 필요한 조치를 확인합니다." },
      { title: "공용부 점검", copy: "조명, 표식, 적치물과 공용 공간을 살핍니다." },
      { title: "민원 연결", copy: "세입자 문의를 받고 필요한 담당과 연결합니다." },
      { title: "소규모 보수", copy: "현장 확인부터 자재·작업자 연결과 완료 확인까지 돕습니다." },
    ],
    records: [],
    process: [
      { title: "건물 등록", copy: "위치, 세대수, 현재 관리 상태를 확인합니다." },
      { title: "관리 범위 결정", copy: "필요한 항목과 보고 방식을 정합니다." },
      { title: "현장 대응", copy: "점검, 민원과 필요한 작업을 연결합니다." },
      { title: "결과 공유", copy: "사진과 처리 내용을 건물주에게 전달합니다." },
    ],
    faq: [
      { question: "원주 밖에 살아도 맡길 수 있나요?", answer: "가능합니다. 현장 확인과 처리 결과를 사진과 기록으로 전달합니다." },
      { question: "8.9만원에 모든 수리비가 포함되나요?", answer: "관리 서비스 비용이며 자재와 전문 공사 비용은 사전 안내 후 별도입니다." },
      { question: "청소만 먼저 맡길 수 있나요?", answer: "가능합니다. 공용부 청소 후 필요한 관리 범위를 함께 상담할 수 있습니다." },
    ],
  },
  "move-in-cleaning": {
    slug: "move-in-cleaning",
    eyebrow: "원주 입주·이사청소",
    metaTitle: "원주 입주청소 10만원부터 | BRING CARE",
    metaDescription:
      "원주 원룸 입주청소 10만원부터. 작업 범위를 먼저 안내하고 전후 사진으로 확인합니다.",
    title: "새 공간의 첫날,",
    accent: "작업 전후 사진으로 확인하세요.",
    lead: "현관, 주방, 욕실, 창틀과 바닥의 작업 범위를 먼저 안내하고 완료 후 사진으로 확인합니다.",
    price: "원룸 10만원부터",
    priceNote: "평형, 오염도, 옵션과 추가 작업에 따라 달라질 수 있습니다.",
    heroImage: "/landing/move-in-condition.jpg",
    heroAlt: "입주 전 상태를 확인하는 원룸 내부",
    facts: [
      { value: "범위 안내", label: "작업 전 확인" },
      { value: "전후 사진", label: "완료 상태 확인" },
      { value: "원룸부터", label: "공간별 견적" },
      { value: "원주", label: "지역 상담" },
    ],
    scope: [
      { title: "현관", copy: "바닥, 문과 신발장 주변을 정리합니다." },
      { title: "주방", copy: "싱크대, 수납장과 조리 공간을 관리합니다." },
      { title: "욕실", copy: "세면대, 변기, 바닥과 벽면을 청소합니다." },
      { title: "창틀·바닥", copy: "창 주변 먼지와 실내 바닥을 마무리합니다." },
    ],
    records: [],
    process: [
      { title: "사진 상담", copy: "공간과 오염 상태를 먼저 확인합니다." },
      { title: "범위·가격 안내", copy: "포함 항목과 추가 항목을 구분합니다." },
      { title: "현장 작업", copy: "약속한 범위에 맞춰 청소합니다." },
      { title: "완료 확인", copy: "작업 후 상태를 사진으로 확인합니다." },
    ],
    faq: [
      { question: "10만원에 모든 평형이 가능한가요?", answer: "10만원은 원룸 기준 시작 가격이며 평형과 오염도에 따라 달라집니다." },
      { question: "작업 범위를 미리 알 수 있나요?", answer: "상담 단계에서 포함 항목과 별도 항목을 구분해 안내합니다." },
      { question: "청소 후 확인은 어떻게 하나요?", answer: "현장 확인 또는 작업 후 사진으로 완료 상태를 확인할 수 있습니다." },
    ],
  },
};
```

- [ ] **Step 5: Run the focused test**

Run:

```powershell
pnpm test:landing
```

Expected: PASS for configuration count, prices, claims, scope, and FAQ. The record-source loop is vacuous until Task 2 populates records.

- [ ] **Step 6: Commit**

```powershell
git add company-site/package.json company-site/app/landing/services.ts company-site/tests/landing/services.test.ts
git commit -m "feat: define cleaning landing page content"
```

## Task 2: Curate real BRING CARE blog evidence

**Files:**
- Create: `company-site/public/landing/address-sign-before.jpg`
- Create: `company-site/public/landing/address-sign-after.jpg`
- Create: `company-site/public/landing/unit-sign-repair.jpg`
- Create: `company-site/public/landing/entrance-signage.jpg`
- Create: `company-site/public/landing/common-area-issue.jpg`
- Create: `company-site/public/landing/move-in-condition.jpg`
- Modify: `company-site/app/landing/services.ts`
- Test: `company-site/tests/landing/services.test.ts`

- [ ] **Step 1: Extract candidate image URLs from the public BRING CARE RSS feed**

Run a read-only extraction that prints titles, post URLs, and image URLs:

```powershell
$rss = [xml](Invoke-WebRequest -UseBasicParsing 'https://rss.blog.naver.com/bringcare.xml').Content
$rss.rss.channel.item | Where-Object {
  $_.title -match '도로명주소판|호수판|안내문|청소 과정 중|입주 전'
} | ForEach-Object {
  [pscustomobject]@{ Title=$_.title; Link=$_.link; Description=$_.description }
}
```

Expected: only posts from `blog.naver.com/bringcare` appear.

- [ ] **Step 2: Download only privacy-safe original images**

Download these six BRING CARE source images with a browser-like user agent. The 호수판 and 출입구 images were already privacy-masked by BRING CARE before publication. Inspect the remaining four before use and move any unsuitable image to the explicit backup directory.

```powershell
New-Item -ItemType Directory -Force 'company-site/public/landing' | Out-Null
$headers = @{ Referer='https://blog.naver.com/bringcare'; 'User-Agent'='Mozilla/5.0' }
$images = @{
  'address-sign-before.jpg' = 'https://postfiles.pstatic.net/MjAyNjA4MTlfMTYz/MDAxNzg3MTQ4Njg3MjEz.K5ckcb21tplk902KTrk85lXld4kANZE2SDyKtOUj2ggg.ySeloRpB78Nmxj_FZHFZzTeZPv62gybLSuMILjzdMq8g.PNG/photo-01-before.png'
  'address-sign-after.jpg' = 'https://postfiles.pstatic.net/MjAyNjA4MTlfMjE1/MDAxNzg3MTQ4OTY4NTA1.SURRYxUyo3emlAcgYN7pDlIZ5w0jvNJV64zaoZsDs9sg.UKdWhFUHm35NGeA3_Z5XjLxgkpSGXXshCZm6Lh95lQ4g.PNG/photo-05-complete.png'
  'unit-sign-repair.jpg' = 'https://postfiles.pstatic.net/MjAyNjA4MThfOSAg/MDAxNzg3MDMwNTg4NDI2.9MYOvbQ9vmuGNYTe7yA1_G_l70rjYaWMFa0N7qr46LMg.GfQYrG_CIMW-HN77FIqDr1ziqj2PUZPpcKPipCvlYdcg.PNG/08_%ED%98%B8%EC%88%98%ED%8C%90%EB%B2%A8%EC%BB%A4%EB%B2%84_%EA%B0%9C%EC%9D%B8%EC%A0%95%EB%B3%B4%EA%B0%80%EB%A6%BC.png'
  'entrance-signage.jpg' = 'https://postfiles.pstatic.net/MjAyNjA4MThfODYg/MDAxNzg3MDMwNTU4NjIx.Civ6-5uTCiWVWJc_4ZKwbydAHk170spF8WipJUoKWOYg.Xbt3SFOJIbnUVD3vIl_JalwF2itULAUL6c7QZgpkW48g.PNG/07_%EC%B6%9C%EC%9E%85%EA%B5%AC%EC%95%88%EB%82%B4%EB%AC%BC_%EA%B0%9C%EC%9D%B8%EC%A0%95%EB%B3%B4%EA%B0%80%EB%A6%BC.png'
  'common-area-issue.jpg' = 'https://postfiles.pstatic.net/MjAyNjA4MThfMjk1/MDAxNzg3MDMwNDY4MzU5.bpmKojB5vGGJ8971KsDxMAQEg3uH4I7zBXc77AB1fo8g.LUas6F5bhmPsVQI4uS79mZvGYbO7KK8A5MCiNVRG6Twg.JPEG/codex-clipboard-dc9cdba8-8782-4d69-a135-a0d233bddd22.jpg'
  'move-in-condition.jpg' = 'https://postfiles.pstatic.net/MjAyNjA4MDRfMyAg/MDAxNzg1ODUwNDAyMTg2.SWhQoCwbR3T2BnYV6M37VrpAvHu6KwWvsxLjCom0hr0g.Pr4uFzNb9rwK7WieFTUpLoGXXyJ9K7h89Ae3dTHQSokg.PNG/KakaoTalk_20260730_130418805.png'
}
foreach ($entry in $images.GetEnumerator()) {
  Invoke-WebRequest -UseBasicParsing -Headers $headers -Uri $entry.Value -OutFile (Join-Path 'company-site/public/landing' $entry.Key)
}
```

Expected: each file opens as an image and contains no visible personal information.

- [ ] **Step 3: Inspect every downloaded image**

Open each file with the local image viewer and record whether it is suitable for hero, evidence card, or neither. Remove unsuitable files from the planned set by moving them to the explicit backup directory, not by deleting them.

Expected: only genuine BRING CARE field images remain under `public/landing`.

- [ ] **Step 4: Populate evidence records with exact source posts**

Add records to the appropriate service in `services.ts` using this shape:

```ts
records: [
  {
    image: "/landing/address-sign-before.jpg",
    alt: "교체 전 표면이 낡은 건물 입구 도로명주소판",
    label: "확인",
    title: "작은 표식도 상태부터 확인합니다.",
    copy: "현장에서 보이는 상태를 기록하고 필요한 조치를 구분했습니다.",
    sourceUrl: "https://blog.naver.com/bringcare/224383896443",
  },
  {
    image: "/landing/address-sign-after.jpg",
    alt: "새 도로명주소판을 부착한 뒤 확인한 건물 입구",
    label: "완료",
    title: "작업 뒤 전체 위치까지 다시 확인합니다.",
    copy: "가까운 사진과 전경을 함께 남겨 건물주가 결과를 확인할 수 있게 했습니다.",
    sourceUrl: "https://blog.naver.com/bringcare/224383896443",
  },
],
```

Use the exact blog log numbers found during extraction for every record.

- [ ] **Step 5: Make the record test non-vacuous**

Add to `services.test.ts`:

```ts
expect(landingServices["building-care"].records.length).toBeGreaterThanOrEqual(3);
expect(
  Object.values(landingServices).flatMap((service) => service.records).length,
).toBeGreaterThanOrEqual(5);
```

- [ ] **Step 6: Run tests and commit**

```powershell
pnpm test:landing
git add company-site/public/landing company-site/app/landing/services.ts company-site/tests/landing/services.test.ts
git commit -m "feat: add Bring Care field evidence to landing pages"
```

Expected: tests pass and the commit contains only curated images, config, and tests.

## Task 3: Build the compact quote form

**Files:**
- Create: `company-site/app/landing/QuickEstimateForm.tsx`
- Create: `company-site/tests/landing/quick-estimate-form.test.tsx`

- [ ] **Step 1: Write failing form tests**

Create `company-site/tests/landing/quick-estimate-form.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import QuickEstimateForm from "../../app/landing/QuickEstimateForm";

describe("QuickEstimateForm", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("renders the minimum required fields and service context", () => {
    render(<QuickEstimateForm service="계단·공용부 청소" sourcePath="/stair-cleaning" />);
    expect(screen.getByLabelText("이름")).toBeRequired();
    expect(screen.getByLabelText("연락처")).toBeRequired();
    expect(screen.getByLabelText("건물 위치 또는 지역")).toBeRequired();
    expect(screen.getByText("계단·공용부 청소 견적 신청")).toBeInTheDocument();
  });

  it("does not submit when consent is missing", () => {
    render(<QuickEstimateForm service="입주청소" sourcePath="/move-in-cleaning" />);
    fireEvent.click(screen.getByRole("button", { name: "간편 견적 신청" }));
    expect(fetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```powershell
pnpm test:landing -- tests/landing/quick-estimate-form.test.tsx
```

Expected: FAIL because `QuickEstimateForm` does not exist.

- [ ] **Step 3: Implement the minimal accessible form**

Create a `"use client"` component with props:

```ts
type QuickEstimateFormProps = {
  service: string;
  sourcePath: string;
};
```

The rendered form must include:

```tsx
<h2>{service} 견적 신청</h2>
<label>이름<input name="name" required /></label>
<label>연락처<input name="phone" type="tel" inputMode="tel" required /></label>
<label>건물 위치 또는 지역<input name="location" required /></label>
<label>건물 정보<textarea name="buildingInfo" /></label>
<label className="estimate-consent">
  <input name="consent" type="checkbox" required />
  상담을 위해 입력 정보를 이메일로 전달하는 데 동의합니다.
</label>
```

Submit to the existing FormSubmit endpoint. Include `_subject`, `_template`, `_captcha=false`, service, source path, full current URL, `utm_source`, `utm_campaign`, `utm_term`, and receipt time. Use the existing `https://bring-fm.web.app/consult-mail-bridge.html` iframe when the origin is not `bring-fm.web.app`. Disable the submit button while sending. On success navigate to `/consult/complete`; on failure render a status message plus links to `tel:01065663606` and a copy-to-clipboard fallback.

- [ ] **Step 4: Add success and failure tests**

Mock `fetch` to return `{ success: true }` and `{ success: false, message: "전송 실패" }`. Assert the sending label, error status, phone fallback, and no duplicate request while status is `sending`.

- [ ] **Step 5: Run tests and commit**

```powershell
pnpm test:landing -- tests/landing/quick-estimate-form.test.tsx
git add company-site/app/landing/QuickEstimateForm.tsx company-site/tests/landing/quick-estimate-form.test.tsx
git commit -m "feat: add compact cleaning quote form"
```

Expected: all quote-form tests pass.

## Task 4: Build the shared landing-page presentation

**Files:**
- Create: `company-site/app/landing/LandingPage.tsx`
- Create: `company-site/app/landing/landing.css`
- Test: `company-site/tests/rendered-html.test.mjs`

- [ ] **Step 1: Add a failing built-page assertion for required sections**

Add a temporary test that requests `/stair-cleaning` and expects:

```js
assert.match(html, /깨끗하게만 하지 않습니다/);
assert.match(html, /월 4회 6만원부터/);
assert.match(html, /청소하면서 건물까지 봅니다/);
assert.match(html, /30초 간편 견적/);
assert.match(html, /tel:01065663606/);
```

Run `pnpm test` and expect FAIL with a 404 or missing content.

- [ ] **Step 2: Implement the shared semantic layout**

`LandingPage.tsx` accepts `service: LandingService` and renders, in order:

```tsx
<main className={`landing-page landing-${service.slug}`}>
  <header className="landing-header" />
  <section className="landing-hero" />
  <section className="landing-facts" />
  <section className="landing-scope" />
  <section className="landing-records" />
  <section className="landing-difference" />
  <section className="landing-price" />
  <section className="landing-process" />
  <section className="landing-faq" />
  <section className="landing-estimate" id="quick-estimate" />
  <footer className="landing-footer" />
  <nav className="mobile-sticky-actions" aria-label="빠른 상담" />
</main>
```

Use real service content from `services.ts`, map all scope, record, process, and FAQ items, link each record to its Naver Blog source, and render `<QuickEstimateForm>` with the service name and source path.

- [ ] **Step 3: Implement responsive CSS**

`landing.css` must:

- reuse `--blue`, `--navy`, `--lime`, `--ink`, and existing typography;
- keep content at `max-width: 1440px`;
- use a two-column desktop hero and one-column mobile hero;
- use four-column fact and scope grids on desktop, two columns on tablet, one or two columns on mobile as space allows;
- preserve image aspect ratio with `object-fit: cover`;
- show mobile sticky actions only below `760px`;
- add bottom body/page padding so sticky actions never cover form controls;
- provide visible `:focus-visible` states;
- respect `prefers-reduced-motion`.

- [ ] **Step 4: Commit the shared layout**

```powershell
git add company-site/app/landing/LandingPage.tsx company-site/app/landing/landing.css company-site/tests/rendered-html.test.mjs
git commit -m "feat: build shared cleaning landing page layout"
```

Do not run the built-route test to green until Task 5 creates the route.

## Task 5: Add all three routes and metadata

**Files:**
- Create: `company-site/app/stair-cleaning/page.tsx`
- Create: `company-site/app/building-care/page.tsx`
- Create: `company-site/app/move-in-cleaning/page.tsx`
- Modify: `company-site/tests/rendered-html.test.mjs`

- [ ] **Step 1: Create the stair-cleaning route**

```tsx
import type { Metadata } from "next";
import LandingPage from "../landing/LandingPage";
import { landingServices } from "../landing/services";

const service = landingServices["stair-cleaning"];

export const metadata: Metadata = {
  title: service.metaTitle,
  description: service.metaDescription,
  alternates: { canonical: "/stair-cleaning" },
  openGraph: { title: service.metaTitle, description: service.metaDescription, images: [] },
  twitter: { card: "summary", title: service.metaTitle, description: service.metaDescription, images: [] },
};

export default function StairCleaningPage() {
  return <LandingPage service={service} />;
}
```

- [ ] **Step 2: Create the building-care and move-in-cleaning routes**

Repeat the complete route module above with the respective key and canonical path. Do not duplicate content outside `services.ts`.

- [ ] **Step 3: Add parameterized built-route tests**

Add to `rendered-html.test.mjs`:

```js
for (const [pathname, heading, price] of [
  ["/stair-cleaning", "깨끗하게만 하지 않습니다", "월 4회 6만원부터"],
  ["/building-care", "멀리 있어도", "월 8.9만원"],
  ["/move-in-cleaning", "새 공간의 첫날", "10만원부터"],
]) {
  test(`server-renders ${pathname}`, async () => {
    const response = await render(pathname);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, new RegExp(heading));
    assert.match(html, new RegExp(price));
    assert.match(html, /tel:01065663606/);
    assert.match(html, /quick-estimate/);
    assert.doesNotMatch(html, /1위|100% 만족|최우수/);
  });
}
```

- [ ] **Step 4: Run focused and built-route tests**

```powershell
pnpm test:landing
pnpm test
```

Expected: all landing tests and existing rendered HTML tests pass.

- [ ] **Step 5: Commit**

```powershell
git add company-site/app/stair-cleaning company-site/app/building-care company-site/app/move-in-cleaning company-site/tests/rendered-html.test.mjs
git commit -m "feat: add three Naver ad landing routes"
```

## Task 6: Preview, accessibility review, and regression validation

**Files:**
- Modify only if validation finds a defect in the files created above.

- [ ] **Step 1: Install dependencies and start the existing development flow**

```powershell
cd company-site
pnpm install --frozen-lockfile
pnpm dev
```

Expected: Vinext prints a local URL and the existing homepage compiles.

- [ ] **Step 2: Open the first meaningful preview**

Open `/stair-cleaning` only after it renders without a blocking error. Confirm the first viewport contains service name, headline, price, real photo, phone, and quote CTA.

- [ ] **Step 3: Inspect all three pages at desktop and mobile widths**

Check:

- 1440×900 desktop
- 390×844 mobile
- no horizontal scrolling;
- no sticky-button overlap;
- readable price condition;
- visible form labels and consent;
- correct field photos and source links;
- keyboard focus on navigation, FAQ, source links, and form controls.

- [ ] **Step 4: Run the complete automated validation**

```powershell
pnpm test:landing
pnpm test
pnpm lint
pnpm build
pnpm export:firebase
```

Expected: all commands exit 0. The Firebase export contains the three route directories with `index.html` files.

- [ ] **Step 5: Verify the exported routes**

```powershell
Get-Item firebase-public\stair-cleaning\index.html
Get-Item firebase-public\building-care\index.html
Get-Item firebase-public\move-in-cleaning\index.html
Select-String -Path firebase-public\stair-cleaning\index.html -Pattern '월 4회 6만원부터'
Select-String -Path firebase-public\building-care\index.html -Pattern '월 8.9만원'
Select-String -Path firebase-public\move-in-cleaning\index.html -Pattern '10만원부터'
```

Expected: all files exist and contain the service-specific price.

- [ ] **Step 6: Commit validation fixes**

```powershell
git status --short
git add company-site
git commit -m "test: validate cleaning landing page release"
```

Skip the commit if validation required no source changes.

## Task 7: Publish and verify production links

**Files:**
- No source changes unless the hosting build reveals a production-only defect.

- [ ] **Step 1: Publish through the configured Sites project**

Use the `sites-hosting` workflow for `company-site/.openai/hosting.json` after the validated build.

Expected: a new Sites version is saved and deployed successfully.

- [ ] **Step 2: Export and deploy the same validated build to Firebase**

Use the existing Firebase project configuration and deployment procedure for `bring-fm.web.app`. Do not create a new Firebase project.

Expected production URLs:

- `https://bring-fm.web.app/stair-cleaning`
- `https://bring-fm.web.app/building-care`
- `https://bring-fm.web.app/move-in-cleaning`

- [ ] **Step 3: Production smoke test**

For each URL, verify HTTP success, service-specific headline and price, telephone link, quote form, blog source links, and mobile sticky actions. Do not submit a live test lead unless it is clearly labeled as a test and immediately communicated to the operator.

- [ ] **Step 4: Record the final deployment commit**

```powershell
git status --short --branch
git log -6 --oneline
```

Expected: clean feature branch with the design, implementation, tests, and validation commits.

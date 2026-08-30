# BRING CARE 건물관리 시각 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/building-care`에 공식 인증, 서비스 아이콘, 관리 비교표, 관리비 범위표, 실제 관리기록과 운영 기준 도식을 추가해 글보다 시각으로 먼저 이해되는 광고 랜딩을 완성한다.

**Architecture:** 기존 `BuildingCareLanding`의 14개 최상위 섹션과 CRM 흐름을 유지하고, 시각 블록을 전용 데이터와 작은 컴포넌트로 분리한다. 공식 인증 원본은 공개용 썸네일로 가공해 식별정보를 읽기 어렵게 만들고, 활성 인증 3건만 광고 배지로 사용한다.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS, Vitest, Testing Library, Firebase Hosting

---

## File Structure

- Create: `company-site/app/landing/BuildingCareVisualBlocks.tsx` — 인증·아이콘·비교표·관리 도식 렌더링
- Create: `company-site/app/landing/buildingCareVisualData.ts` — 시각 블록 데이터와 활성 인증 메타데이터
- Modify: `company-site/app/landing/BuildingCareLanding.tsx` — 기존 14개 섹션 내부에 시각 블록 배치
- Modify: `company-site/app/landing/building-care-sales.css` — 카드·표·아이콘·모바일 스타일
- Create: `company-site/public/landing/certifications/*.webp` — 공개용 인증서 썸네일 3장
- Modify: `company-site/tests/landing/building-care-sales.test.tsx` — 시각 블록·연락 경로 회귀 검사
- Create: `company-site/tests/landing/building-care-visual-data.test.ts` — 인증·표 데이터 사실성 검사

### Task 1: 공식 인증과 시각 데이터 계약

- [ ] **Step 1: 실패하는 데이터 테스트 작성**

`building-care-visual-data.test.ts`에서 다음을 검사한다.

```ts
expect(activeCertifications.map((item) => item.id)).toEqual(["rnd", "venture", "startup"]);
expect(serviceVisuals).toHaveLength(6);
expect(directVsBringRows).toHaveLength(6);
expect(managementScopeRows.every((row) => row.included !== row.separate)).toBe(true);
expect(managementCycle.map((item) => item.title)).toEqual(["확인", "조율", "처리", "보고"]);
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run tests/landing/building-care-visual-data.test.ts`

Expected: `buildingCareVisualData` 모듈을 찾지 못해 FAIL.

- [ ] **Step 3: 데이터 파일 구현**

`buildingCareVisualData.ts`에 다음을 정의한다.

```ts
export const activeCertifications = [
  { id: "rnd", title: "연구개발전담부서", issuer: "과학기술정보통신부 · 한국산업기술진흥협회", image: "/landing/certifications/rnd-department.webp" },
  { id: "venture", title: "벤처기업 확인", issuer: "벤처기업확인기관", validUntil: "2027.10.20", image: "/landing/certifications/venture.webp" },
  { id: "startup", title: "창업기업 확인", issuer: "강원지방중소벤처기업청", validUntil: "2028.09.24", image: "/landing/certifications/startup.webp" },
] as const;
```

서비스 6종, 비교행 6개, 포함·별도 범위, 관리주기 4단계도 같은 파일에 정의한다. 중소기업 확인서는 만료됐으므로 배열에 넣지 않는다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run tests/landing/building-care-visual-data.test.ts`

Expected: PASS.

- [ ] **Step 5: 커밋**

```powershell
git add company-site/app/landing/buildingCareVisualData.ts company-site/tests/landing/building-care-visual-data.test.ts
git commit -m "feat: define building care visual proof data"
```

### Task 2: 인증서 공개용 썸네일

- [ ] **Step 1: 원본 3장 존재 확인**

Run: `Get-Item C:/Users/user/AppData/Local/Temp/codex-clipboard-dbdb8484-68f7-4fcb-a4c1-6e26562d7ed9.png, C:/Users/user/AppData/Local/Temp/codex-clipboard-f170128b-53c8-4574-a5cd-7cfe0b9dcb51.png, C:/Users/user/AppData/Local/Temp/codex-clipboard-dbd31b0e-38c3-4b03-a9f7-9b65359dbf3b.png`

Expected: 세 파일 모두 존재.

- [ ] **Step 2: 공개용 WebP 생성**

Sharp를 사용해 폭 640px WebP로 변환하고, 사업자번호·상세주소·발급번호가 읽히지 않도록 해당 영역에 가우시안 블러 또는 불투명 마스크를 적용한다. 인증명·발급기관·유효기간은 유지한다.

Expected: `company-site/public/landing/certifications/` 아래 3장 생성.

- [ ] **Step 3: 이미지 육안 검사**

세 이미지를 렌더링해 인증명은 읽히고 식별정보는 읽히지 않는지 확인한다.

- [ ] **Step 4: 커밋**

```powershell
git add company-site/public/landing/certifications
git commit -m "feat: add privacy-safe company certification assets"
```

### Task 3: 시각 블록 컴포넌트와 페이지 배치

- [ ] **Step 1: 실패하는 렌더링 테스트 확장**

`building-care-sales.test.tsx`에 다음 선택자를 추가한다.

```ts
expect(container.querySelectorAll(".bc-cert-card")).toHaveLength(3);
expect(container.querySelectorAll(".bc-service-visual")).toHaveLength(6);
expect(container.querySelector(".bc-management-comparison")).toBeInTheDocument();
expect(container.querySelector(".bc-scope-table")).toBeInTheDocument();
expect(container.querySelectorAll(".bc-cycle-step")).toHaveLength(4);
expect(screen.getByText(/별도 비용이 필요한 작업은/)).toBeInTheDocument();
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run tests/landing/building-care-sales.test.tsx`

Expected: 새 선택자를 찾지 못해 FAIL.

- [ ] **Step 3: 작은 시각 컴포넌트 구현**

`BuildingCareVisualBlocks.tsx`에 다음 named export를 만든다.

```ts
export function CertificationStrip() {}
export function ServiceVisualMenu() {}
export function ManagementComparison() {}
export function ManagementCycle() {}
export function ManagementScopeTable() {}
export function OperatingStandardComparison() {}
```

모든 컴포넌트는 `buildingCareVisualData.ts`만 읽고 외부 상태를 가지지 않는다. 인증 썸네일은 버튼이나 링크로 확대 가능한 `<details>` 또는 접근 가능한 대화상자 트리거를 제공한다.

- [ ] **Step 4: 기존 14개 섹션 내부에 배치**

- `building-care-hero`: `CertificationStrip`
- `owner-problem`: `ServiceVisualMenu`
- `one-contact`: `ManagementComparison`
- `care-system`: `ManagementCycle`
- `building-care-price`: `ManagementScopeTable`
- `trust-operations`: `OperatingStandardComparison`

최상위 `main > section` 개수와 순서는 변경하지 않는다.

- [ ] **Step 5: 렌더링 테스트 통과 확인**

Run: `pnpm vitest run tests/landing/building-care-sales.test.tsx`

Expected: PASS.

- [ ] **Step 6: 커밋**

```powershell
git add company-site/app/landing/BuildingCareVisualBlocks.tsx company-site/app/landing/BuildingCareLanding.tsx company-site/tests/landing/building-care-sales.test.tsx
git commit -m "feat: add visual comparison blocks to building care landing"
```

### Task 4: 전환형 스타일과 반응형 검증

- [ ] **Step 1: 데스크톱 스타일 구현**

`building-care-sales.css`에 다음 스타일 그룹을 추가한다.

- `.bc-cert-grid`: 3열 인증 카드와 썸네일
- `.bc-service-visual-grid`: 6열 아이콘 카드
- `.bc-management-comparison`: 3열 헤더와 행 비교
- `.bc-cycle-grid`: 실제 사진·번호·연결선이 있는 4단계
- `.bc-scope-table`: 기본 포함과 별도 실비 2열
- `.bc-standard-stack`: 일반 관리 카드 뒤, BRING 카드 앞의 겹침 구조

- [ ] **Step 2: 모바일 스타일 구현**

620px 이하에서 인증·서비스는 2열, 비교표는 행별 카드, 관리주기는 1열, 범위표는 세로형으로 바꾼다. 가로 스크롤은 만들지 않는다.

- [ ] **Step 3: 전체 랜딩 테스트와 빌드**

Run:

```powershell
pnpm run test:landing
pnpm run build
pnpm run export:firebase
```

Expected: 랜딩 테스트 전체 PASS, 빌드와 정적 내보내기 exit 0.

- [ ] **Step 4: Firebase Hosting 배포**

Run:

```powershell
pnpm exec firebase deploy --config ../firebase.json --project bring-fm --only hosting:bring-fm --non-interactive
```

Expected: `https://bring-fm.web.app/building-care` 배포 성공.

- [ ] **Step 5: 공개 페이지 검증**

- `/building-care` 200 응답
- 인증 카드 3개
- 비교표·범위표·관리도식 존재
- 실제 관리기록 이미지 5장 이상
- CRM 폼, 전화, 카카오 링크 유지
- `/turnover-care`, `/stair-cleaning`, `/move-in-cleaning` 200 응답

- [ ] **Step 6: 최종 커밋과 푸시**

```powershell
git add company-site/app/landing/building-care-sales.css company-site/firebase-public
git commit -m "feat: finish building care visual conversion"
git push
```

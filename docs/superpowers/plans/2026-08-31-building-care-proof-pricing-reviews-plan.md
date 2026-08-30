# BRING CARE 건물관리 신뢰·가격·후기 개편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 건물관리 기본요금과 방문 주기를 정확히 분리하고, 공식 기업 인증·수상 이력을 상단 신뢰 근거로 재구성하며, 검증된 고객 후기만 노출되는 안전한 구조를 완성해 Firebase에 배포한다.

**Architecture:** 기존 `BuildingCareLanding`의 흐름과 브랜드 비주얼은 유지하되 신뢰·가격·후기 UI를 독립 컴포넌트로 분리한다. 인증·수상 데이터는 정적 타입 데이터로 관리하고 원본 이미지는 최적화된 WebP로 제공한다. 후기는 검증 데이터가 없으면 섹션 자체를 렌더링하지 않아 허위 사회적 증거가 노출되지 않게 한다.

**Tech Stack:** Next.js, React, TypeScript, CSS, Vitest, Testing Library, Sharp, Firebase Hosting

---

## Task 1: 인증·수상 이미지 자산 준비

**Files:**
- Create: `company-site/public/landing/credentials/awards/solverthon-excellence.webp`
- Create: `company-site/public/landing/credentials/awards/solverthon-impact.webp`
- Create: `company-site/public/landing/credentials/awards/prestartup-excellent-founder.webp`
- Create: `company-site/public/landing/credentials/awards/knu-innovation-league.webp`
- Create: `company-site/public/landing/credentials/awards/gangwon-bi-cooperation.webp`
- Create: `company-site/public/landing/credentials/awards/wonju-founder-accelerator.webp`
- Create: `company-site/public/landing/certifications/small-business.webp`

- [ ] 원본 6개 상장·수료증을 Sharp로 긴 변 1,600px 이내 WebP 품질 82로 변환한다.
- [ ] 중소기업 확인서 PDF 첫 페이지를 렌더링하고 웹 공개에 불필요한 개인정보가 보이지 않도록 확인한 뒤 WebP로 저장한다.
- [ ] 모든 파일이 정상 디코딩되고 폭·높이·용량이 합리적인지 확인한다.

Commands:

```powershell
New-Item -ItemType Directory -Force company-site/public/landing/credentials/awards | Out-Null
New-Item -ItemType Directory -Force company-site/public/landing/certifications | Out-Null
pnpm --dir company-site exec node scripts/prepare-building-care-credentials.mjs
```

Expected: 7개 WebP 파일이 생성되고 각 파일 크기가 1.5MB 미만이다.

## Task 2: 신뢰 데이터와 인증·수상 컴포넌트 테스트 작성

**Files:**
- Create: `company-site/app/landing/buildingCareTrustData.ts`
- Create: `company-site/app/landing/BuildingCareCredentials.tsx`
- Create: `company-site/tests/landing/building-care-trust.test.tsx`
- Modify: `company-site/app/landing/building-care-sales.css`

- [ ] 실패하는 테스트에 공식 인증 4개와 수상·교육 6개가 서로 다른 그룹으로 표시되는지 작성한다.
- [ ] `건물관리 인증`, `품질 보장`처럼 인증 범위를 과장하는 문구가 없는지 테스트한다.
- [ ] 카드 클릭 시 원본 확대 대화상자가 열리고 닫히는지 접근성 역할 기반으로 테스트한다.
- [ ] 테스트를 실행해 RED 상태를 확인한다.

```powershell
pnpm --dir company-site vitest run tests/landing/building-care-trust.test.tsx
```

Expected: 새 컴포넌트가 없어 실패한다.

- [ ] `TrustItem` 타입과 인증·수상 데이터를 작성한다.
- [ ] 제목은 `현장을 관리하고, 더 나은 방식을 연구합니다.`로 구현한다.
- [ ] 연구개발전담부서·벤처기업·창업기업·중소기업 확인을 공식 기업 인증으로 묶는다.
- [ ] 솔버톤 우수상·임팩트상·우수청년창업가상·혁신창업리그 우수상·협력가치상·창업가 양성 과정 수료를 수상·교육 이력으로 묶는다.
- [ ] 카드 선택 시 `<dialog>` 기반 확대 보기를 제공하고 ESC·닫기 버튼을 지원한다.
- [ ] Toss 계열의 흰 카드, 얕은 테두리, 부드러운 그림자, 큰 제목을 적용한다.
- [ ] 테스트를 다시 실행해 GREEN을 확인한다.

Expected: 관련 테스트 전부 통과.

## Task 3: 가격·방문 주기 완전 분리

**Files:**
- Create: `company-site/app/landing/BuildingCarePricingGrid.tsx`
- Create: `company-site/tests/landing/building-care-pricing.test.tsx`
- Modify: `company-site/app/landing/BuildingCareLanding.tsx`
- Modify: `company-site/app/landing/buildingCareData.ts`
- Modify: `company-site/app/landing/building-care-sales.css`
- Modify: `company-site/tests/landing/building-care-sales.test.tsx`

- [ ] 정확한 값에 대한 실패 테스트를 먼저 작성한다.

Required assertions:

```tsx
expect(screen.getByText("월 69,000원부터")).toBeInTheDocument();
expect(screen.getByText("주 2회 정기 방문")).toBeInTheDocument();
expect(screen.getByText("월 4회 정기청소")).toBeInTheDocument();
expect(screen.getByText("3층 60,000원")).toBeInTheDocument();
expect(screen.getByText("4층 70,000원")).toBeInTheDocument();
expect(screen.getByText("5층 80,000원")).toBeInTheDocument();
expect(screen.queryByText("월 89,000원부터")).not.toBeInTheDocument();
```

- [ ] 테스트를 실행해 기존 89,000원 때문에 실패하는 것을 확인한다.
- [ ] 4개 상품 카드로 가격 UI를 구현한다.
  - 기본 건물관리: 월 69,000원부터, 주 2회 정기 방문
  - 계단·공용부 청소: 월 4회, 3층 60,000원 / 4층 70,000원 / 5층 80,000원
  - 관리 건물 입·퇴실 청소: 100,000원부터 / 일반 청소 120,000원부터
  - 전문 작업 조율: 승인 작업금액의 5%
- [ ] 모든 금액에 `부가세 별도`를 명시하고 관리비와 청소비가 별도임을 한 문장으로 정리한다.
- [ ] 히어로·FAQ·월간보고 예시의 89,000원과 `4회 완료`를 각각 69,000원과 `주 2회 방문`으로 정정한다.
- [ ] 가격 및 기존 랜딩 테스트를 모두 통과시킨다.

## Task 4: 검증 후기 안전 컴포넌트

**Files:**
- Create: `company-site/app/landing/BuildingCareTestimonials.tsx`
- Create: `company-site/tests/landing/building-care-testimonials.test.tsx`
- Modify: `company-site/app/landing/BuildingCareLanding.tsx`
- Modify: `company-site/app/landing/building-care-sales.css`

- [ ] `verifiedTestimonials`가 비어 있으면 아무것도 렌더링하지 않는 테스트를 작성한다.
- [ ] 향후 실후기 원본이 들어오면 고객 유형·후기·현장 사진·태그를 카드로 출력하는 타입 구조를 만든다.
- [ ] 실제 후기 원본이 없는 현재 상태에서는 별점 4.9, 가상 고객명, 가상 후기 문구를 출력하지 않는다.
- [ ] 실적 섹션 다음에 컴포넌트를 연결하고 테스트를 통과시킨다.

## Task 5: 페이지 순서 통합 및 중복 인증 제거

**Files:**
- Modify: `company-site/app/landing/BuildingCareLanding.tsx`
- Modify: `company-site/app/landing/BuildingCareVisualBlocks.tsx`
- Modify: `company-site/tests/landing/building-care-sales.test.tsx`

- [ ] 새 인증·수상 섹션을 상단 브랜드 팀 소개 직후 배치한다.
- [ ] 기존 하단 `CertificationStrip`을 제거해 같은 인증이 중복 노출되지 않게 한다.
- [ ] 상단 신뢰 바로가기 링크가 새 섹션 `#company-credentials`를 가리키게 한다.
- [ ] 페이지 순서 테스트를 새 흐름에 맞춰 갱신한다.
- [ ] 전체 텍스트에서 `우리는`이 남지 않고 `저희는`으로 정리됐는지 테스트한다.

## Task 6: 전체 검증·시각 QA·배포

**Files:**
- Modify: `company-site/out/**` generated export
- Modify: `firebase-public/**` generated Firebase public output

- [ ] 랜딩 테스트 전체를 실행한다.

```powershell
pnpm --dir company-site run test:landing
```

Expected: 모든 랜딩 테스트 통과.

- [ ] 프로덕션 빌드를 실행한다.

```powershell
pnpm --dir company-site run build
```

Expected: Next.js build 성공, TypeScript 오류 없음.

- [ ] 로컬 서버에서 1440×1000과 390×844 화면을 확인한다.
- [ ] 인증·수상 확대 보기, 가격 분리, CTA, 가로 스크롤, 콘솔 오류를 확인한다.
- [ ] Firebase용 정적 파일을 생성하고 배포한다.

```powershell
pnpm --dir company-site run export:firebase
.\company-site\node_modules\.bin\firebase.cmd deploy --only hosting:bring-fm
```

Expected: Hosting deploy complete.

- [ ] 배포 URL에서 최종 확인한다.

```text
https://bring-fm.web.app/building-care?version=proof-pricing-20260831-final
```

- [ ] 관련 파일만 커밋하고 원격 브랜치에 푸시한다. 기존 미추적 `assets/`, `tmp/`는 포함하지 않는다.

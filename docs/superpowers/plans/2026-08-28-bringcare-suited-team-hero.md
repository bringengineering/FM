# 브링케어 정장 단체사진 히어로 교체 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈페이지 첫 화면의 기존 AI 팀 이미지를 전원 정장을 입은 8~10명 건물 앞 단체사진으로 교체한다.

**Architecture:** 이미지 생성은 프로젝트 코드와 분리해 새 버전 파일로 저장하고, 홈페이지는 해당 파일 경로만 참조한다. 기존 문구·상담 동선·캠페인 이미지 고지는 유지하며 데스크톱과 모바일에서 팀 전체가 최대한 보이도록 `object-position`을 검수한다.

**Tech Stack:** built-in image generation, Next.js/Vinext, CSS, Node test runner, Vitest, Firebase Hosting

---

### Task 1: 정장 단체사진 생성 및 실사 검수

**Files:**
- Create: `company-site/public/brand-campaign/bringcare-suited-team-building-v2.png`

- [ ] **Step 1: 가로형 단체사진 생성**

Built-in image generation에 다음 프롬프트를 사용한다.

```text
Use case: ads-marketing
Asset type: BRING CARE website homepage hero photograph
Primary request: Create a genuinely photorealistic formal company group photograph of exactly 9 Korean adults standing together in front of a realistic small Korean multi-family building. Every person wears a complete black or very dark navy business suit; no workwear and no casual clothing. This is a posed official team photograph, not a cleaning action scene.
Subject: Korean men and women from late 20s to early 50s with varied natural faces, heights, body types, hairstyles, suit fits, and restrained expressions. Everyone faces the camera. Two people naturally hold clean professional cleaning tools and one person holds a tablet so the company reads as building management and cleaning, while the others stand comfortably with hands visible.
Composition/framing: 3:2 horizontal photograph, full team visible from head to at least knee, building entrance clearly visible, balanced but not perfectly symmetrical, enough breathing room around the outer people, suitable for cropping into the right half of a website hero.
Lighting/mood: soft overcast daylight, low contrast, gentle natural color, quiet trustworthy Korean small-company atmosphere.
Style/medium: real 35mm documentary corporate photography, mild film grain, realistic skin texture, flyaway hair, natural clothing wrinkles and imperfect posture.
Constraints: exactly 9 adults; all wear formal suits; no active cleaning; no generated text, logo, watermark or signage; hands and tools must be anatomically correct.
Avoid: glossy AI advertising look, plastic skin, repeated faces, identical smiles, perfect teeth, fashion-model posing, exaggerated bokeh, HDR, cinematic teal-orange grading, overly sharp edges, distorted hands, duplicated people.
```

- [ ] **Step 2: 시각 검수**

`view_image`로 생성 결과를 확인하고 아래를 모두 충족하는지 검사한다.

```text
- 정확히 9명
- 전원 검정 또는 짙은 네이비 정장
- 건물 앞 단체사진이며 청소 동작 없음
- 일부만 청소도구·태블릿 소지
- 반복 얼굴, 손가락 오류, 글자 생성 없음
- 부드러운 자연광과 낮은 대비
```

- [ ] **Step 3: 프로젝트에 버전 파일로 복사**

기존 이미지를 덮어쓰지 않고 최종 결과를 다음 경로에 저장한다.

```text
company-site/public/brand-campaign/bringcare-suited-team-building-v2.png
```

- [ ] **Step 4: 이미지 자산 커밋**

```powershell
git add company-site/public/brand-campaign/bringcare-suited-team-building-v2.png
git commit -m "assets: add suited Bring Care team hero"
```

### Task 2: 홈페이지 계약 테스트와 이미지 교체

**Files:**
- Modify: `company-site/tests/rendered-html.test.mjs`
- Modify: `company-site/app/page.tsx`
- Modify if visual QA requires it: `company-site/app/globals.css`

- [ ] **Step 1: 새 이미지 경로를 요구하는 테스트 작성**

홈페이지 테스트의 이미지 검사를 다음처럼 변경한다.

```js
assert.match(html, /bringcare-suited-team-building-v2\.png/);
assert.match(html, /브링케어 브랜드 캠페인 이미지/);
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```powershell
cd company-site
node --test --test-name-pattern="server-renders the Bring Care company website" tests/rendered-html.test.mjs
```

Expected: 기존 `bringcare-team-building-v1.png` 때문에 FAIL.

- [ ] **Step 3: 홈페이지 이미지 경로와 대체텍스트 변경**

`company-site/app/page.tsx`의 히어로 이미지를 다음으로 변경한다.

```tsx
<img
  src="/brand-campaign/bringcare-suited-team-building-v2.png"
  alt="정장을 입은 브링케어 건물관리팀을 표현한 건물 앞 브랜드 캠페인 단체사진"
/>
```

- [ ] **Step 4: 홈페이지 계약 테스트 통과 확인**

```powershell
node --test --test-name-pattern="server-renders the Bring Care company website" tests/rendered-html.test.mjs
```

Expected: 1 test passed.

- [ ] **Step 5: 소스 변경 커밋**

```powershell
git add company-site/app/page.tsx company-site/app/globals.css company-site/tests/rendered-html.test.mjs
git commit -m "feat: use suited team group photo in hero"
```

### Task 3: 빌드·반응형 검수·배포

**Files:**
- Modify: `company-site/firebase-public/**`

- [ ] **Step 1: 빌드와 랜딩 회귀검사 실행**

```powershell
cd company-site
pnpm run build
node --test --test-name-pattern="server-renders the Bring Care company website" tests/rendered-html.test.mjs
pnpm vitest run tests/landing
```

Expected: build exit 0, homepage 1 test passed, landing 61 tests passed.

- [ ] **Step 2: Firebase 정적 파일 생성**

```powershell
pnpm run export:firebase
```

Expected: `company-site/firebase-public` 생성 완료.

- [ ] **Step 3: 데스크톱과 모바일 시각 검수**

Firebase 로컬 호스팅 화면을 1280×720과 390×844에서 확인한다.

```text
- 제목과 단체사진이 첫 화면에서 함께 보임
- 가로 넘침 없음
- 모바일에서 팀 사진이 지나치게 잘리지 않음
- 캠페인 이미지 고지 노출
- 상담 신청 버튼 노출
```

- [ ] **Step 4: Firebase Hosting 배포**

```powershell
.\company-site\node_modules\.bin\firebase.cmd deploy --only hosting --project bring-fm
```

Expected: `Hosting URL: https://bring-fm.web.app`.

- [ ] **Step 5: 공개 주소 검증**

```powershell
$html=(Invoke-WebRequest -UseBasicParsing 'https://bring-fm.web.app/?version=suited-team-20260828').Content
@('bringcare-suited-team-building-v2.png','건물을 관리하며','브링케어 브랜드 캠페인 이미지') | ForEach-Object { if (-not $html.Contains($_)) { throw "Missing marker: $_" } }
```

Expected: exit 0.

- [ ] **Step 6: 배포본 커밋과 원격 반영**

```powershell
git add company-site/firebase-public
git commit -m "chore: export suited team hero"
git push upstream codex/bringcare-cleaning-landings
```


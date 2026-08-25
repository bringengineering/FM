# 브링케어 에어컨 배수·배관 문제 벽지 현장 BEFORE 글 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자 제공 실제 현장사진 3장으로 에어컨 배수·배관 문제와 도배 전 벽지 상태를 기록한 2부작 1편을 검증하고 네이버 공개 직전까지 준비한다.

**Architecture:** 사진 원본은 날짜별 자산 폴더에 보존하고, 사실·역할 경계는 YAML 브리프에 고정한다. 발행 본문은 현장 장면과 판단을 중심으로 작성한 뒤 기존 검증기와 실제 네이버 편집 화면에서 별도로 검수한다.

**Tech Stack:** Markdown, YAML, Python 검증기, 네이버 스마트에디터 ONE, 브라우저 제어

---

## 파일 구조

- Create: `blog/assets/2026-08-25-aircon-drain-wallpaper-before/01-before-ceiling-aircon.jpg` — 천장 모서리와 에어컨 주변 BEFORE 사진
- Create: `blog/assets/2026-08-25-aircon-drain-wallpaper-before/02-before-wall-damage.jpg` — 벽지 박리·곰팡이 범위 BEFORE 사진
- Create: `blog/assets/2026-08-25-aircon-drain-wallpaper-before/03-before-room-wide.jpg` — 공간 전체 범위 BEFORE 사진
- Create: `blog/assets/2026-08-25-aircon-drain-wallpaper-before/consultation-banner.png` — 승인된 상담 배너 복사본
- Create: `blog/2026-08-25-aircon-drain-wallpaper-before-brief.yaml` — 사실·사진·역할·미확인 항목 원장
- Create: `blog/2026-08-25-aircon-drain-wallpaper-before.md` — 네이버 발행용 최종 원고
- Modify: `blog/automation/backlog.md` — 1편 준비 상태와 2편 애프터 촬영 항목 기록
- Modify after publish: `blog/automation/performance-ledger.csv` — 공개 URL과 회고 시점 등록

### Task 1: 현장사진 자산 보존

**Files:**
- Create: `blog/assets/2026-08-25-aircon-drain-wallpaper-before/01-before-ceiling-aircon.jpg`
- Create: `blog/assets/2026-08-25-aircon-drain-wallpaper-before/02-before-wall-damage.jpg`
- Create: `blog/assets/2026-08-25-aircon-drain-wallpaper-before/03-before-room-wide.jpg`
- Create: `blog/assets/2026-08-25-aircon-drain-wallpaper-before/consultation-banner.png`

- [ ] **Step 1: 자산 폴더를 만들고 사용자 사진 세 장을 설명 순서대로 복사한다**

Run:

```powershell
New-Item -ItemType Directory -Force "blog/assets/2026-08-25-aircon-drain-wallpaper-before"
Copy-Item -LiteralPath "C:/Users/user/AppData/Local/Temp/codex-clipboard-d1db748c-d1d5-417d-8b0f-7662ae809cc2.jpg" -Destination "blog/assets/2026-08-25-aircon-drain-wallpaper-before/01-before-ceiling-aircon.jpg"
Copy-Item -LiteralPath "C:/Users/user/AppData/Local/Temp/codex-clipboard-7d9161b5-e66c-492c-8ee6-1bec1ab15098.jpg" -Destination "blog/assets/2026-08-25-aircon-drain-wallpaper-before/02-before-wall-damage.jpg"
Copy-Item -LiteralPath "C:/Users/user/AppData/Local/Temp/codex-clipboard-da2c4604-d460-41a8-bc6e-346b145d46f1.jpg" -Destination "blog/assets/2026-08-25-aircon-drain-wallpaper-before/03-before-room-wide.jpg"
Copy-Item -LiteralPath "C:/Users/user/.codex/skills/writing-bringcare-naver-blog/assets/consultation-banner.png" -Destination "blog/assets/2026-08-25-aircon-drain-wallpaper-before/consultation-banner.png"
```

Expected: 네 파일이 존재하고 세 현장사진의 해상도와 파일 크기가 0보다 크다.

- [ ] **Step 2: 각 로컬 이미지를 직접 열어 개인정보와 보이는 사실을 다시 확인한다**

Expected: 상세 주소·호실·얼굴·차량번호가 없고, 곰팡이·변색·벽지 박리·천장 모서리 흔적만 기록한다.

- [ ] **Step 3: 자산만 커밋한다**

```powershell
git add -- "blog/assets/2026-08-25-aircon-drain-wallpaper-before"
git commit -m "assets: add wallpaper damage before photos"
```

### Task 2: 검증 가능한 현장 브리프 작성

**Files:**
- Create: `blog/2026-08-25-aircon-drain-wallpaper-before-brief.yaml`

- [ ] **Step 1: 브리프에 사실과 역할 경계를 기록한다**

Required values:

```yaml
request_mode: 현장사진작성
distribution_goal: 혼합
content_role:
  primary: 증거
  secondary: 신뢰
post_type: 현장사례
content_engine: brand_field
topic: 에어컨 배수·배관 문제로 인한 벽지 곰팡이와 박리 작업 전 기록
primary_keyword: 벽지 곰팡이
one_cta: 카카오채널
source_date: "2026-08-25"
cost_time_publishable: false
```

`verified_facts`에는 오늘 현장 방문, 에어컨 배수·배관 문제 확인, 벽지 곰팡이·박리 발생, 도배업체 작업 예정, 작업 후 재방문 촬영 예정만 넣는다. `work_scope.unverified`에는 세부 배관 부위, 비용, 기간, 자재, 완료 결과를 넣는다.

- [ ] **Step 2: 브리프 검증기를 실행한다**

Run:

```powershell
python "C:/Users/user/.codex/skills/writing-bringcare-naver-blog/scripts/validate_brief.py" "blog/2026-08-25-aircon-drain-wallpaper-before-brief.yaml"
```

Expected: `작성승인`, 오류 0건. 실패하면 원인을 수정하고 다시 실행한다.

- [ ] **Step 3: 브리프를 커밋한다**

```powershell
git add -- "blog/2026-08-25-aircon-drain-wallpaper-before-brief.yaml"
git commit -m "docs: verify wallpaper before field brief"
```

### Task 3: 2부작 1편 원고 작성

**Files:**
- Create: `blog/2026-08-25-aircon-drain-wallpaper-before.md`

- [ ] **Step 1: 제목과 도입부를 작성한다**

Use title:

```text
에어컨 배수 문제로 벽지까지 번졌습니다｜도배 전 확인한 현장 BEFORE
```

첫 다섯 문장은 문을 열고 보이는 천장 모서리, 에어컨 아래쪽, 넓게 들뜬 벽지라는 구체적 장면과 당황스러움을 담되 제공되지 않은 냄새·임차인 반응·건물주 발언은 만들지 않는다.

- [ ] **Step 2: 사진 세 장을 관련 문단에 분산하고 캡션을 쓴다**

Use relative paths:

```text
assets/2026-08-25-aircon-drain-wallpaper-before/01-before-ceiling-aircon.jpg
assets/2026-08-25-aircon-drain-wallpaper-before/02-before-wall-damage.jpg
assets/2026-08-25-aircon-drain-wallpaper-before/03-before-room-wide.jpg
```

- [ ] **Step 3: 역할 경계와 2편 예고를 작성한다**

브링케어는 현장 확인·사진 기록·건물주 전달·업체 일정 조율·완료 확인을 맡고, 실제 도배는 외부 전문업체가 수행한다고 쓴다. 마지막 정보 문단에는 작업 완료 후 같은 위치를 다시 촬영해 2편에서 비교한다고 쓴다.

- [ ] **Step 4: 상담 행동과 배너를 마지막에 한 번만 배치한다**

Use CTA:

```text
비슷한 벽지 손상이 확인됐다면 카카오채널 BRING Care로 전체 벽면 사진과 문제가 시작된 위치를 보내주세요.
```

마지막 자산:

```text
assets/2026-08-25-aircon-drain-wallpaper-before/consultation-banner.png
```

- [ ] **Step 5: 한국어 자연성 검수를 한다**

Expected: AI식 정보 나열, 같은 종결어미 반복, 과장된 홍보, 가짜 현장 대화가 없고 제공 사실의 확정성이 바뀌지 않는다.

- [ ] **Step 6: 원고를 커밋한다**

```powershell
git add -- "blog/2026-08-25-aircon-drain-wallpaper-before.md"
git commit -m "feat: write wallpaper damage before field post"
```

### Task 4: 자동·사람 검증과 원장 기록

**Files:**
- Modify: `blog/automation/backlog.md`
- Test: `blog/2026-08-25-aircon-drain-wallpaper-before.md`

- [ ] **Step 1: 원고 검증기를 실행한다**

Run:

```powershell
python "C:/Users/user/.codex/skills/writing-bringcare-naver-blog/scripts/validate_draft.py" "blog/2026-08-25-aircon-drain-wallpaper-before.md" --keyword "벽지 곰팡이" --engine brand_field
```

Expected: `작성승인`, 오류 0건. 미확인 결과, 역할 혼동, CTA 중복이 있으면 수정한다.

- [ ] **Step 2: 사람 관점 체크리스트를 통과한다**

Expected:

```text
첫 5문장에 구체적 장면과 감정이 있음
사진 3장 모두 BEFORE로 명시됨
에어컨 제조사 책임을 암시하지 않음
도배 완료 결과를 미리 주장하지 않음
브링케어와 외부 도배업체의 역할이 구분됨
상담 CTA는 카카오채널 하나뿐임
배너 뒤에 본문·출처·태그·연락처가 없음
```

- [ ] **Step 3: backlog에 1편과 2편 후속 촬영 항목을 기록한다**

Record: 제목, `brand_field`, BEFORE 사진 3장, 도배 작업 예정, 같은 구도 애프터 사진 3장 필요, 2편 작성 조건.

- [ ] **Step 4: 검증 결과와 원장 변경을 커밋한다**

```powershell
git add -- "blog/2026-08-25-aircon-drain-wallpaper-before.md" "blog/automation/backlog.md"
git commit -m "docs: record wallpaper before post QA"
```

### Task 5: 네이버 편집 준비와 공개 직전 중단

**Files:**
- Read: `blog/2026-08-25-aircon-drain-wallpaper-before.md`
- Read: `blog/assets/2026-08-25-aircon-drain-wallpaper-before/*`

- [ ] **Step 1: 로그인된 네이버 글쓰기 화면을 연다**

Expected: 브링케어 계정, 새 글쓰기, CAPTCHA·정책 경고 없음.

- [ ] **Step 2: 제목과 본문을 입력하고 기존 편집 템플릿을 적용한다**

Expected: 제목 외 모든 문단 가운데 정렬, 의미 묶음 사이 빈 문단, 소제목 4~6개 강조, 실제 인용구 1~2개, 실제 구분선 3~4개.

- [ ] **Step 3: 실제 현장사진 3장과 캡션, 상담 배너를 배치한다**

Expected: 사진이 관련 문단 가까이에 분산되고 상담 배너가 맨 마지막에 한 번만 있다.

- [ ] **Step 4: 카테고리와 태그를 설정한다**

Set category: `브링케어 현장기록`

Set tags:

```text
벽지곰팡이, 에어컨배수문제, 에어컨배관, 벽지들뜸, 벽지박리, 도배전, 현장점검, 원룸관리, 건물관리, 브링케어
```

- [ ] **Step 5: 발행 패널에서 전체공개와 검색 허용을 확인하고 멈춘다**

Expected: 최종 `발행` 버튼은 누르지 않는다. 사용자에게 제목, 카테고리, 전체공개·검색허용, 사진 3장, 상담 배너 1회를 보여주고 최종 승인을 요청한다.

### Task 6: 승인 후 공개와 사후 검수

**Files:**
- Modify: `blog/automation/performance-ledger.csv`
- Modify: `blog/automation/backlog.md`

- [ ] **Step 1: 사용자의 명시적 최종 발행 승인을 확인한다**

Expected: 현재 대화에서 공개 행동 직전에 받은 승인 문구가 있다.

- [ ] **Step 2: 네이버 최종 발행 버튼을 한 번만 누른다**

Expected: 공개 URL이 생성되고 중복 게시물이 생기지 않는다.

- [ ] **Step 3: 공개 페이지를 다시 열어 QA한다**

Expected: 제목, 가운데 정렬, 빈 문단, 사진 3장, 캡션, 인용구, 구분선, 카테고리, 태그, 공개 상태, 상담 배너 마지막 1회가 실제 페이지에 보인다.

- [ ] **Step 4: 성과 원장과 backlog를 갱신한다**

Record: 공개 URL, 발행 시각, `content_engine=brand_field`, 72시간·7일·14일·30일 회고 대상, 2편 애프터 촬영 대기.

- [ ] **Step 5: 원장 변경을 커밋한다**

```powershell
git add -- "blog/automation/performance-ledger.csv" "blog/automation/backlog.md"
git commit -m "docs: record wallpaper before post publication"
```

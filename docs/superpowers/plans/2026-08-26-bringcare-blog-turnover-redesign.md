# Bringcare Turnover Blog Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 브링케어 네이버 블로그를 `원주 원룸·다가구 입·퇴실 관리` 중심의 신뢰형 영업 채널로 개편하고, 실제 공개 화면과 모바일 화면까지 검증한다.

**Architecture:** 로컬 작업공간을 원본·검증·복구의 기준으로 사용하고 네이버 블로그에는 검증된 결과만 반영한다. Google Flow 생성 이미지는 브랜드 설명용 자산으로만 사용하고 실제 현장 증거는 소유권이 확인된 실사진으로 분리한다. 공개 변경은 백업 → 자산 제작 → 설정 변경 → 공지 발행 → 현장글 연결 → 공개 QA 순서로 수행한다.

**Tech Stack:** Naver Blog SmartEditor, Google Flow, Windows/Codex in-app browser, Markdown/YAML working files, Python draft validators, PNG/JPG brand assets

---

## File map

- Create: `blog/redesign/2026-08-26/current-blog-snapshot.md` — 변경 전 블로그명, 소개, 카테고리, 공지, 공개 글 목록과 복구값
- Create: `blog/redesign/2026-08-26/pricing-verification.md` — 공개 가격·부가세·적용 조건의 제안서 대조 기록
- Create: `blog/redesign/2026-08-26/blog-settings.md` — 승인된 블로그명, 프로필 문구, 메뉴와 카테고리 매핑
- Create: `blog/redesign/2026-08-26/flow-prompts.md` — Google Flow 실행 프롬프트와 결과 선택 기준
- Create: `blog/redesign/2026-08-26/assets/` — 커버, 프로필, 패키지 설명 이미지, 카테고리 이미지
- Create: `blog/redesign/2026-08-26/notices/01-24h-package.md` — 대표 상품 공지 원고
- Create: `blog/redesign/2026-08-26/notices/01-24h-package-brief.yaml` — 대표 상품 검증 브리프
- Create: `blog/redesign/2026-08-26/notices/02-company-role.md` — 역할·기록 원칙 공지 원고
- Create: `blog/redesign/2026-08-26/notices/02-company-role-brief.yaml` — 역할 공지 검증 브리프
- Create: `blog/redesign/2026-08-26/notices/03-pricing-process.md` — 가격·이용 절차 공지 원고
- Create: `blog/redesign/2026-08-26/notices/03-pricing-process-brief.yaml` — 가격 공지 검증 브리프
- Create: `blog/redesign/2026-08-26/post-triage.csv` — 기존 공개 글 유지·수정·비공개 검토 분류
- Create: `blog/redesign/2026-08-26/field-link-map.csv` — 대표 현장글과 공지 연결 계획
- Create: `blog/redesign/2026-08-26/qa-report.md` — PC·모바일·링크·표현 최종 검수 결과
- Modify: `blog/automation/backlog.md` — 개편 공지와 후속 검색글 작업 등록
- Modify: `blog/automation/topic-cooldown.csv` — 새 핵심 주제 중복 방지 등록
- Modify: `blog/automation/performance-ledger.csv` — 개편 공지의 성과 측정 기준 등록
- Modify: `blog/automation/alerts.md` — 로그인·편집기·공개 QA 장애 기록

### Task 1: 변경 전 상태 백업과 복구 지점 확정

- [ ] **Step 1: 현재 공개 블로그를 한 탭에서 연다**

Open: `https://blog.naver.com/bringcare`

Expected: 브링케어 계정의 공개 홈이 보이며 다른 네이버 계정으로 전환되지 않는다.

- [ ] **Step 2: 홈과 관리 화면의 현재값을 기록한다**

Record in `blog/redesign/2026-08-26/current-blog-snapshot.md`:

```markdown
# 변경 전 브링케어 블로그 상태

- 확인 시각: YYYY-MM-DD HH:MM KST
- 블로그 URL: https://blog.naver.com/bringcare
- 블로그명:
- 프로필 소개:
- 대표 커버:
- 상단 메뉴:
- 전체 카테고리:
- 고정 공지:
- 공개 글 수:
- 예약 글 수:
- 로그인 계정 확인: bringcare
- 복구에 필요한 원문/화면 캡처 위치:
```

- [ ] **Step 3: 공개 글 목록을 저장한다**

For every visible post, record title, URL, category, public/reserved state, and whether it contains owned field photos. Do not delete or hide anything in this task.

- [ ] **Step 4: 백업 완전성을 확인한다**

Expected: 블로그명·소개·커버·메뉴·카테고리·공지·공개/예약 글을 원래 상태로 되돌릴 정보가 모두 존재한다.

- [ ] **Step 5: 백업만 커밋한다**

```powershell
git add -- 'blog/redesign/2026-08-26/current-blog-snapshot.md'
git commit -m "docs: snapshot Bringcare blog before redesign"
```

### Task 2: 공개 가격과 서비스 약속 검증

- [ ] **Step 1: 제안서 가격표를 다시 연다**

Open: `H:/내 드라이브/브링 케어/BRING CARE/서비스 소개서(제안서)/브링케어 제안서.pdf`, page 13.

- [ ] **Step 2: 공개 후보 가격을 대조한다**

Record exactly in `blog/redesign/2026-08-26/pricing-verification.md`:

```markdown
| 항목 | 제안서 표기 | 블로그 공개안 | 부가세 | 포함 범위 | 별도 범위 | 공개 가능 |
|---|---:|---:|---|---|---|---|
| 월 정기관리 | 89,000원 | 89,000원부터 | 별도 여부 확인 | 계약 범위 | 현장 작업비 | 보류/통과 |
| 관리 건물 입퇴실청소 | 100,000원부터 | 100,000원부터 | 별도 여부 확인 | 기본 청소 | 잔존물·특수오염 | 보류/통과 |
| 일반 단건 청소 | 사용자 확정 120,000원부터 | 120,000원부터 | 별도 여부 확인 | 기본 청소 | 잔존물·특수오염 | 보류/통과 |
| 외부 전문작업 조율 | 작업금액의 5% | 승인 작업금액의 5% | 별도 여부 확인 | 일정·완료 확인 | 시공·자재비 | 보류/통과 |
```

- [ ] **Step 3: 24H 측정 구간을 검증한다**

Required public wording:

```text
퇴실 14일 전까지 접수되고 출입·작업 범위·비용 승인이 완료된 호실 중 중대한 추가 수리가 없는 경우, 퇴실 확인 시점부터 24시간 안에 청소·경미한 정리·사진 기록·인계 준비를 마치는 것을 운영 기준으로 합니다.
```

Forbidden wording:

```text
24시간 안에 새 임차인이 계약됩니다.
무조건 공실 0일입니다.
어떤 집이든 하루 안에 끝납니다.
```

- [ ] **Step 4: 검증 결과를 통과 또는 중단으로 명시한다**

Expected: 가격, VAT, 적용 대상 중 하나라도 불명확하면 가격 공지 발행만 보류하고 나머지 비가격 개편은 계속할 수 있도록 분리 기록한다.

- [ ] **Step 5: 가격 검증 기록을 커밋한다**

```powershell
git add -- 'blog/redesign/2026-08-26/pricing-verification.md'
git commit -m "docs: verify Bringcare public pricing claims"
```

### Task 3: Google Flow 브랜드 이미지 제작

- [ ] **Step 1: Flow 자산 규칙을 저장한다**

Write `blog/redesign/2026-08-26/flow-prompts.md` with these non-negotiable rules:

```markdown
- 생성 이미지는 커버·상품 설명·프로세스 설명에만 사용한다.
- 실제 현장, 고객 사례, BEFORE/AFTER, 완료 증거로 표현하지 않는다.
- 얼굴, 주소, 호실, 차량번호, 브랜드 로고, 한글 텍스트를 생성 프롬프트에 넣지 않는다.
- BR 로고와 한글 문구는 선택된 결과 위에 후편집한다.
- 네이버 게시물에서 AI 이미지가 쓰이면 AI 활용 설정을 켠다.
```

- [ ] **Step 2: Google Flow에서 커버 후보 4개를 생성한다**

Prompt:

```text
Photorealistic wide commercial brand image set in Wonju, South Korea. A realistic three-to-five-story Korean studio apartment building on the right, a professional property manager in a clean navy polo shirt checking a tablet and turnover checklist, face not identifiable. The left 55 percent is bright clean negative space for Korean headline overlay. Calm daylight, white, light blue and deep navy corporate palette, trustworthy property operations company, not a construction site. No text, no logo, no watermark, no address, no apartment number, no car plate, no safety helmet, no luxury high-rise, 3:1 aspect ratio.
```

- [ ] **Step 3: Google Flow에서 24H 패키지 후보 4개를 생성한다**

Prompt:

```text
A realistic Korean studio apartment turnover sequence presented as one coherent premium advertising scene: move-out inspection, professional cleaning, minor maintenance coordination, and a clean empty room ready for the next tenant. Korean low-rise rental housing, navy-uniform management staff seen from the side or back, no identifiable faces. Strong sense of organized speed without rushing or danger. Clean white and cobalt blue visual accents. Leave central space for a large 24H graphic added later. No text, logo, watermark, address, room number or before-after deception, 16:9.
```

- [ ] **Step 4: 결과를 권리·오인·한국성 기준으로 선별한다**

Reject any result with foreign architecture, fake Korean text, identifiable face, distorted hands, invented address, construction-site implication, or misleading before/after composition.

- [ ] **Step 5: 선택 이미지에 브랜드 문구를 합성한다**

Cover copy:

```text
퇴실 14일 전부터 준비합니다
24시간 임대 준비
퇴실확인 · 직영청소 · 보수연결 · 완료보고
```

Use colors `#071A3D`, `#153FD1`, `#2157FF`, `#EAF1FF`; preserve the existing BR symbol without alteration.

- [ ] **Step 6: 출력 자산을 검수한다**

Expected files:

```text
blog/redesign/2026-08-26/assets/bringcare-cover-1920x640.png
blog/redesign/2026-08-26/assets/bringcare-cover-master.png
blog/redesign/2026-08-26/assets/bringcare-profile-1024.png
blog/redesign/2026-08-26/assets/bringcare-24h-package-16x9.png
```

Checks: headline legible on mobile crop, no personal information, no generated Korean gibberish, no claim beyond approved wording.

- [ ] **Step 7: 자산과 프롬프트를 커밋한다**

```powershell
git add -- 'blog/redesign/2026-08-26/flow-prompts.md' 'blog/redesign/2026-08-26/assets'
git commit -m "feat: create Bringcare turnover brand assets"
```

### Task 4: 블로그 설정과 메뉴 적용안 확정

- [ ] **Step 1: 설정값을 파일로 고정한다**

Create `blog/redesign/2026-08-26/blog-settings.md`:

```markdown
# 브링케어 블로그 설정

- 블로그명: 브링케어 | 원주 입퇴실·공실 관리
- 프로필 소개: 원주 원룸·다가구의 퇴실 확인부터 청소·보수 연결, 다음 임대 준비와 완료 사진 보고까지 이어드립니다.
- 상단 메뉴 1: 24H 입퇴실 패키지
- 상단 메뉴 2: 서비스·가격
- 상단 메뉴 3: 실제 현장기록
- 상단 메뉴 4: 건물주 가이드
- 하위 1: 입퇴실 체크리스트
- 하위 2: 퇴실청소·원상정리
- 하위 3: 공실 보수·시설확인
- 하위 4: 완료 사진보고
- 하위 5: 브링케어 소개
```

- [ ] **Step 2: 기존 카테고리의 이동표를 작성한다**

Map every current category to one target category. Mark unrelated trend posts as `브링이슈 재제작 검토`; do not move, hide, or delete them yet.

- [ ] **Step 3: 설정값과 이미지 조합을 미리 검수한다**

Expected: 첫 화면만 보고 3초 안에 `원주`, `입퇴실 관리`, `퇴실 전 사전 준비`, `사진 보고`를 이해할 수 있다.

- [ ] **Step 4: 설정안을 커밋한다**

```powershell
git add -- 'blog/redesign/2026-08-26/blog-settings.md'
git commit -m "docs: lock Bringcare blog settings"
```

### Task 5: 고정 공지 3편 작성과 자동 검증

- [ ] **Step 1: 대표 상품 공지 브리프와 원고를 작성한다**

Required title:

```text
원주 입퇴실 관리｜퇴실 14일 전부터 준비하는 24H 패키지
```

Required sections: 건물주의 실제 불편, 24H 의미, D-14~D+1, 적용 조건, 제외 조건, 준비 정보, 실제 현장글 연결, 카카오채널 CTA.

- [ ] **Step 2: 회사·역할 공지 브리프와 원고를 작성한다**

Required title:

```text
브링케어는 무엇을 관리하나요｜직접 확인·업체 조율·완료 보고
```

Required sections: 회사 한 문장, 직접 확인 범위, 직영 청소팀, 외부 전문업체, 건물주 승인, 사진 기록 원칙, CTA.

- [ ] **Step 3: 가격·이용 절차 공지 브리프와 원고를 작성한다**

Required title:

```text
브링케어 서비스와 가격｜정기관리·입퇴실청소·보수 연결
```

Only include rows marked public-safe in `pricing-verification.md`. Required sections: 시작 가격, 포함/별도, 변동 조건, 상담→확인→견적→계약, FAQ, CTA.

- [ ] **Step 4: 세 원고에 편집 템플릿을 적용한다**

For each draft require: title excluded from center alignment; all body paragraphs centered; blank paragraph between meaning groups; blue bold underlined subheads; 1–3 quote blocks; 3–5 real Naver dividers; natural emoji; image captions; one CTA; one final banner only where consultation is natural; nothing after final banner.

- [ ] **Step 5: 기계 검증을 실행한다**

Run each brief and draft through the validators discovered by `rg --files | rg 'validate_(brief|draft)\.py$'`.

Expected: all errors are zero. Warnings about unverified price or rights must be resolved, not ignored.

- [ ] **Step 6: 사람 관점 검수를 기록한다**

For each post answer PASS/FAIL:

```text
첫 5문장에 구체적인 건물주 상황과 감정이 있는가?
24시간의 시작·종료 시점이 정확한가?
조건과 제외사항이 같은 화면 흐름에서 보이는가?
브링케어 직접 작업과 외부 전문작업이 구분되는가?
회사소개를 빼도 정보 가치가 남는가?
상담 요청이 하나로 끝나는가?
```

- [ ] **Step 7: 원고 세트를 커밋한다**

```powershell
git add -- 'blog/redesign/2026-08-26/notices'
git commit -m "feat: draft Bringcare turnover notice series"
```

### Task 6: 기존 글 전수 분류와 대표 현장글 연결

- [ ] **Step 1: 기존 글을 한 행씩 분류한다**

Create `post-triage.csv` columns:

```text
title,url,current_category,owned_field_photo,business_relevance,rights_status,traffic_signal,decision,reason,target_category,notice_link
```

Allowed decisions: `유지`, `수정`, `브링이슈 재제작`, `비공개 검토`.

- [ ] **Step 2: 대표 현장글 5편을 선정한다**

Priority: actual photos, clear role, privacy-safe, directly related to turnover/vacancy/cleaning/repair. Include the air-conditioner drainage/wallpaper BEFORE post as a two-part case only when the AFTER evidence exists.

- [ ] **Step 3: 현장글별 연결 문구를 새로 쓴다**

Create `field-link-map.csv` with title, URL, related notice, one-sentence transition, CTA type, and whether a final banner is appropriate. Do not paste an identical company paragraph across posts.

- [ ] **Step 4: 비공개 후보는 실행하지 않고 별도 목록으로 남긴다**

Expected: each candidate includes a concrete reason and the user can approve individual or batch changes later.

- [ ] **Step 5: 분류 결과를 커밋한다**

```powershell
git add -- 'blog/redesign/2026-08-26/post-triage.csv' 'blog/redesign/2026-08-26/field-link-map.csv'
git commit -m "docs: classify Bringcare posts for redesign"
```

### Task 7: 네이버 블로그 설정 변경과 공지 발행

- [ ] **Step 1: 로그인 계정과 단일 탭을 확인한다**

Expected: one in-app browser tab, `bringcare` account, no `bringissue` session, no CAPTCHA or policy warning.

- [ ] **Step 2: 커버·프로필·블로그명·소개를 적용한다**

Apply only the values in `blog-settings.md` and assets that passed Task 3 QA.

- [ ] **Step 3: 카테고리와 상단 메뉴를 적용한다**

Create or rename categories without deleting posts. Preserve URLs and move only posts already mapped as safe.

- [ ] **Step 4: 공지 1을 작성하고 공개 직전 검수한다**

Verify actual editor state: center alignment, spacing, highlighted subheads, quotes, 3–5 native dividers, captions, AI disclosure, category, tags, CTA, final banner order.

- [ ] **Step 5: 공지 1을 발행하고 공개 페이지를 검수한다**

Expected: desktop and mobile display match the draft; no line wrapping hides `14일 전` or changes the meaning of `24시간`.

- [ ] **Step 6: 공지 2와 공지 3을 같은 방식으로 발행한다**

Stop immediately on login expiry, CAPTCHA, editor structure change, policy warning, or public QA mismatch. Record the exact resume point in `blog/automation/alerts.md`.

- [ ] **Step 7: 세 공지를 상단에서 찾을 수 있게 고정한다**

Expected: a first-time visitor can reach package, roles, and pricing/process within one click from the blog home.

### Task 8: 대표 현장글 5편 수정과 상담 동선 연결

- [ ] **Step 1: 글별 원문과 실사진 권리를 재확인한다**

Do not edit any post with unclear ownership, tenant-identifying information, address, unit number, face, car plate, or unverified work claim.

- [ ] **Step 2: 각 글의 제목·도입·캡션을 검색 질문 중심으로 수정한다**

Each post answers one query only, uses actual site facts only, and distinguishes diagnosis, cleaning, and specialist work.

- [ ] **Step 3: 관련 공지 링크와 CTA 하나를 연결한다**

Use the exact transition in `field-link-map.csv`; the final consultation banner appears once only when the post is genuinely consultation-oriented.

- [ ] **Step 4: 수정 후 공개 페이지를 검수한다**

Expected: original field images remain intact, formatting meets the template, no duplicate company boilerplate, and links open the intended notice.

### Task 9: 운영 원장과 후속 콘텐츠 전환

- [ ] **Step 1: 후속 검색글 10편을 backlog에 등록한다**

Priority topics:

```text
원주 입퇴실관리 절차
원주 퇴실청소 가격
원룸 퇴실 전 14일 체크리스트
외지 건물주 공실 확인 방법
퇴실 후 청소와 보수 순서
공실 벽지 곰팡이 원인 확인
에어컨 배수 문제와 벽지 손상
원룸 잔존물 처리 범위
퇴실 완료 사진에서 볼 위치
입퇴실 관리업체 견적 비교 기준
```

- [ ] **Step 2: 주제 쿨다운을 등록한다**

Prevent consecutive posts from repeating the same keyword, problem, conclusion, and CTA.

- [ ] **Step 3: 성과 측정 행을 생성한다**

For each notice and revised field post, schedule 72h, 7d, 14d, 30d checks. Store unavailable metrics as `NA`, never zero.

- [ ] **Step 4: 운영 파일을 검증하고 커밋한다**

```powershell
git add -- 'blog/automation/backlog.md' 'blog/automation/topic-cooldown.csv' 'blog/automation/performance-ledger.csv'
git commit -m "ops: switch Bringcare blog to turnover funnel"
```

### Task 10: 전체 완료 감사와 복구 가능성 확인

- [ ] **Step 1: 공개 PC 화면을 검수한다**

Check: name, cover, profile, menu, categories, three notices, five field links, pricing wording, CTA, image distinction.

- [ ] **Step 2: 모바일 화면을 검수한다**

Check: cover crop, headline legibility, paragraph spacing, quotes/dividers, captions, tap targets, final banner position.

- [ ] **Step 3: 금지 표현과 개인정보를 검색한다**

Expected absent: unconditional vacancy guarantee, tenant contract guarantee, unsupported price, full address, room number, tenant identity, generated image presented as field evidence.

- [ ] **Step 4: 완료 보고서를 작성한다**

Create `blog/redesign/2026-08-26/qa-report.md` with PASS/FAIL and the public URL proving each completion criterion from the design spec.

- [ ] **Step 5: 실패 항목을 즉시 복구하거나 보류한다**

Use `current-blog-snapshot.md` to restore only the failed setting. Do not roll back unrelated successful changes.

- [ ] **Step 6: 최종 결과를 커밋한다**

```powershell
git add -- 'blog/redesign/2026-08-26/qa-report.md' 'blog/automation/alerts.md'
git commit -m "docs: verify Bringcare blog turnover redesign"
```

## Completion evidence

The redesign is complete only when `qa-report.md` links or screenshots prove all of the following:

- The first screen identifies a Wonju turnover-management company within three seconds.
- The 24-hour measurement window and every major exclusion are visible.
- Three notices expose service, role boundaries, pricing, and process.
- Five real field posts connect to the correct notice and use owned photos only.
- Top navigation contains the four approved business menus.
- Irrelevant trend content no longer occupies the core navigation.
- Flow images are limited to explanatory branding and are disclosed where required.
- Desktop and mobile public views pass QA.


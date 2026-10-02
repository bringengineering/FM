# Drive CRM Review Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive의 건물 체크리스트와 완료보고서를 CRM 검토 대기로 수집하고, 대표 승인 뒤 건물·용역 이력·정기청소 계약으로 안전하게 반영한다.

**Architecture:** 기존 Google Apps Script를 Drive 수집과 승인 중계자로 사용한다. 원본 파일은 Drive에 두고 Firebase에는 후보·승인 결과·감사기록만 저장하며, 데스크톱 CRM은 인증된 조회와 Apps Script 승인 API만 사용한다.

**Tech Stack:** Google Apps Script, Google Drive Advanced Service, Firebase Realtime Database REST, Electron/Node.js desktop CRM, `node:test`.

---

### Task 1: 후보 도메인과 추출기

**Files:**
- Modify: `apps-script/complaint-intake-to-firebase.gs`
- Create: `apps-script/drive-crm-import.test.js`

- [ ] **Step 1: Write failing tests for supported PDF/DOCX candidates**

테스트는 PDF·DOCX만 허용하고, 파일 ID 멱등키·sourceHash·원본 링크·고신뢰 필드만 정규화하는 `buildDriveImportCandidate_()` 계약을 실행한다. 전화번호·임대조건·출입정보가 건물 후보에 포함되지 않는 것도 검증한다.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test apps-script/drive-crm-import.test.js`

Expected: `buildDriveImportCandidate_ is not defined` 또는 PDF 후보 미지원으로 FAIL.

- [ ] **Step 3: Implement the minimal candidate parser**

`listDriveOnboardingCandidates_()`에 PDF MIME을 추가하고, 파일명·DOCX 텍스트·PDF OCR 텍스트를 입력받는 순수 후보 빌더를 만든다. 본문 전문은 반환하지 않고 `suggested`, `confidence`, `warnings`, `sourceHash`만 반환한다.

- [ ] **Step 4: Verify GREEN and legacy onboarding regression**

Run: `node --test apps-script/drive-crm-import.test.js apps-script/onboarding-field.test.js`

Expected: 모든 테스트 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps-script/complaint-intake-to-firebase.gs apps-script/drive-crm-import.test.js
git commit -m "feat: collect Drive CRM import candidates"
```

### Task 2: Firebase 후보 동기화와 멱등성

**Files:**
- Modify: `apps-script/complaint-intake-to-firebase.gs`
- Modify: `apps-script/drive-crm-import.test.js`

- [ ] **Step 1: Write failing tests for pending, stale, and idempotent upserts**

동일 해시는 기존 후보를 유지하고, pending 원본 변경은 후보를 갱신하며, approved/rejected 원본 변경은 `stale`로 전환하는 테스트를 추가한다. 수집 실패가 기존 후보를 삭제하지 않는 것도 검증한다.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test apps-script/drive-crm-import.test.js`

Expected: 신규 upsert 함수 부재로 FAIL.

- [ ] **Step 3: Implement isolated Firebase PATCH sync**

`crmCompany/driveImportCandidates`와 `crmCompany/serviceImportCandidates`만 PATCH하는 함수를 추가한다. 기존 `syncPaymentBuildingsFromOnboarding_()` 및 `caseSettings/paymentBuildings` PUT은 호출하지 않는다.

- [ ] **Step 4: Verify GREEN**

Run: `node --test apps-script/drive-crm-import.test.js apps-script/onboarding-field.test.js`

Expected: PASS, 기존 입금관리 테스트 기대값 불변.

- [ ] **Step 5: Commit**

```bash
git add apps-script/complaint-intake-to-firebase.gs apps-script/drive-crm-import.test.js
git commit -m "feat: sync Drive review candidates"
```

### Task 3: 승인 API와 원자 반영

**Files:**
- Modify: `apps-script/complaint-intake-to-firebase.gs`
- Modify: `apps-script/drive-crm-import.test.js`

- [ ] **Step 1: Write failing authorization and atomicity tests**

잘못된 ID token, 이메일 불일치, 비활성 계정, member/viewer 승인, 중복 이름·주소·Drive ID, stale 후보, 재사용 requestId를 거부하는 테스트를 추가한다. 성공 시 정식 레코드·후보 상태·감사로그가 하나의 multi-location PATCH에 함께 포함되는지 검증한다.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test apps-script/drive-crm-import.test.js`

Expected: 승인 핸들러 부재로 FAIL.

- [ ] **Step 3: Implement authenticated approval and rejection handlers**

Firebase Auth `accounts:lookup`으로 ID token을 확인하고 `crmCompany/access/{uid}`를 다시 읽어 활성 admin만 허용한다. 건물 승인은 `buildings`, 용역 승인은 `serviceRecords`, 반려는 후보 상태만 변경하며 모두 감사로그와 request receipt를 포함한다.

- [ ] **Step 4: Verify GREEN and no partial write**

Run: `node --test apps-script/drive-crm-import.test.js`

Expected: 모든 권한·중복·멱등·원자성 테스트 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps-script/complaint-intake-to-firebase.gs apps-script/drive-crm-import.test.js
git commit -m "feat: approve Drive imports into CRM"
```

### Task 4: CRM 검토 대기 화면

**Files:**
- Modify: `desktop-crm/src/core.js`
- Modify: `desktop-crm/src/remote.js`
- Modify: `desktop-crm/src/preload.js`
- Modify: `desktop-crm/src/main.js`
- Modify: `desktop-crm/src/app.js`
- Modify: `desktop-crm/src/index.html`
- Modify: `desktop-crm/src/styles.css`
- Create: `desktop-crm/test/drive-import-review.test.js`

- [ ] **Step 1: Write failing renderer and bridge tests**

건물 관리의 검토 대기 카드, Drive 원본 열기, 신뢰도·경고·중복 표시, admin 승인/반려, member/viewer 읽기 전용, exact sender 검증, HTTPS 원본 링크 제한을 테스트한다.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test desktop-crm/test/drive-import-review.test.js`

Expected: view/IPC 계약 부재로 FAIL.

- [ ] **Step 3: Implement read-only candidate overlays and approval bridge**

후보 컬렉션은 일반 CRM pending store·백업·shared PATCH에서 제외한다. 승인 응답은 requestId와 결과 ID가 요청과 일치할 때만 반영하며, 승인 성공 후 후보와 정식 레코드를 다시 읽는다.

- [ ] **Step 4: Verify GREEN and desktop regression**

Run: `npm.cmd test`

Workdir: `desktop-crm`

Expected: 신규 테스트와 기존 전체 테스트 PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop-crm/src desktop-crm/test/drive-import-review.test.js
git commit -m "feat: add Drive import review workspace"
```

### Task 5: 예초 완료 이력과 계단청소 정기계약

**Files:**
- Modify: `desktop-crm/src/core.js`
- Modify: `desktop-crm/src/app.js`
- Modify: `desktop-crm/src/styles.css`
- Modify: `desktop-crm/test/drive-import-review.test.js`
- Modify: `apps-script/complaint-intake-to-firebase.gs`
- Modify: `apps-script/drive-crm-import.test.js`

- [ ] **Step 1: Write failing service record and contract tests**

예초 후보 승인 결과가 `2026-08-15`, `사계절제초작업`, `150000`, 완료, 추가조치 없음, 원본 파일 ID로 저장되는지 검증한다. 계단청소 계약은 `weekly`, `60000`, `planned`, `startDate:null`이고 일정이 0건이어야 한다.

- [ ] **Step 2: Run both focused suites and confirm RED**

Run: `node --test apps-script/drive-crm-import.test.js desktop-crm/test/drive-import-review.test.js`

Expected: 서비스 계약 및 운영 이력 UI 부재로 FAIL.

- [ ] **Step 3: Implement service history and recurring contract UI**

건물 상세의 `운영 서비스`에 완료 이력과 정기 계약을 분리해 표시한다. 시작일이 null이면 `계약 예정 · 시작일 미정`을 표시하고 schedule generator를 호출하지 않는다. 시작일 입력 후에만 `contractId|weekStart` 키로 주 1회 일정을 생성한다.

- [ ] **Step 4: Verify GREEN**

Run: `node --test apps-script/drive-crm-import.test.js`

Run: `npm.cmd test`

Workdir: `desktop-crm`

Expected: 예초·청소 계약·멱등 일정과 전체 회귀 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps-script desktop-crm/src desktop-crm/test/drive-import-review.test.js
git commit -m "feat: track building service operations"
```

### Task 6: Firebase 규칙과 배포 전 검증

**Files:**
- Modify: `database.rules.json`
- Create: `company-site/tests/field/drive-import-rules.test.ts`
- Modify: `apps-script/README.md`

- [ ] **Step 1: Write failing emulator rules tests**

활성 CRM 사용자의 후보 읽기, 비인증 읽기 거부, 모든 클라이언트 후보·감사로그 쓰기 거부, 승인된 서비스 레코드의 역할별 읽기/쓰기 경계를 테스트한다.

- [ ] **Step 2: Run the database emulator and confirm RED**

Run: `pnpm --dir company-site exec firebase --config ../firebase.json --project demo-bring-field-platform emulators:exec --only database "pnpm test:rules"`

Expected: 신규 경로 규칙 부재로 FAIL.

- [ ] **Step 3: Add least-privilege rules and operator runbook**

후보·감사로그 client write를 false로 고정하고 CRM 역할별 read만 허용한다. README에 Apps Script 권한, 트리거, 비활성 승인 플래그, rollback 순서를 기록한다.

- [ ] **Step 4: Run complete verification**

Run: `node --test apps-script/*.test.js`

Run: `npm.cmd test && npm.cmd run smoke`

Workdir: `desktop-crm`

Run: `pnpm --dir company-site exec firebase --config ../firebase.json --project demo-bring-field-platform emulators:exec --only database "pnpm test:rules"`

Expected: 모든 테스트 PASS, smoke가 ready/initialized/connected를 보고.

- [ ] **Step 5: Commit**

```bash
git add database.rules.json company-site/tests/field/drive-import-rules.test.ts apps-script/README.md
git commit -m "chore: secure Drive CRM import paths"
```

### Task 7: 실제 자료 dry-run

**Files:**
- Modify: `docs/superpowers/plans/2026-08-17-drive-crm-review-import.md`

- [ ] **Step 1: Run Apps Script dry-run for the two Drive documents**

입력 파일 ID는 건물 체크리스트 `1K-TSV1UcHFsQwP4YwW2lrKIBfLQZFbih`와 예초 완료보고서 `1cS3-f7JM4mrs6p321r7bftYrGF4qyIPK`로 제한한다. 쓰기 없이 생성될 후보 JSON과 중복 판정을 출력한다.

- [ ] **Step 2: Verify the dry-run output manually against the source documents**

건물은 북원로2475번길 93, 예초는 2026-08-15·사계절제초작업·150,000원으로 일치해야 한다. 불명확한 필드는 경고이고 자동 확정 필드가 아니어야 한다.

- [ ] **Step 3: Record verification evidence in this plan**

검증 일시, 파일 ID, sourceHash, 후보 status, 중복 결과, 테스트 명령 결과를 `실행 기록` 섹션에 추가한다. 개인정보·토큰·원문은 기록하지 않는다.

- [ ] **Step 4: Commit the evidence**

```bash
git add docs/superpowers/plans/2026-08-17-drive-crm-review-import.md
git commit -m "docs: record Drive import dry-run"
```

배포는 dry-run과 사용자 확인 뒤 별도 승인으로 수행한다. 코드·규칙·Apps Script 배포를 이 계획 실행에 자동 포함하지 않는다.

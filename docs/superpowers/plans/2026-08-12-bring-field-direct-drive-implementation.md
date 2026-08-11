# BRING FIELD Direct Google Drive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** BRING FIELD 모바일 PWA가 Firebase Storage/Functions 없이 회사 Google Drive로 사진·영상과 광고 묶음을 직접 저장하도록 만든다.

**Architecture:** Google Identity Services access token은 메모리 전용으로 관리하고, Drive v3 REST API를 작은 client/transport/folder/upload 모듈로 분리한다. 기존 IndexedDB 촬영 큐와 UI는 유지하면서 direct Drive coordinator와 RTDB direct repository를 주입한다.

**Tech Stack:** Next/Vinext, React 19, TypeScript, Firebase Auth/Realtime Database/Hosting, Google Identity Services, Google Drive API v3, Vitest, IndexedDB.

---

### Task 1: Drive 권한과 폴더 모델

**Files:**
- Create: `company-site/app/field/lib/google-drive-auth.client.ts`
- Create: `company-site/app/field/lib/google-drive.client.ts`
- Create: `company-site/app/field/lib/drive-folders.ts`
- Test: `company-site/tests/field/google-drive-auth.test.ts`
- Test: `company-site/tests/field/google-drive-client.test.ts`
- Test: `company-site/tests/field/drive-folders.test.ts`

- [ ] `requestAccessToken({ prompt })`, token expiry, memory-only clear를 먼저 실패 테스트로 작성한다.
- [ ] 테스트가 missing module/API로 실패하는지 확인한다.
- [ ] GIS 스크립트 로더와 `drive.file` token client를 최소 구현한다.
- [ ] Drive error allowlist, exact appProperties query, folder name sanitation과 deterministic hierarchy 테스트를 RED로 추가한다.
- [ ] `files.list`, `files.create`, `files.get` transport와 idempotent `ensureFolderPath`를 구현한다.
- [ ] 집중 테스트와 lint/typecheck를 통과시킨다.

### Task 2: resumable 사진·영상 업로드

**Files:**
- Create: `company-site/app/field/lib/drive-resumable-upload.ts`
- Create: `company-site/app/field/lib/direct-drive-media-upload.ts`
- Modify: `company-site/app/field/lib/offline-queue.ts`
- Test: `company-site/tests/field/drive-resumable-upload.test.ts`
- Test: `company-site/tests/field/direct-drive-media-upload.test.ts`
- Test: `company-site/tests/field/offline-queue.test.ts`

- [ ] 8MiB chunk, 308 Range 재개, 401 재인증, 429/5xx 재시도, 500MiB 상한 테스트를 작성하고 RED를 확인한다.
- [ ] resumable start/probe/chunk loop를 구현한다.
- [ ] IndexedDB 레코드에 `driveUploadUrl`, `driveUploadedBytes`, `driveFileId`, `driveFolderId`를 추가하고 마이그레이션 테스트를 통과시킨다.
- [ ] mediaId exact lookup 후 업로드 또는 재사용하는 direct port를 구현한다.
- [ ] 업로드 완료 검증과 offline 재개 테스트를 통과시킨다.

### Task 3: Firebase direct repository와 보안 규칙

**Files:**
- Create: `company-site/app/field/lib/direct-field-api.client.ts`
- Modify: `database.rules.json`
- Modify: `company-site/tests/field/database-rules.test.ts`
- Create: `company-site/tests/field/direct-field-api.test.ts`

- [ ] admin/staff 세션 생성, 본인 세션 media 생성, reviewed adPackage 생성 규칙을 RED로 작성한다.
- [ ] 최소 쓰기 조건과 immutable binding 검증을 규칙에 추가한다.
- [ ] RTDB multi-path session/media/adPackage 저장 함수를 구현한다.
- [ ] 다른 사용자·다른 건물·closed session·Drive ID 없는 패키지 거부 테스트를 통과시킨다.

### Task 4: 촬영 UI 연결

**Files:**
- Modify: `company-site/app/field/FieldApp.tsx`
- Modify: `company-site/app/field/components/AppShell.tsx`
- Modify: `company-site/app/field/components/CaptureGuide.tsx`
- Modify: `company-site/app/field/components/CaptureWorkspace.tsx`
- Modify: `company-site/app/field/field.css`
- Test: `company-site/tests/field/capture-components.test.tsx`
- Test: `company-site/tests/field/capture-workspace.test.tsx`

- [ ] Drive 연결 상태·연결 버튼·업로드 상태 문구 테스트를 RED로 작성한다.
- [ ] FieldWorkspace가 direct repository/coordinator를 생성하도록 연결한다.
- [ ] 촬영 직후 `Drive 업로드 대기/중/완료`, 재시도, Drive 열기 UX를 구현한다.
- [ ] 카메라 input의 photo/video capture와 세로영상 검증 회귀를 통과시킨다.

### Task 5: 광고 묶음 direct 생성

**Files:**
- Create: `company-site/app/field/lib/direct-ad-package.ts`
- Modify: `company-site/app/field/components/AdPackageReview.tsx`
- Modify: `company-site/app/field/lib/ad-package.ts`
- Test: `company-site/tests/field/direct-ad-package.test.ts`
- Modify: `company-site/tests/field/ad-package.test.tsx`

- [ ] 당근/네이버/요약/사진목록/안내 TXT의 deterministic 내용 테스트를 RED로 작성한다.
- [ ] listing/building/unit/media snapshot에서 5개 Blob을 생성한다.
- [ ] `광고묶음/vNN` 폴더에 idempotent 업로드하고 RTDB reviewed record를 저장한다.
- [ ] 생성 중 이중 클릭, 일부 실패 재시도, 새로고침 후 기존 package 재사용 테스트를 통과시킨다.

### Task 6: Google API·배포·실기기 검증

**Files:**
- Modify: `company-site/app/field/lib/firebase.client.ts`
- Modify: `company-site/public/field-sw.js`
- Modify: `company-site/tests/field/service-worker.test.ts`
- Modify: `company-site/scripts/export-firebase.mjs`

- [ ] `drive.googleapis.com`을 회사 `bring-fm` 프로젝트에 활성화한다.
- [ ] 회사 OAuth client ID와 Drive root ID를 공개 런타임 상수로 설정한다. client secret은 포함하지 않는다.
- [ ] 전체 field tests, typecheck, lint, production build를 실행한다.
- [ ] database rules와 Hosting을 `bring-fm`에 배포한다.
- [ ] Android Chrome에서 로그인, Drive 연결, 사진, 8MiB 이상 영상, 재시도, 광고 TXT 5개를 검증한다.
- [ ] Drive 폴더 목록과 RTDB media/adPackage readback으로 결과를 확인한다.


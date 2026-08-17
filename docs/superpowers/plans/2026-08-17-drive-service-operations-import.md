# Drive Service Operations Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Google Drive의 용역 완료보고서와 정기 청소 계약을 CRM 건물 상세의 운영 이력으로 연결한다.

**Architecture:** Apps Script가 Drive 원본을 서버 소유 검토 후보로 수집하고, admin 승인 시 Firebase의 `serviceRecords` 또는 `serviceContracts` 원장에 멱등 저장한다. Desktop CRM은 후보를 별도로 읽고 건물 상세에서 완료 이력·정기 계약·일정을 표시하며, Drive 원본은 링크로만 연결한다.

**Tech Stack:** Google Apps Script, Firebase Realtime Database, Electron/Node.js, Node test runner

---

### Task 1: Service data model

**Files:**
- Modify: `desktop-crm/src/core.js`
- Modify: `desktop-crm/src/remote.js`
- Test: `desktop-crm/test/service-operations.test.js`

- [ ] RED: `serviceRecords`, `serviceContracts`, `serviceSchedules`가 저장·위생처리·대기저장 재생에서 보존되며 중복 Drive ID가 제거되는 테스트를 추가한다.
- [ ] Run `node --test test/service-operations.test.js`; expect missing collections/functions.
- [ ] GREEN: 세 콜렉션 생성·정규화·공유저장 계약을 추가한다.
- [ ] Run the focused test; expect PASS.
- [ ] Commit `feat(crm): add building service operation records`.

### Task 2: Drive collection and approval

**Files:**
- Modify: `apps-script/complaint-intake-to-firebase.gs`
- Modify: `apps-script/drive-crm-import.test.js`

- [ ] RED: 예초 PDF가 `serviceImportCandidates/{driveFileId}` 한 건으로 수집되고, 승인 전 `serviceRecords`가 생성되지 않으며, 승인 후 동일 Drive ID 재처리가 동일 기록을 반환하는 테스트를 추가한다.
- [ ] Run `node apps-script/drive-crm-import.test.js`; expect missing service import behavior.
- [ ] GREEN: `collectServiceImportCandidates_`, `approveServiceImport_`, `rejectServiceImport_`를 추가하고 auth/access/admin을 재검증한다.
- [ ] Run the focused test; expect PASS.
- [ ] Commit `feat: import Drive service completion reports`.

### Task 3: Building detail UI and recurring cleaning contract

**Files:**
- Create: `desktop-crm/src/service-operations-ui.js`
- Modify: `desktop-crm/src/index.html`
- Modify: `desktop-crm/src/app.js`
- Modify: `desktop-crm/src/preload.js`
- Modify: `desktop-crm/src/main.js`
- Test: `desktop-crm/test/service-operations-ui.test.js`

- [ ] RED: 북원로 2475번길 93 상세에 예초 완료·2026-08-15·150,000원·사계절제초작업·Drive 링크가 나타나고, 계단청소는 주 1회·월 60,000원·시작일 미정으로 나타나며 일정은 0건인 테스트를 추가한다.
- [ ] Run `node --test test/service-operations-ui.test.js`; expect missing UI module.
- [ ] GREEN: 운영 서비스 섹션, admin 승인·반려, 정기계약 등록 폼, 원본 링크 열기를 추가한다.
- [ ] Run the focused test; expect PASS.
- [ ] Commit `feat(crm): show building service operations`.

### Task 4: Rules and end-to-end verification

**Files:**
- Modify: `database.rules.json`
- Modify: `company-site/tests/field/database-rules-v2.test.ts`
- Modify: `desktop-crm/test/service-operations.test.js`

- [ ] RED: 후보·감사로그 직접 쓰기 거부, 활성 CRM 계정 읽기, admin 승인, member 일정 완료, viewer 쓰기 거부를 검증한다.
- [ ] Run Firebase Database emulator tests; expect missing rules.
- [ ] GREEN: 정확한 역할별 규칙과 index를 추가한다.
- [ ] Run Apps Script tests, desktop full tests, smoke, and emulator tests; expect all PASS.
- [ ] Build a fresh CRM installer and verify `latest.yml`, installer, and blockmap.

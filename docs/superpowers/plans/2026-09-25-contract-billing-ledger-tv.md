# 계약 청구·입금 장부 및 TV 매출 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 계약별 확정 청구와 증빙이 확인된 실제 입금을 분리해 CRM과 TV에 동일한 금액으로 보여 준다.

**Architecture:** 기존 `contracts` 데이터는 변경하지 않고 `crmCompany/billingLedger`에 청구서와 입금 내역을 별도 저장한다. 검증·월별 집계는 순수 코어에 두고, 원격 저장은 Firebase 규칙과 버전 검사로 보호한다. CRM과 TV는 같은 집계 결과를 사용하되 TV에는 합계만 보낸다.

**Tech Stack:** Electron/Node.js, Firebase Realtime Database, Cloudflare Worker TV 게시, Node test runner, Firebase rules emulator.

---

## 파일 경계

- `desktop-crm/src/billing-ledger-core.js`: 초안 제안, 금액 검증, 월별 합계와 상태 계산.
- `desktop-crm/test/billing-ledger-core.test.js`: 코어의 계약·입금·취소·연도 경계 회귀 테스트.
- `desktop-crm/src/remote.js`: 기존 세션 가드와 ETag 조건부 저장을 이용한 장부 읽기·쓰기.
- `database.rules.json`: 직원 초안/관리자 확정 권한과 데이터 형식 제한.
- `desktop-crm/src/app.js`: 계약 상세의 청구·입금 입력 및 확정 흐름.
- `desktop-crm/src/company-wallboard.js`, `desktop-crm/src/wallboard-publication-schema.js`: 확인된 회사 합계만 TV 스냅샷으로 전달.

## Task 1: 순수 장부 계산

- [ ] `desktop-crm/test/billing-ledger-core.test.js`에 `summarizeMonth({invoices,receipts}, '2026-09')`가 확정 청구와 실제 입금일 기준 확정 입금만 합산하는 테스트를 작성한다. 예: 청구 100000원, 9월 입금 30000원과 10월 입금 20000원이면 9월 합계는 `billed:100000,received:30000,receivable:70000`.
- [ ] `node --test desktop-crm/test/billing-ledger-core.test.js`를 실행해 함수 부재 실패를 확인한다.
- [ ] `billing-ledger-core.js`에 `summarizeMonth`를 작성한다. `status==='approved'`인 레코드만 합산하고, 금액은 `Number.isSafeInteger(value) && value > 0`으로 확인한다. 월은 `YYYY-MM` 정규식으로 검증한다.
- [ ] 같은 명령으로 통과를 확인하고, 부분입금·여러 건·취소·초과입금·중복 참조·기존 `collectionStatus` 무시를 각각 실패 테스트→구현→통과 순으로 추가한다.
- [ ] `git add desktop-crm/src/billing-ledger-core.js desktop-crm/test/billing-ledger-core.test.js && git commit -m "feat: calculate verified contract billing totals"`.

## Task 2: 계약 기반 초안과 저장 경계

- [ ] 코어 테스트에 월 정기 계약의 `contractId + YYYY-MM` 청구 초안, 단건의 `contractId + occurrenceId` 초안, 연간/기타 확인 대기 테스트를 추가해 실패를 확인한다.
- [ ] `billing-ledger-core.js`에 초안 생성 함수를 작성하고 계약 기간 밖/취소 계약/중복 키를 건너뛴다. 기존 입금 완료 플래그는 입금 레코드를 만들지 않는다.
- [ ] 원격 테스트에 직원 초안 저장, 관리자 확정, 낡은 버전 충돌, 회원의 확정 거절을 작성해 실패를 확인한다.
- [ ] `remote.js`에서 기존 `dbReadWithEtag`/`dbConditionalPut` 흐름으로 장부 레코드를 저장한다. 관리자 외의 승인 시도는 원격 요청 전 차단한다.
- [ ] `database.rules.json`에 동일 권한/버전/형식 검증을 추가하고 `company-site/tests/field/database-rules.test.ts`의 에뮬레이터 테스트로 직접 쓰기 우회를 거절한다.
- [ ] 집중 테스트 및 `npm test --prefix desktop-crm`을 실행하고 커밋한다.

## Task 3: CRM 계약 상세·월별 보고

- [ ] 계약 상세 화면 테스트에 청구 초안, 부분입금, 관리자 확정, 근거 확인 대기 표현을 먼저 작성해 실패를 확인한다.
- [ ] `app.js`의 계약 상세에 기존 필드와 구분된 `청구·입금` 영역을 연결하고, 담당자는 입력·관리자는 확정 버튼을 사용하게 한다.
- [ ] 월간 경영보고는 기존 추정 수치를 삭제하지 않고 `기존 계약 기준`/`확정 장부 기준`을 분리해 이행 차이를 보인다.
- [ ] 화면·원격 집중 테스트와 전체 데스크톱 테스트를 실행해 통과 후 커밋한다.

## Task 4: TV 합계 게시와 안전 검증

- [ ] TV 스냅샷 테스트에 `month,billed,received,receivable,pendingCount,asOf`만 허용하고 계약명·고객명·UID·증빙 참조를 제외하는 실패 테스트를 작성한다.
- [ ] CRM 게시 함수에 코어 집계 결과를 연결하고 확인되지 않은 입금은 0원으로 오해되지 않게 `집계 대기` 상태를 전송한다.
- [ ] TV에는 금액 요약 장면을 추가하되 기존 장면 자동 순환 및 마지막 정상 게시본을 유지한다.
- [ ] 데스크톱/Worker/규칙 전체 테스트, 좁은 화면 시각 점검, 두 기기 갱신 검증을 기록한다. 두 기기 검증 전에는 운영 완료로 표시하지 않는다.
- [ ] 검토 요청을 생성하거나 갱신한다. 운영 배포·병합은 별도 사용자 확인 후 진행한다.

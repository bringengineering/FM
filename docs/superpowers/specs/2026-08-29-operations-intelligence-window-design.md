# BRING Care 운영 인텔리전스 별도 창 설계

## 목적

기존 BRING CRM과 현진님의 진행 중인 기획을 변경하지 않고, 운영 업무를 구조적으로 기록하고 분석하는 별도 데스크톱 창을 추가한다. CRM 로그인 세션은 공유하지만 화면, 저장 경로, 업무 모델은 분리한다.

## 검토한 방식

1. 기존 CRM의 새 내부 페이지: 개발량은 적지만 기존 탐색·상태·렌더링 코드와 충돌한다.
2. 별도 EXE: 격리는 가장 강하지만 로그인, 설치, 업데이트를 이중 관리해야 한다.
3. **별도 BrowserWindow(채택)**: 기존 CRM에는 실행 버튼 하나만 추가하고 나머지는 독립 파일과 독립 데이터 영역으로 운영한다.

## 분리 계약

- 기존 `workManagement`, `serviceRecords`, 고객, 건물, 계약의 스키마와 저장 동작을 변경하지 않는다.
- 기존 CRM 변경은 `운영 인텔리전스 열기` 버튼과 이를 여는 안전한 IPC 통로로 제한한다.
- 운영 기록은 `crmCompany/operationsIntelligence/operations`에 별도 저장한다.
- 고객·건물·협력업체는 기존 CRM 데이터를 읽기 전용 참조로 사용한다.
- 운영 기록을 저장하더라도 기존 고객·건물·작업관리 데이터는 갱신하지 않는다.
- 같은 창은 중복 생성하지 않고 이미 열려 있으면 앞으로 가져온다.

## V1 기능

- KPI 요약: 전체 건수, 진행 중, 완료, 평균 처리시간, 현장 방문률, 재작업률
- 운영 목록: 상태·긴급도·유형·건물·담당자·예정일 필터
- 운영 등록: 건물/고객 연결, 유형, 발생 계기, 긴급도, 설명, 담당자, 예정일
- 생애주기: 생성→분류→배정→예정→진행→대기→검증→완료/실패/취소
- 빠른 완료: 사람 개입 유형, 직접 투입시간, 현장 방문, 예외, 재방문/재작업, 결과를 한 번에 기록
- 상태 변경 이력과 주요 시각 자동 기록
- 사람 업무 분석: 생각·소통·조율·이동·실행·검증·보고 비중

## V1에서 미루는 기능

- 병목/R&D 점수 자동 산출과 자동 연구과제 결정
- AI 요약 및 자동 분류
- 첨부파일 원본 업로드
- 기존 작업관리의 자동 변환 또는 양방향 동기화

데이터가 충분하지 않은 상태에서 점수와 R&D 결론을 만들면 잘못된 우선순위를 고착시킬 수 있으므로, V1은 관측 가능한 원자료 수집과 기본 지표에 집중한다.

## 데이터 모델

각 Operation은 다음을 가진다.

- 식별/연결: id, title, buildingId, customerId, vendorIds
- 분류: category, subcategory, trigger, urgency
- 책임: assigneeId, participantIds
- 생애주기: status, statusHistory, createdAt, triagedAt, assignedAt, scheduledAt, startedAt, waitingAt, verificationAt, completedAt, failedAt, cancelledAt
- 사람 개입: interventionTypes, humanReason, humanReasonCategory, directMinutes
- 실행: siteVisit, remoteResolved, exceptionOccurred, exceptionNote, replanned
- 결과: outcome, firstTimeRight, revisitRequired, reworkRequired
- 감사: createdBy, updatedBy, updatedAt, version

## 권한과 보안

- 기존 Firebase Authentication 및 CRM 허용 목록을 그대로 사용한다.
- viewer는 조회만, member/admin은 생성·수정 가능하다.
- 운영 창 전용 preload와 허용 채널 목록을 사용한다.
- 메인 창과 운영 창의 발신 페이지를 각각 정확히 검사한다.
- 서버 규칙은 운영 기록 키, ID, 상태, 버전, 수정자 정보를 검증한다.

## 성공 기준

- 현진님 최신 브랜치 기준 기존 테스트가 모두 유지된다.
- 운영 창을 열고 닫아도 기존 CRM의 현재 화면과 입력 상태가 보존된다.
- 운영 기록 저장 후 재실행·다른 PC 로그인에서도 동일 기록이 보인다.
- 완료 기록은 20~30초 내 입력 가능한 단일 빠른 완료 화면으로 제공된다.
- 운영 기록 저장 전후 기존 CRM 공유 데이터가 변하지 않는다.

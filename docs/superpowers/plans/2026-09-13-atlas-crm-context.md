# CRM 자료 조회 연동 Implementation Plan

**Goal:** 승인된 고객·건물 자료를 지도와 함께 조회하되 지도 모델/백업에는 복사하지 않는다.
**Architecture:** app.js의 기존 건물 관계 함수를 재사용하는 동기 조회 콜백을 host에 전달한다. host는 선택 변경/CRM 갱신마다 textContent 기반 섹션을 다시 표시한다. 연습 모드에서는 회사 정보가 보이지 않는다.
**Tech Stack:** Electron renderer, native DOM, node:test.

1. host 테스트 추가: 선택 건물 ID 조회, 갱신, 연습모드 숨김, 모델/백업으로 개인정보 전달 없음. 실패를 확인한다.
2. crm-host.mjs에 getBuildingContext 콜백과 조회 전용 영역을 추가한다. labels/openCurrent 때 재조회하고 모형과 분리한다.
3. app.js에서 기존 buildingCustomers/buildingContracts/buildingCases/vacancyUnitsForBuilding 및 일정 컬렉션의 실제 스키마를 확인해 명시적인 표시 항목만 전달한다. 이름으로 임의 연결하지 않는다.
4. 조회 섹션은 기본정보/연결 고객/계약/일정/민원 작업/층 호실로 나눈다. 누락 정보는 미등록으로 표시한다. 실제 치수/좌표 자동 추정은 하지 않는다.
5. 집중 테스트와 전체 CRM 테스트 실행, 가상 화면 확인 후 변경 내역 보고. 운영 배포는 검증 성공 이후 별도로 확인한다.

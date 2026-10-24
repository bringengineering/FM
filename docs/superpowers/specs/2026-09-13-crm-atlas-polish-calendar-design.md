# CRM 화면 정돈 및 Google 캘린더 연동 설계

## 상태와 분리 원칙

사용자가 기존 CRM 스타일과 Google → CRM 단방향 읽기 연동을 선택했다. 기존 3D 통합은 PR #116에 제출했으며 자동 병합하지 않는다. 아래 작업은 UI 개선과 캘린더 연동의 두 단계로 나누어 검증한다. 운영 데이터·인증·배포는 명시적으로 확인되지 않은 상태에서 변경하지 않는다.

## 1. 고객·건물 관리 UI

- 기존 CRM 색상(#3182F6, #191F28, #8B95A1, #E5E8EB), 타이포그래피, 흰색 카드, 16px 모서리 및 기존 버튼 패턴을 재사용한다.
- 상단에 등록 고객·연결 건물·관리 중 동수·현재 선택 정보를 짧게 표시한다. 집계의 기준은 기존 활성 레코드이며 가상 수치를 넣지 않는다.
- 왼쪽은 검색 가능한 고객·건물 선택 목록, 중앙은 크게 보이는 3D와 관련 기록 탭, 오른쪽은 간결한 고객·담당자·메모 및 선택 모형 정보로 구성한다.
- 반복되는 제목·주소·긴 설명을 줄인다. 안전 안내는 짧은 요약과 펼쳐 읽는 전문을 제공하되 숨겨진 위험 정보가 없도록 표시한다.
- 중앙 모형 높이는 데스크톱에서 420px 이상을 목표로 한다. 우측 긴 내용 때문에 모형 아래 기록이 밀리지 않도록 독립 영역으로 구성한다.
- 작은 화면에서는 목록·모형·상세를 순서대로 쌓고, 선택 버튼과 글자가 잘리거나 가로 스크롤을 강제하지 않는다.
- 등록·수정·초안 보호·ID 기반 데이터 연결·읽기 전용 권한은 그대로 유지한다. 원본 데이터나 모델 좌표를 변경하지 않는다.

## 2. Google → CRM 회사 일정 동기화

### 사용자 흐름

설정에서 회사 Google 계정 연결 → 접근 가능한 캘린더 이름 조회 → 회사 업무용 캘린더를 직접 선택 → 공유될 항목과 CRM 열람 대상을 확인 → 첫 동기화 → 기존 업무일정 캘린더에 Google 출처 표시로 조회한다. 개인 기본 캘린더를 자동 선택하지 않는다.

### 권한과 범위

Calendar 목록과 일정 읽기에 필요한 최소 읽기 전용 OAuth 범위만 요청한다. 비밀번호는 받지 않는다. 신규 Google 권한 동의는 사용자가 직접 완료한다. Google OAuth 앱 등록·콜백 URL·서버 비밀 저장 구성이 없으면 연결 버튼은 미설정 안내를 보여 주며 연결된 것처럼 표시하지 않는다.

계정 연결과 캘린더 선택 변경은 CRM 관리자만 가능하다. 공유될 일정의 제목·시작/종료·장소·설명만 허용하고 참석자 이메일·첨부파일은 기본 수집하지 않는다. 캘린더 공유 전 CRM 열람 범위를 확인한다. 인증 토큰은 EXE·GitHub·일반 CRM 데이터에 넣지 않고 회사 서버의 암호화된 전용 저장소에서 보관한다.

### 서버 및 데이터

기존 Worker 인증 구조와 호환되는 별도 calendar 모듈로 구현한다. Google 이벤트는 CRM 자체 작업·계약 레코드와 분리된 외부 일정 저장 영역에 보관하며 calendarId + eventId로 중복을 막는다. 기존 CRM 일정 저장 API로 Google 이벤트를 덮어쓰지 않는다.

최초 페이지 전체를 성공적으로 조회한 뒤 캐시를 공개한다. 후속 조회는 syncToken으로 변경분을 적용하고 마지막 페이지까지 성공한 경우에만 토큰을 교체한다. 변경 알림 웹훅은 자료 자체로 신뢰하지 않고 등록된 channel/resource/token을 확인한 뒤 Google에서 재조회한다. 정기 재확인과 채널 만료 전 갱신을 함께 구성한다. 만료된 syncToken은 안전한 재동기화로 복구한다.

반복 일정 예외, 종일 일정의 종료일 배타 규칙, 시간대, 취소 상태를 처리한다. Google 취소는 대응하는 외부 일정에만 반영한다. 고객·건물 연결은 사용자의 명시적 선택이며 제목으로 추측하지 않는다. 연결 해제 후 추가 수집을 중단하며 기존 CRM 업무 기록은 유지한다.

### 장애 및 UI

마지막 성공 시각, 동기화 중·지연·권한 만료·미설정 상태와 수동 새로고침을 표시한다. 실패 시 마지막 정상 자료를 유지하면서 오래된 자료임을 명시한다. Google 원본은 CRM에서 읽기 전용으로 표시한다. 연결 오류가 기존 CRM 캘린더 렌더링·편집·저장을 막지 않는다.

## 수용 기준

- 기존 CRM 스타일과 일치하는 실제 코드 화면을 데스크톱·좁은 화면에서 확인한다.
- 현재 건물 외 기록 혼입, 초안 손실, 쓰기 권한 우회 회귀 테스트를 통과한다.
- 캘린더 중복·변경·취소·반복·시간대·페이지 실패·재시도·권한 만료를 가상 API 테스트로 검증한다.
- Google 실계정 연결은 설정과 사용자 동의가 완료된 이후 선택한 업무용 캘린더로만 확인한다.
- Google 연결 전 단계와 실제 연동 완료를 결과 보고에서 구분한다. PR 생성은 배포 완료를 의미하지 않는다.
# Status update — 2026-09-14

User cancelled the Google Calendar integration. Calendar-related sections below are historical design only and must not be implemented or deployed. The integration code, IPC, UI, Worker routes and migration were removed. Existing native CRM calendars and records remain unchanged. Customer/building 3D integration and CRM-style UI polish continue under PR #116. Google OAuth client/downloaded credentials and enabled API were not deleted; no calendar server deployment or live event import occurred. Temporary Cloudflare calendar secrets were rolled back before cancellation.
